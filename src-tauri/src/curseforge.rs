//! Narrow native CurseForge boundary. The webview can set/delete/check a key,
//! but cannot retrieve it or supply URLs. No response/error bodies are logged.
use crate::session::{SessionError, SessionEvent};
use keyring::Entry;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use tauri_plugin_http::reqwest::{self, Url};

const SERVICE: &str = "page.mjoe.jmcl.curseforge";
const ACCOUNT: &str = "api-key";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

fn error(code: &str, message: &str) -> SessionError {
    SessionError::coded(code, message)
}
fn keychain_error() -> SessionError {
    error("CURSEFORGE_KEYCHAIN", "CurseForge keychain access failed.")
}
pub fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 512 && key.bytes().all(|b| (33..=126).contains(&b))
}
fn entry() -> Result<Entry, SessionError> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| keychain_error())
}
async fn stored_key() -> Result<Option<String>, SessionError> {
    tauri::async_runtime::spawn_blocking(|| match entry()?.get_password() {
        Ok(key) if valid_key(&key) => Ok(Some(key)),
        Ok(_) => Err(error(
            "CURSEFORGE_KEY_INVALID",
            "Replace the invalid saved CurseForge key in Settings.",
        )),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(keychain_error()),
    })
    .await
    .map_err(|_| keychain_error())?
}
pub async fn required_key() -> Result<String, SessionError> {
    stored_key().await?.ok_or_else(|| {
        error(
            "CURSEFORGE_KEY_REQUIRED",
            "Save a CurseForge API key in Settings first.",
        )
    })
}
#[tauri::command]
pub async fn curseforge_key_status() -> Result<bool, SessionError> {
    Ok(stored_key().await?.is_some())
}
#[tauri::command]
pub async fn curseforge_key_set(api_key: String) -> Result<(), SessionError> {
    if !valid_key(&api_key) {
        return Err(error(
            "CURSEFORGE_KEY_INVALID",
            "The key must contain 1–512 printable ASCII characters without spaces.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        entry()?
            .set_password(&api_key)
            .map_err(|_| keychain_error())
    })
    .await
    .map_err(|_| keychain_error())?
}
#[tauri::command]
pub async fn curseforge_key_delete() -> Result<(), SessionError> {
    tauri::async_runtime::spawn_blocking(|| match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(keychain_error()),
    })
    .await
    .map_err(|_| keychain_error())?
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogRequest {
    kind: String,
    class_id: u32,
    project_id: Option<String>,
    query: Option<String>,
    game_version: String,
    loader: Option<u8>,
    index: Option<u32>,
    page_size: Option<u32>,
}
fn invalid_request() -> SessionError {
    error(
        "CURSEFORGE_REQUEST_INVALID",
        "Invalid CurseForge catalog request.",
    )
}
fn numeric_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 10
        && value.bytes().all(|b| b.is_ascii_digit())
        && value.parse::<u32>().is_ok_and(|id| id > 0)
}
fn catalog_url(request: &CatalogRequest) -> Result<Url, SessionError> {
    let size = request.page_size.unwrap_or(50);
    let index = request.index.unwrap_or(0);
    if !matches!(request.class_id, 6 | 12 | 6552 | 5290)
        || size == 0
        || size > 50
        || index > 10000 - size
        || request.game_version.len() > 100
        || request.game_version.chars().any(char::is_control)
        || request
            .query
            .as_ref()
            .is_some_and(|q| q.len() > 256 || q.chars().any(char::is_control))
        || request
            .loader
            .is_some_and(|loader| !matches!(loader, 1 | 4 | 6))
        || (request.loader.is_some() && (request.class_id != 6 || request.game_version.is_empty()))
    {
        return Err(invalid_request());
    }
    let path = match request.kind.as_str() {
        "search" if request.project_id.is_none() => "search".to_owned(),
        "files" => {
            let id = request
                .project_id
                .as_deref()
                .filter(|id| numeric_id(id))
                .ok_or_else(invalid_request)?;
            format!("{id}/files")
        }
        _ => return Err(invalid_request()),
    };
    let mut url = Url::parse(&format!("https://api.curseforge.com/v1/mods/{path}"))
        .map_err(|_| invalid_request())?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("pageSize", &size.to_string())
            .append_pair("index", &index.to_string());
        if request.kind == "search" {
            query
                .append_pair("gameId", "432")
                .append_pair("classId", &request.class_id.to_string())
                .append_pair("searchFilter", request.query.as_deref().unwrap_or(""))
                .append_pair("sortField", "2")
                .append_pair("sortOrder", "desc");
        }
        if !request.game_version.is_empty() {
            query.append_pair("gameVersion", &request.game_version);
        }
        if let Some(loader) = request.loader {
            query.append_pair("modLoaderType", &loader.to_string());
        }
    }
    Ok(url)
}
#[tauri::command]
pub async fn curseforge_catalog(request: CatalogRequest) -> Result<Value, SessionError> {
    let url = catalog_url(&request)?;
    let key = required_key().await?;
    let failed = || {
        error(
            "CURSEFORGE_NETWORK",
            "CurseForge catalog request failed. Try again later.",
        )
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| failed())?;
    if request.kind == "files" {
        // Version changes can enter directly from an installed entry; they must
        // recheck the project's third-party distribution policy too.
        let id = request.project_id.as_deref().ok_or_else(invalid_request)?;
        let project_url = Url::parse(&format!("https://api.curseforge.com/v1/mods/{id}"))
            .map_err(|_| invalid_request())?;
        let project = fetch_json(&client, project_url, &key).await?;
        validate_project(&project, &request)?;
    }
    let mut value = fetch_json(&client, url, &key).await?;
    // Catalog output is metadata only. No download URL is needed by the GUI;
    // the Core uses the official file/download endpoint, never a guessed CDN.
    metadata_only(&mut value);
    scrub_value(&mut value, &key);
    Ok(value)
}
fn validate_project(project: &Value, request: &CatalogRequest) -> Result<(), SessionError> {
    let project = &project["data"];
    if project["gameId"].as_u64() != Some(432)
        || project["classId"].as_u64() != Some(request.class_id as u64)
        || project["id"].as_u64().map(|id| id.to_string()).as_deref()
            != request.project_id.as_deref()
    {
        return Err(invalid_request());
    }
    if project["allowModDistribution"].as_bool() == Some(false)
        || project["isAvailable"].as_bool() == Some(false)
    {
        return Err(error(
            "CURSEFORGE_DOWNLOAD_UNAVAILABLE",
            "This project does not allow third-party downloads.",
        ));
    }
    Ok(())
}
fn metadata_only(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            // Preserve only a boolean signal, never disclose or construct URLs.
            if let Some(url) = fields.remove("downloadUrl") {
                fields.insert(
                    "downloadAvailable".into(),
                    Value::Bool(
                        url.as_str()
                            .and_then(|url| Url::parse(url).ok())
                            .is_some_and(|url| {
                                url.scheme() == "https"
                                    && url.host_str().is_some()
                                    && url.username().is_empty()
                                    && url.password().is_none()
                            }),
                    ),
                );
            }
            for value in fields.values_mut() {
                metadata_only(value);
            }
        }
        Value::Array(values) => values.iter_mut().for_each(metadata_only),
        _ => {}
    }
}
async fn fetch_json(client: &reqwest::Client, url: Url, key: &str) -> Result<Value, SessionError> {
    let failed = || {
        error(
            "CURSEFORGE_NETWORK",
            "CurseForge catalog request failed. Try again later.",
        )
    };
    let mut header = reqwest::header::HeaderValue::from_str(key).map_err(|_| failed())?;
    header.set_sensitive(true);
    let mut response = client
        .get(url)
        .header("x-api-key", header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| failed())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => error(
                "CURSEFORGE_AUTH",
                "CurseForge rejected the API key. Check it in Settings.",
            ),
            429 => error(
                "CURSEFORGE_RATE_LIMIT",
                "CurseForge rate limit reached. Try again later.",
            ),
            _ => failed(),
        });
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE as u64)
    {
        return Err(failed());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failed())? {
        if body.len() + chunk.len() > MAX_RESPONSE {
            return Err(failed());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| failed())
}

