//! JMCL GUI: Tauri bridge to `jmcl-core` JSON Lines RPC sessions.

pub mod credentials;
pub mod curseforge;
pub mod diagnostics;
pub mod endpoints;
pub mod modpack_preview;
pub mod pack_activation;
pub mod pool;
pub mod server_status_cache;
pub mod session;
pub mod ssh_transport;
pub mod transport;
mod update_config;
mod updater;

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{ipc::Channel, Manager, State};

use pool::SessionPool;
use session::{SessionError, SessionEvent};

/// Build target of the bundled local sidecar; never infer architecture from WebView UA.
#[tauri::command]
fn runtime_target() -> Value {
    normalized_runtime_target(std::env::consts::OS, std::env::consts::ARCH)
}

fn normalized_runtime_target(os: &str, arch: &str) -> Value {
    let os = match os {
        "macos" => "osx",
        "linux" => "linux",
        "windows" => "windows",
        _ => return Value::Null,
    };
    let arch = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        "x86" => "x86",
        "arm" => "arm",
        _ => return Value::Null,
    };
    json!({ "os": os, "arch": arch })
}

#[cfg(test)]
mod runtime_target_tests {
    use super::*;
    #[test]
    fn normalizes_supported_build_targets_and_rejects_unknown() {
        assert_eq!(
            normalized_runtime_target("macos", "aarch64"),
            json!({"os":"osx","arch":"arm64"})
        );
        assert_eq!(
            normalized_runtime_target("windows", "x86_64"),
            json!({"os":"windows","arch":"x86_64"})
        );
        assert_eq!(
            normalized_runtime_target("linux", "x86"),
            json!({"os":"linux","arch":"x86"})
        );
        assert_eq!(normalized_runtime_target("unknown", "x86_64"), Value::Null);
        assert_eq!(normalized_runtime_target("linux", "unknown"), Value::Null);
    }
}

