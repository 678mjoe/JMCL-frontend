//! Immutable launch intent and fixed fixture boundary for the integrated QA package.

use std::{
    ffi::OsStr,
    fs,
    io,
    path::{Path, PathBuf},
    time::Instant,
};

use serde_json::{json, Value};
use tauri::State;

use crate::{endpoints, login_test_policy::{self, Profile}, play_freshness, server_status_cache, session::SessionError};

pub(crate) const IDENTIFIER: &str = "page.mjoe.jmcl.experimental-rust-preview.integrated-qa";
pub(crate) const PRODUCT: &str = "JMCL Rust Integrated QA";
pub(crate) const BINARY: &str = "jmcl-rust-integrated-qa";
pub(crate) const KEYCHAIN_SERVICE: &str = "page.mjoe.jmcl.experimental-rust-preview.integrated-qa.refresh";
pub(crate) const WEBVIEW: [u8; 16] = [139, 247, 31, 43, 212, 75, 65, 28, 167, 115, 23, 241, 45, 108, 134, 171];
const MICROSOFT_FLAG: &str = "--jmcl-qa-enable-microsoft";
const JAVA: Option<&str> = option_env!("JMCL_INTEGRATED_QA_JAVA");
const INSTANCE: &str = "gui-play-vanilla-1-20-1";
const VERSION: &str = "1.20.1";
const RECEIPT: &[u8] = b"JMCL_OFFLINE_PLAY_FIXTURE_V1\n";

pub(crate) fn select(
    preview: bool,
    microsoft: bool,
    identifier: &str,
    mut args: impl Iterator<Item = impl AsRef<OsStr>>,
) -> Option<Profile> {
    if !preview || !microsoft || identifier != IDENTIFIER {
        return None;
    }
    match args.next() {
        None => Some(Profile::IntegratedOffline),
        Some(flag) if flag.as_ref() == OsStr::new(MICROSOFT_FLAG) && args.next().is_none() => {
            Some(Profile::IntegratedMicrosoft)
        }
        _ => None,
    }
}

pub(crate) fn app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost")
        && url.username().is_empty() && url.password().is_none()
        && url.port().is_none() && url.query().is_none() && url.fragment().is_none()
        && matches!(url.path(), "" | "/" | "/index.html")
}

fn offline_auth() -> Value {
    json!({
        "player_name": "Player", "uuid": "a01e3843e5215998558af459800e4d11",
        "access_token": "offline", "user_type": "legacy"
    })
}

pub(crate) fn has_offline_auth(params: &Value) -> bool {
    params.get("auth").is_some_and(|auth| auth == &offline_auth())
}

fn denied() -> SessionError {
    SessionError::coded("QA_OPERATION_DISABLED", "This operation is unavailable in the integrated QA app.")
}

fn checked(path: &Path, directory: bool) -> io::Result<()> {
    let kind = path.symlink_metadata()?.file_type();
    if !path.is_absolute() || path.to_str().is_none() || path.canonicalize()? != path
        || (directory && !kind.is_dir()) || (!directory && !kind.is_file())
    {
        return Err(io::Error::other("integrated QA requires a canonical ordinary fixture path"));
    }
    Ok(())
}

pub(crate) struct Scope {
    instances: PathBuf,
    game: PathBuf,
    store: PathBuf,
    servers: PathBuf,
    java: PathBuf,
}

impl Scope {
    pub(crate) fn bind(data: &Path) -> io::Result<Self> {
        let scope = Self::for_test_or_staged_path(data, PathBuf::from(JAVA.ok_or_else(|| {
            io::Error::other("integrated QA local Java build pin missing")
        })?));
        for path in [data, &scope.instances, &scope.game, &scope.store, &data.join(".jmclcore/metadata-cache")] {
            checked(path, true)?;
        }
        checked(&scope.java, false)?;
        if !scope.java.ends_with("bin/java") {
            return Err(io::Error::other("integrated QA expects a reviewed local Java executable"));
        }
        let marker = data.join("jmcl-offline-play-fixture.ready");
        checked(&marker, false)?;
        if marker.metadata()?.len() != RECEIPT.len() as u64 || fs::read(&marker)?.as_slice() != RECEIPT {
            return Err(io::Error::other("integrated QA staged fixture marker missing or invalid"));
        }
        Ok(scope)
    }