/// Opt-in is a bridge flag, not an RPC parameter. Only these contracts accept
/// the native key. Set-version resolves its provider from the Core registry.
pub fn validate_injection(method: &str, params: &Value, enabled: bool) -> Result<(), SessionError> {
    if contains_api_key(params) {
        return Err(error(
            "CURSEFORGE_KEY_INPUT",
            "API keys must be supplied through the native key settings.",
        ));
    }
    if !enabled {
        if params.get("provider").and_then(Value::as_str) == Some("curseforge") {
            return Err(error(
                "CURSEFORGE_KEY_REQUIRED",
                "CurseForge operations require the native key bridge.",
            ));
        }
        return Ok(());
    }
    let valid = matches!(
        method,
        "mods.install"
            | "mods.set-version"
            | "resourcepacks.install"
            | "resourcepacks.set-version"
            | "shaderpacks.install"
            | "shaderpacks.set-version"
            | "datapacks.install"
            | "datapacks.set-version"
            | "server.mods.install"
            | "server.mods.set-version"
            | "server.datapacks.install"
            | "server.datapacks.set-version"
            | "modpack.install"
    );
    if !valid || !params.is_object() {
        return Err(invalid_request());
    }
    if method != "modpack.install" {
        if !params
            .get("project")
            .and_then(Value::as_str)
            .is_some_and(numeric_id)
            || params
                .get("version_id")
                .is_some_and(|id| !id.as_str().is_some_and(numeric_id))
        {
            return Err(invalid_request());
        }
        if method.ends_with(".install")
            && params.get("provider").and_then(Value::as_str) != Some("curseforge")
        {
            return Err(invalid_request());
        }
    }
    Ok(())
}
/// Core resolves a version-change selector across providers (id OR slug).
/// Fail closed on collisions before retrieving or injecting a credential.
fn preflight_request(method: &str, params: &Value) -> Option<(String, Value)> {
    let kind = method.strip_suffix(".set-version")?;
    let mut listing = serde_json::Map::new();
    for field in ["directory", "world", "id"] {
        if let Some(value) = params.get(field) {
            listing.insert(field.into(), value.clone());
        }
    }
    Some((format!("{kind}.list"), Value::Object(listing)))
}
fn validate_registry(result: &Value, project: &str) -> Result<(), SessionError> {
    let entries = result
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| error("CONTENT_CONFLICT", "Unable to verify the content provider."))?;
    let matches: Vec<&Value> = entries
        .iter()
        .filter(|entry| {
            let source = &entry["source"];
            source["provider"].as_str() != Some("manual")
                && (source["project_id"].as_str() == Some(project)
                    || source["slug"].as_str() == Some(project))
        })
        .collect();
    if matches.is_empty() {
        return Err(error(
            "CONTENT_NOT_FOUND",
            "The selected content entry no longer exists.",
        ));
    }
    if matches.len() > 1 {
        return Err(error(
            "CONTENT_PROJECT_AMBIGUOUS",
            "More than one content entry matches this project selector.",
        ));
    }
    if matches[0]["source"]["provider"].as_str() != Some("curseforge")
        || matches[0]["source"]["project_id"].as_str() != Some(project)
    {
        return Err(error(
            "CONTENT_CONFLICT",
            "The project selector is ambiguous or belongs to another provider.",
        ));
    }
    Ok(())
}
pub async fn preflight_version_change(
    session: &crate::session::Session,
    method: &str,
    params: &Value,
) -> Result<(), SessionError> {
    let Some((list_method, listing)) = preflight_request(method, params) else {
        return Ok(());
    };
    let result = session
        .request(&list_method, listing, |_| {})
        .await
        .map_err(|_| error("CONTENT_CONFLICT", "Unable to verify the content provider."))?;
    validate_registry(
        &result,
        params["project"].as_str().ok_or_else(invalid_request)?,
    )
}