/// Open a new RPC session; returns its id and the core's identity.
#[tauri::command]
async fn core_open(
    pool: State<'_, SessionPool>,
    binary_path: Option<String>,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<pool::SessionInfo, SessionError> {
    let mut operation = diagnostics.operation(diagnostics::Event::CoreOpen, Some("core.version"));
    let result = pool.open(binary_path.as_deref()).await;
    operation.finish_session(&result);
    result
}

/// Open an independent system OpenSSH RPC session for a persisted endpoint.
#[tauri::command]
async fn endpoint_session_open(
    pool: State<'_, SessionPool>,
    endpoint_id: String,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<pool::SessionInfo, SessionError> {
    let mut operation =
        diagnostics.operation(diagnostics::Event::EndpointOpen, Some("core.version"));
    let result = pool.open_endpoint(&endpoint_id).await;
    operation.finish_session(&result);
    result
}

/// Close a session. Unknown ids are a no-op.
#[tauri::command]
async fn core_close(
    pool: State<'_, SessionPool>,
    session_id: u64,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<(), SessionError> {
    pool.close(session_id).await;
    diagnostics.event(diagnostics::Event::CoreClose);
    Ok(())
}

/// Close only the live SSH sessions owned by one persisted endpoint.
#[tauri::command]
async fn endpoint_sessions_close(
    pool: State<'_, SessionPool>,
    endpoint_id: String,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<(), SessionError> {
    let mut operation = diagnostics.operation(diagnostics::Event::EndpointClose, None);
    let result = pool.close_endpoint(&endpoint_id).await;
    operation.finish_session(&result);
    result
}

/// Inspect only bounded local manifest metadata; never extract or download.
#[tauri::command]
async fn modpack_preview(
    file: String,
) -> Result<modpack_preview::ModpackPreview, modpack_preview::PreviewError> {
    tauri::async_runtime::spawn_blocking(move || modpack_preview::preview(&file))
        .await
        .map_err(|_| modpack_preview::PreviewError {
            code: "MODPACK_PREVIEW_READ_FAILED",
        })?
}

const INSTALL_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

struct CompactEventForwarder {
    enabled: bool,
    pending_progress: Option<SessionEvent>,
    last_progress: Instant,
}

impl CompactEventForwarder {
    fn new(enabled: bool) -> Self {
        Self {
            enabled,
            pending_progress: None,
            last_progress: Instant::now()
                .checked_sub(INSTALL_PROGRESS_INTERVAL)
                .unwrap_or_else(Instant::now),
        }
    }

    fn push(&mut self, event: SessionEvent, mut send: impl FnMut(SessionEvent)) {
        if !self.enabled {
            send(event);
            return;
        }
        if is_core_event(&event, "file") {
            return;
        }
        if is_core_event(&event, "progress") {
            if self.last_progress.elapsed() >= INSTALL_PROGRESS_INTERVAL {
                self.pending_progress = None;
                self.last_progress = Instant::now();
                send(event);
            } else {
                self.pending_progress = Some(event);
            }
            return;
        }
        self.flush(&mut send);
        send(event);
    }

    fn flush(&mut self, mut send: impl FnMut(SessionEvent)) {
        if let Some(event) = self.pending_progress.take() {
            self.last_progress = Instant::now();
            send(event);
        }
    }
}

fn is_core_event(event: &SessionEvent, kind: &str) -> bool {
    matches!(
        event,
        SessionEvent::Event(value)
            if value.get("event").and_then(Value::as_str) == Some(kind)
    )
}

/// Run one RPC request. Progress events stream through `events`;
/// the returned value is the terminal `result`.
#[tauri::command]
async fn core_request(
    activation: State<'_, pack_activation::PackActivationState>,
    pool: State<'_, SessionPool>,
    session_id: u64,
    method: String,
    params: Option<Value>,
    events: Channel<SessionEvent>,
    compact_events: Option<bool>,
    curseforge: Option<bool>,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<Value, SessionError> {
    let mut operation = diagnostics.operation(diagnostics::Event::CoreRequest, Some(&method));
    let result = async {
        let _activation_guard = activation.requests.read().await;
        let session = pool
            .get(session_id)
            .await
            .ok_or_else(|| SessionError::coded("SESSION_CLOSED", "This session is closed."))?;
        let mut params = params.unwrap_or_else(|| json!({}));
        let enabled = curseforge.unwrap_or(false);
        curseforge::validate_injection(&method, &params, enabled)?;
        let key = if enabled {
            curseforge::preflight_version_change(&session, &method, &params).await?;
            Some(curseforge::required_key().await?)
        } else {
            None
        };
        if let Some(key) = &key {
            params["api_key"] = Value::String(key.clone());
        }
        let mut forwarder = CompactEventForwarder::new(compact_events.unwrap_or(false));
        let mut on_event = |event| {
            let event = match &key {
                Some(key) => curseforge::scrub_event(event, key),
                None => Some(event),
            };
            if let Some(event) = event {
                forwarder.push(event, |event| {
                    let _ = events.send(event);
                });
            }
        };
        let result = if enabled {
            session
                .request_credentialed(&method, params, &mut on_event)
                .await
        } else {
            session.request(&method, params, &mut on_event).await
        };
        forwarder.flush(|event| {
            let _ = events.send(event);
        });
        if let Some(key) = key {
            // Credential-bearing sessions cannot be reused. Reap the child and its
            // diagnostic tail before releasing the in-memory secret.
            pool.close(session_id).await;
            match result {
                Ok(mut value) => {
                    curseforge::scrub_value(&mut value, &key);
                    Ok(value)
                }
                Err(error) => Err(curseforge::scrub_error(error, &key)),
            }
        } else {
            result
        }
    }
    .await;
    operation.finish_session(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: &str, completed: u64) -> SessionEvent {
        SessionEvent::Event(json!({
            "event": kind,
            "progress": {"files_completed": completed}
        }))
    }

    #[test]
    fn compact_install_events_drop_files_and_keep_latest_progress() {
        let mut forwarder = CompactEventForwarder::new(true);
        let mut output = Vec::new();
        forwarder.push(event("file", 0), |event| output.push(event));
        forwarder.push(event("progress", 1), |event| output.push(event));
        forwarder.push(event("progress", 2), |event| output.push(event));
        forwarder.flush(|event| output.push(event));

        assert_eq!(output.len(), 2);
        let SessionEvent::Event(last) = &output[1] else {
            panic!("expected progress event");
        };
        assert_eq!(last.pointer("/progress/files_completed"), Some(&json!(2)));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdateState::default())
        .manage(pack_activation::PackActivationState::default())
        .setup(|app| {
            // Core children run with the app-data dir as CWD so the core's
            // CWD-relative defaults (e.g. the `accounts` registry, contract
            // §6) live under app data instead of polluting the repo in dev
            // or failing from Finder's "/" CWD in production.
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data dir unavailable: {e}"))?;
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("cannot create app data dir: {e}"))?;
            let diagnostics = diagnostics::Diagnostics::start(dir.join("diagnostics"));
            diagnostics.event(diagnostics::Event::AppStarted);
            app.manage(diagnostics);
            app.manage(SessionPool::new(Some(dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_target,
            diagnostics::diagnostics_status,
            diagnostics::diagnostics_set_enabled,
            diagnostics::diagnostics_read,
            diagnostics::diagnostics_clear,
            diagnostics::diagnostics_export,
            diagnostics::diagnostics_record,
            updater::updater_status,
            updater::updater_action,
            modpack_preview,
            core_open,
            endpoint_session_open,
            core_close,
            endpoint_sessions_close,
            core_request,
            pack_activation::pack_activation_read,
            pack_activation::pack_activation_write,
            pack_activation::shader_activation_read,
            pack_activation::shader_activation_write,
            curseforge::curseforge_key_status,
            curseforge::curseforge_key_set,
            curseforge::curseforge_key_delete,
            curseforge::curseforge_catalog,
            credentials::credential_set,
            credentials::credential_get,
            credentials::credential_delete,
            server_status_cache::server_status_cache_read,
            server_status_cache::server_status_cache_write,
            endpoints::endpoint_config_read,
            endpoints::endpoint_config_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<diagnostics::Diagnostics>()
                    .event(diagnostics::Event::AppStopped);
                // Kill every core child before the process exits.
                let pool = app.state::<SessionPool>();
                tauri::async_runtime::block_on(pool.clear());
            }
        });
}