    fn for_test_or_staged_path(data: &Path, java: PathBuf) -> Self {
        let instances = data.join("instances");
        Self {
            game: instances.join(INSTANCE).join(".minecraft"),
            instances,
            store: data.join("store"),
            servers: data.join("servers"),
            java,
        }
    }

    pub(crate) fn authorize(
        &self, profile: Profile, method: &str, params: Value, curseforge: bool,
    ) -> Result<Value, SessionError> {
        if curseforge || !matches!(profile, Profile::IntegratedOffline | Profile::IntegratedMicrosoft) {
            return Err(denied());
        }
        match method {
            "instance.list" if params == json!({"directory": self.instances}) => Ok(params),
            "instance.get" if params == json!({"directory": self.instances, "id": INSTANCE}) => Ok(params),
            // Preserve the actual Mac UNSUPPORTED_PLATFORM response.
            "server.list" if params == json!({"directory": self.servers}) => Ok(params),
            "launch.execute" => self.offline_launch(params),
            method if profile == Profile::IntegratedMicrosoft
                && login_test_policy::protected_method(method)
                && login_test_policy::allows(profile, method, &params, false) => Ok(params),
            _ => Err(denied()),
        }
    }

    fn offline_launch(&self, params: Value) -> Result<Value, SessionError> {
        if params.pointer("/auth/user_type").and_then(Value::as_str) == Some("msa") {
            return Err(SessionError::coded("QA_AUTHENTICATED_PLAY_DISABLED", "Microsoft-authenticated Play has not been enabled."));
        }
        let mut expected = self.launch_fields();
        expected["auth"] = offline_auth();
        if params != expected {
            return Err(denied());
        }
        Ok(self.project_local(expected))
    }

    pub(crate) fn authenticated_launch(
        &self, profile: Profile, params: Value, witness: &mut play_freshness::State, now: Instant,
    ) -> Result<(Value, Instant), SessionError> {
        if profile != Profile::IntegratedMicrosoft {
            return Err(play_freshness::denied());
        }
        let expires = witness.consume(params.get("auth"), now).ok_or_else(play_freshness::denied)?;
        let Value::Object(mut fields) = params else { return Err(play_freshness::denied()) };
        let auth = fields.remove("auth").ok_or_else(play_freshness::denied)?;
        let mut expected = self.launch_fields();
        if Value::Object(fields) != expected {
            return Err(play_freshness::denied());
        }
        expected["auth"] = auth;
        Ok((self.project_local(expected), expires))
    }

    fn launch_fields(&self) -> Value {
        json!({
            "id": VERSION,
            "directory": self.game, "store_directory": self.store,
            "source": "official", "options": {}, "java_policy": "auto"
        })
    }

    fn project_local(&self, mut wire: Value) -> Value {
        wire["java_policy"] = json!("local");
        wire["java_override"] = json!(self.java);
        wire
    }
}

#[tauri::command]
pub(crate) fn qa_intent(profile: State<'_, Profile>) -> Result<&'static str, &'static str> {
    match *profile.inner() {
        Profile::IntegratedOffline => Ok("offline"),
        Profile::IntegratedMicrosoft => Ok("microsoft_enabled"),
        _ => Err("not an integrated QA app"),
    }
}

#[tauri::command]
pub(crate) fn qa_endpoint_config_read() -> endpoints::EndpointConfigV1 {
    endpoints::canonical_endpoint_config()
}

#[tauri::command]
pub(crate) fn qa_server_status_cache_read() -> Value {
    server_status_cache::canonical_empty_cache()
}