fn contains_api_key(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields
            .iter()
            .any(|(name, value)| name == "api_key" || contains_api_key(value)),
        Value::Array(values) => values.iter().any(contains_api_key),
        _ => false,
    }
}
pub fn scrub_value(value: &mut Value, key: &str) {
    match value {
        Value::String(text) => *text = text.replace(key, "[redacted]"),
        Value::Object(fields) => {
            let old = std::mem::take(fields);
            for (name, mut value) in old {
                if name.eq_ignore_ascii_case("api_key") || name.eq_ignore_ascii_case("x-api-key") {
                    continue;
                }
                scrub_value(&mut value, key);
                fields.insert(name.replace(key, "[redacted]"), value);
            }
        }
        Value::Array(values) => values.iter_mut().for_each(|value| scrub_value(value, key)),
        _ => {}
    }
}
pub fn scrub_event(event: SessionEvent, _key: &str) -> Option<SessionEvent> {
    // Only credential-free numeric progress crosses this boundary. Even an
    // encoded header in diagnostic/retry/unknown metadata must stay native.
    let SessionEvent::Event(value) = event else {
        return None;
    };
    if value["event"].as_str() != Some("progress") {
        return None;
    }
    let mut progress = serde_json::Map::new();
    for name in [
        "files_completed",
        "files_total",
        "bytes_processed",
        "bytes_total",
    ] {
        let number = value["progress"][name].as_u64()?;
        if number > 9_007_199_254_740_991 {
            return None;
        }
        progress.insert(name.into(), number.into());
    }
    Some(SessionEvent::Event(
        serde_json::json!({"event":"progress", "progress": progress}),
    ))
}
fn safe_error_code(code: &str, key: &str) -> String {
    // Pinned Core 97b65186 content/datapack/server-content/modpack contracts.
    let known = matches!(
        code,
        "INVALID_PARAMS"
            | "INSTALL_ROOT_ERROR"
            | "INSTANCES_ROOT_ERROR"
            | "STORE_ROOT_ERROR"
            | "NO_COMPATIBLE_VERSION"
            | "INCOMPATIBLE_VERSION"
            | "VERSION_PROJECT_MISMATCH"
            | "CONTENT_CONFLICT"
            | "CONTENT_KIND_MISMATCH"
            | "UNSUPPORTED_PROJECT_TYPE"
            | "DOWNLOAD_UNAVAILABLE"
            | "HTTP_STATUS_ERROR"
            | "RESPONSE_TOO_LARGE"
            | "CONTENT_INSTALL_FAILED"
            | "CONTENT_SET_VERSION_FAILED"
            | "CONTENT_NOT_FOUND"
            | "SERVER_NOT_FOUND"
            | "SERVER_STATUS_FAILED"
            | "SERVER_ALREADY_RUNNING"
            | "SERVER_LOADER_REQUIRED"
            | "SERVER_CONTENT_INSTALL_FAILED"
            | "SERVER_CONTENT_SET_VERSION_FAILED"
            | "SERVER_DATAPACKS_INSTALL_FAILED"
            | "SERVER_DATAPACKS_SET_VERSION_FAILED"
            | "WORLD_LOCKED"
            | "WORLD_NOT_FOUND"
            | "INSTANCE_EXISTS"
            | "UNKNOWN_MODPACK_FORMAT"
            | "UNSUPPORTED_MODPACK_FORMAT"
            | "UNSUPPORTED_LOADER"
            | "LOADER_CONFLICT"
            | "MODPACK_NOT_FOUND"
            | "UNSAFE_MODPACK"
            | "MODPACK_INSTALL_FAILED"
            | "SESSION_CLOSED"
            | "SESSION_CANCELLED"
            | "TRANSPORT_ERROR"
            | "SSH_DISCONNECTED"
            | "SSH_PROTOCOL_ERROR"
            | "SSH_TIMEOUT"
    );
    if known && !code.contains(key) {
        code.into()
    } else {
        "CURSEFORGE_OPERATION_FAILED".into()
    }
}
pub fn scrub_error(error: SessionError, key: &str) -> SessionError {
    match error {
        SessionError::Rpc { code, .. } => SessionError::Rpc {
            code: safe_error_code(&code, key),
            message: "CurseForge operation failed. Check the error code and API key settings."
                .into(),
        },
        SessionError::Transport { code, .. } => SessionError::Transport {
            code: safe_error_code(&code, key),
            message: "CurseForge operation could not complete.".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request() -> CatalogRequest {
        serde_json::from_value(
            json!({"kind":"search","class_id":6,"game_version":"1.21","loader":4}),
        )
        .unwrap()
    }
    #[test]
    fn validates_secret_without_echo() {
        for key in ["", " ", "x\ny", "é", &"x".repeat(513)] {
            assert!(!valid_key(key));
        }
        assert!(valid_key("synthetic-Key!"));
        assert!(valid_key(&"x".repeat(512)));
        assert_ne!(SERVICE, "page.mjoe.jmcl");
    }
    #[test]
    fn fixed_host_and_bounded_pagination() {
        let mut req = request();
        let url = catalog_url(&req).unwrap();
        assert_eq!(url.host_str(), Some("api.curseforge.com"));
        assert!(url.query_pairs().any(|(k, v)| k == "gameId" && v == "432"));
        req.page_size = Some(51);
        assert!(catalog_url(&req).is_err());
        req.page_size = Some(50);
        req.index = Some(9951);
        assert!(catalog_url(&req).is_err());
        req.index = Some(9950);
        assert!(catalog_url(&req).is_ok());
        req.game_version.clear();
        assert!(catalog_url(&req).is_err());
        req.loader = None;
        req.kind = "files".into();
        req.project_id = Some("../secrets".into());
        assert!(catalog_url(&req).is_err());
        req.project_id = Some("1234".into());
        assert_eq!(catalog_url(&req).unwrap().path(), "/v1/mods/1234/files");
    }
    #[test]
    fn only_allowlisted_requests_receive_key() {
        for method in [
            "mods.install",
            "resourcepacks.install",
            "shaderpacks.install",
            "datapacks.install",
            "server.mods.install",
            "server.datapacks.install",
        ] {
            assert!(validate_injection(
                method,
                &json!({"provider":"curseforge","project":"123","version_id":"456"}),
                true
            )
            .is_ok());
            assert!(validate_injection(
                method,
                &json!({"provider":"modrinth","project":"123"}),
                true
            )
            .is_err());
        }
        assert!(validate_injection(
            "mods.set-version",
            &json!({"project":"123","version_id":"456"}),
            true
        )
        .is_ok());
        assert!(
            validate_injection("modpack.install", &json!({"file":"fixture.zip"}), true).is_ok()
        );
        assert!(validate_injection("ping", &json!({}), true).is_err());
        assert!(
            validate_injection("ping", &json!({"nested":{"api_key":"synthetic"}}), false).is_err()
        );
    }
    #[test]
    fn ordinary_modrinth_and_auth_requests_are_unchanged() {
        for (method, params) in [
            (
                "mods.install",
                json!({"provider":"modrinth","project":"sodium","version_id":"fixture"}),
            ),
            (
                "mods.set-version",
                json!({"project":"sodium","version_id":"fixture"}),
            ),
            (
                "auth.microsoft.device.begin",
                json!({"client_id":"fixture"}),
            ),
            (
                "auth.microsoft.device.poll",
                json!({"client_id":"fixture","device_code":"synthetic-device"}),
            ),
            (
                "auth.minecraft.exchange",
                json!({"access_token":"synthetic-access"}),
            ),
            (
                "auth.minecraft.refresh_exchange",
                json!({"client_id":"fixture","refresh_token":"synthetic-refresh"}),
            ),
        ] {
            let original = params.clone();
            assert!(validate_injection(method, &params, false).is_ok());
            assert_eq!(params, original);
            assert!(!contains_api_key(&params));
        }
    }
    #[test]
    fn distribution_policy_and_metadata_only() {
        let mut req = request();
        req.kind = "files".into();
        req.project_id = Some("123".into());
        let mut project =
            json!({"data":{"id":123,"gameId":432,"classId":6,"allowModDistribution":false}});
        assert!(validate_project(&project, &req).is_err());
        project["data"]["allowModDistribution"] = json!(true);
        assert!(validate_project(&project, &req).is_ok());
        project["data"]["classId"] = json!(12);
        assert!(validate_project(&project, &req).is_err());
        let mut files = json!({"data":[{"downloadUrl":null},{"downloadUrl":"https://example.invalid/fixture"}]});
        metadata_only(&mut files);
        assert_eq!(files["data"][0]["downloadAvailable"], false);
        assert_eq!(files["data"][1]["downloadAvailable"], true);
        assert!(!files.to_string().contains("https://"));
    }
    #[test]
    fn provider_preflight_rejects_id_and_slug_collisions() {
        let cf = serde_json::json!({"source":{"provider":"curseforge","project_id":"123","slug":"example"}});
        let other =
            serde_json::json!({"source":{"provider":"modrinth","project_id":"other","slug":"123"}});
        assert!(validate_registry(&json!({"entries":[cf.clone()]}), "123").is_ok());
        assert!(validate_registry(&json!({"entries":[cf.clone(),other.clone()]}), "123").is_err());
        assert!(validate_registry(&json!({"entries":[other]}), "123").is_err());
        assert!(validate_registry(&json!({"entries":[]}), "123").is_err());
        assert!(validate_registry(&json!({"entries":[cf.clone(),cf]}), "123").is_err());
        assert!(validate_registry(&json!({"entries":null}), "123").is_err());
        for (method, expected) in [
            ("mods.set-version", "mods.list"),
            ("datapacks.set-version", "datapacks.list"),
            ("server.mods.set-version", "server.mods.list"),
            ("server.datapacks.set-version", "server.datapacks.list"),
        ] {
            let (list, params) = preflight_request(method, &json!({"directory":"fixture","id":"server","world":"world","project":"123","version_id":"456"})).unwrap();
            assert_eq!(list, expected);
            assert_eq!(
                params,
                json!({"directory":"fixture","id":"server","world":"world"})
            );
        }
        assert!(preflight_request("mods.install", &json!({})).is_none());
    }
    #[tokio::test]
    async fn provider_preflight_runs_before_credentialed_mutation() {
        use crate::transport::{LineTransport, TransportEvent, TransportFailure};
        use std::sync::{Arc, Mutex};
        struct Fixture {
            requests: Arc<Mutex<Vec<Value>>>,
            pending: Option<String>,
        }
        #[async_trait::async_trait]
        impl LineTransport for Fixture {
            async fn write_line(&mut self, line: &str) -> Result<(), TransportFailure> {
                let request: Value = serde_json::from_str(line).unwrap();
                let result = match request["method"].as_str().unwrap() {
                    "core.version" => json!({"name":"fixture","version":"1","protocol":1}),
                    "mods.list" => {
                        json!({"entries":[{"source":{"provider":"curseforge","project_id":"123"}}]})
                    }
                    "mods.set-version" => json!({"changed":true}),
                    _ => panic!("unexpected fixture method"),
                };
                self.pending =
                    Some(json!({"id":request["id"],"event":"result","result":result}).to_string());
                self.requests.lock().unwrap().push(request);
                Ok(())
            }
            async fn next_event(&mut self) -> TransportEvent {
                TransportEvent::Line(self.pending.take().unwrap())
            }
            async fn close(&mut self) -> Result<(), TransportFailure> {
                Ok(())
            }
            async fn abort(&mut self) -> Result<(), TransportFailure> {
                Ok(())
            }
        }
        let requests = Arc::new(Mutex::new(Vec::new()));
        let session = crate::session::Session::establish(Box::new(Fixture {
            requests: requests.clone(),
            pending: None,
        }))
        .await
        .unwrap();
        let mut params = json!({"directory":"fixture","project":"123","version_id":"456"});
        preflight_version_change(&session, "mods.set-version", &params)
            .await
            .unwrap();
        params["api_key"] = json!("synthetic");
        session
            .request_credentialed("mods.set-version", params, |_| {})
            .await
            .unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[1]["method"], "mods.list");
        assert_eq!(requests[1]["params"], json!({"directory":"fixture"}));
        assert_eq!(requests[2]["method"], "mods.set-version");
        assert_eq!(requests[2]["params"]["api_key"], "synthetic");
    }

    #[test]
    fn secrets_never_reach_webview_output() {
        let mut value = json!({"api_key":"synthetic", "x-api-key":"synthetic", "synthetic": ["prefix synthetic suffix"]});
        scrub_value(&mut value, "synthetic");
        assert!(!value.to_string().contains("synthetic"));
        assert!(scrub_event(SessionEvent::Diagnostic("synthetic".into()), "synthetic").is_none());
        let err = scrub_error(
            SessionError::Rpc {
                code: "FAIL".into(),
                message: "synthetic".into(),
            },
            "synthetic",
        );
        assert!(!serde_json::to_string(&err).unwrap().contains("synthetic"));
        assert_eq!(
            safe_error_code("c3ludGhldGlj", "synthetic"),
            "CURSEFORGE_OPERATION_FAILED"
        );
        assert_eq!(
            safe_error_code("DOWNLOAD_UNAVAILABLE", "synthetic"),
            "DOWNLOAD_UNAVAILABLE"
        );
        assert!(scrub_event(
            SessionEvent::Event(json!({"event":"retry", "url":"c3ludGhldGlj"})),
            "synthetic"
        )
        .is_none());
        let progress = scrub_event(SessionEvent::Event(json!({"event":"progress", "secret":"c3ludGhldGlj", "progress":{"files_completed":1,"files_total":2,"bytes_processed":3,"bytes_total":4,"secret":"c3ludGhldGlj"}})), "synthetic").unwrap();
        assert!(!serde_json::to_string(&progress)
            .unwrap()
            .contains("c3ludGhldGlj"));
    }
}