#[tauri::command]
pub(crate) fn qa_open_microsoft_link(
    window: tauri::WebviewWindow,
    profile: State<'_, Profile>,
) -> Result<(), &'static str> {
    use tauri_plugin_opener::OpenerExt;
    if !matches!(*profile.inner(), Profile::IntegratedMicrosoft | Profile::General)
        || window.label() != "main" || !window.url().is_ok_and(|url|
            if *profile.inner() == Profile::General { crate::general_preview::app_url(&url) } else { app_url(&url) })
    {
        return Err("Microsoft verification is unavailable");
    }
    window.opener().open_url(login_test_policy::VERIFICATION_URI, None::<&str>)
        .map_err(|_| "Could not open Microsoft verification")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> Scope {
        Scope::for_test_or_staged_path(Path::new("/qa"), "/local/jdk/bin/java".into())
    }

    fn launch() -> Value {
        json!({
            "id": "1.20.1", "directory": "/qa/instances/gui-play-vanilla-1-20-1/.minecraft",
            "store_directory": "/qa/store", "source": "official", "options": {}, "java_policy": "auto",
            "auth": {"player_name":"Player", "uuid":"a01e3843e5215998558af459800e4d11",
                     "access_token":"offline", "user_type":"legacy"}
        })
    }

    #[test]
    fn exact_identity_and_local_intent_only() {
        let select = |args: &[&str]| super::select(true, true, IDENTIFIER, args.iter().copied());
        assert_eq!(select(&[]), Some(Profile::IntegratedOffline));
        assert_eq!(select(&[MICROSOFT_FLAG]), Some(Profile::IntegratedMicrosoft));
        for bad in [&["microsoft"][..], &[MICROSOFT_FLAG, "/tmp"], &[MICROSOFT_FLAG, MICROSOFT_FLAG]] {
            assert_eq!(select(bad), None);
        }
        assert!(super::select(true, false, IDENTIFIER, std::iter::empty::<&str>()).is_none());
        assert!(Profile::select(false, false, IDENTIFIER).is_none());
        assert!(Profile::select(true, true, IDENTIFIER).is_none());
        assert!(Profile::IntegratedOffline.credential_service("pending-device-login").is_none());
        assert_eq!(Profile::IntegratedMicrosoft.credential_service("pending-device-login"), Some(KEYCHAIN_SERVICE));
        assert_ne!(Profile::MicrosoftTest.credential_service("pending-device-login"), Some(KEYCHAIN_SERVICE));
        for url in ["tauri://localhost", "tauri://localhost/", "tauri://localhost/index.html"] {
            assert!(app_url(&url.parse().unwrap()));
        }
        for url in ["https://localhost/", "tauri://localhost/other", "tauri://localhost/?s=1", "tauri://localhost/#fragment"] {
            assert!(!app_url(&url.parse().unwrap()));
        }
    }

    #[test]
    fn auth_is_unreachable_offline_and_the_enabled_login_allowlist_is_reused() {
        let scope = scope();
        let id = "3dca676e-ab27-4afb-a40d-c177a33ffd70";
        for (method, params) in [
            ("account.microsoft.list", json!({})),
            ("account.microsoft.get", json!({"id":"0123456789abcdef0123456789abcdef"})),
            ("account.microsoft.delete", json!({"id":"0123456789abcdef0123456789abcdef"})),
            ("account.microsoft.save", json!({"account":{
                "id":"0123456789abcdef0123456789abcdef","player_name":"Fixture","client_id":id
            }})),
            ("auth.microsoft.device.begin", json!({"client_id":id,"locale":"zh"})),
            ("auth.microsoft.device.poll", json!({"client_id":id,"device_code":"fixture-only"})),
            ("auth.minecraft.exchange", json!({"client_id":id,"access_token":"fixture-only"})),
            ("auth.minecraft.refresh_exchange", json!({"client_id":id,"refresh_token":"fixture-only"})),
        ] {
            assert!(scope.authorize(Profile::IntegratedOffline, method, params.clone(), false).is_err());
            assert!(scope.authorize(Profile::IntegratedMicrosoft, method, params, false).is_ok());
        }
        assert!(scope.authorize(Profile::IntegratedMicrosoft, "auth.microsoft.device.begin",
            json!({"client_id":"wrong","locale":"zh"}), false).is_err());
        assert!(scope.authorize(Profile::IntegratedMicrosoft, "account.microsoft.list",
            json!({"directory":"/another"}), false).is_err());
        assert!(login_test_policy::sanitize_result("auth.microsoft.device.begin",
            json!({"verification_uri":"https://www.microsoft.com/link"})).is_ok());
        assert!(login_test_policy::sanitize_result("auth.microsoft.device.begin",
            json!({"verification_uri":"https://www.microsoft.com/link?extra=1"})).is_err());
    }

    #[test]
    fn proved_session_cannot_authorize_any_other_launch_shape() {
        let now = Instant::now();
        let uuid = "0123456789abcdef0123456789abcdef";
        let rotation = "fixture-only-rotated-token";
        let auth = json!({
            "player_name":"Fixture","uuid":uuid,"access_token":"fixture-only-access",
            "user_type":"msa","xuid":"","client_id":login_test_policy::CLIENT_ID,
            "user_properties":"{}","expires_in":30
        });
        let terminal = json!({
            "stage":"refresh_exchange","state":"authenticated","refresh_token":rotation,"session":auth
        });
        let mut candidate = launch();
        candidate["auth"] = auth;
        let fixture = scope();
        let mut witness = play_freshness::State::default();
        let mut wrong_path = candidate.clone();
        wrong_path["directory"] = json!("/another");
        assert!(fixture.authenticated_launch(Profile::IntegratedMicrosoft, candidate.clone(), &mut witness, now).is_err());
        for clamped in [false, true] {
            witness.observe_terminal(&terminal, now);
            let pending = witness.start_write(uuid, rotation, now);
            witness.finish_ack(pending, now);
            if clamped {
                let (wire, expires) = fixture.authenticated_launch(Profile::IntegratedMicrosoft, candidate.clone(), &mut witness, now).unwrap();
                assert_eq!(expires, now + std::time::Duration::from_secs(30));
                assert_eq!(wire["java_policy"], "local");
                assert_eq!(wire["java_override"], "/local/jdk/bin/java");
            } else {
                assert!(fixture.authenticated_launch(Profile::IntegratedMicrosoft, wrong_path.clone(), &mut witness, now).is_err());
            }
            assert!(fixture.authenticated_launch(Profile::IntegratedMicrosoft, candidate.clone(), &mut witness, now).is_err());
        }
    }

    #[test]
    fn only_exact_offline_play_and_bound_reads_are_forwarded_in_either_intent() {
        for profile in [Profile::IntegratedOffline, Profile::IntegratedMicrosoft] {
            let scope = scope();
            let accepted = scope.authorize(profile, "launch.execute", launch(), false).unwrap();
            assert_eq!(accepted["java_policy"], "local");
            assert_eq!(accepted["java_override"], "/local/jdk/bin/java");
            for (key, value) in [
                ("directory", json!("/elsewhere")), ("store_directory", json!("/store")),
                ("id", json!("other")), ("java_override", json!("/override")),
                ("fabric_loader", json!("modified")), ("source", json!("bmclapi")),
                ("options", json!({"extra_jvm_args":["-Dnot.the.fixture=true"]})),
                ("auth", json!({"user_type":"msa","access_token":"fixture-only"})),
            ] {
                let mut altered = launch();
                altered[key] = value;
                assert!(scope.authorize(profile, "launch.execute", altered, false).is_err());
            }
            let mut missing_auto = launch();
            missing_auto.as_object_mut().unwrap().remove("java_policy");
            assert!(scope.authorize(profile, "launch.execute", missing_auto, false).is_err());
            assert!(scope.authorize(profile, "launch.execute", launch(), true).is_err());
            assert!(scope.authorize(profile, "launch.plan", launch(), false).is_err());
            assert!(scope.authorize(profile, "instance.list", json!({"directory":"/qa/instances"}), false).is_ok());
            assert!(scope.authorize(profile, "instance.get", json!({"directory":"/qa/instances","id":INSTANCE}), false).is_ok());
            assert!(scope.authorize(profile, "instance.get", json!({"directory":"/qa/instances","id":"another"}), false).is_err());
        }
    }
}
