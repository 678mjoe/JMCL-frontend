//! JMCL GUI: Tauri bridge to `jmcl-core` JSON Lines RPC sessions.

mod integrated_qa;
mod general_preview;
#[cfg(all(windows, feature = "experimental-general-gui-test"))]
mod windows_general;
mod login_test_policy;
pub mod credentials;
pub mod curseforge;
pub mod diagnostics;
pub mod endpoints;
pub mod modpack_preview;
pub mod pack_activation;
mod play_freshness;
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
    if cfg!(feature = "experimental-gui-preview") {
        return Err(SessionError::coded("PREVIEW_SSH_DISABLED", "SSH is disabled in the Rust GUI test."));
    }
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
    app: tauri::AppHandle,
    activation: State<'_, pack_activation::PackActivationState>,
    profile: State<'_, login_test_policy::Profile>,
    pool: State<'_, SessionPool>,
    session_id: u64,
    method: String,
    params: Option<Value>,
    events: Channel<SessionEvent>,
    compact_events: Option<bool>,
    curseforge: Option<bool>,
    diagnostics: State<'_, diagnostics::Diagnostics>,
) -> Result<Value, SessionError> {
    let profile = *profile.inner();
    let params = params.unwrap_or_else(|| json!({}));
    let enabled = curseforge.unwrap_or(false);
    let general = profile == login_test_policy::Profile::General;
    let authenticated_play = profile.uses_fresh_play() && method == "launch.execute"
        && !(if general { general_preview::offline(&params) } else { integrated_qa::has_offline_auth(&params) });
    let version = if general && authenticated_play {
        params.get("id").and_then(Value::as_str).map(str::to_owned)
    } else { None };
    if authenticated_play && enabled {
        return Err(play_freshness::denied());
    }
    let mut params = if general {
        if enabled {
            return Err(SessionError::coded("PREVIEW_OPERATION_DISABLED", "CurseForge is disabled."));
        }
        if method == "server.list" {
            return Err(SessionError::coded("UNSUPPORTED_PLATFORM", "Servers are disabled in this Rust test."));
        }
        if login_test_policy::protected_method(&method) {
            if !login_test_policy::allows(profile, &method, &params, false) {
                return Err(SessionError::coded("PREVIEW_OPERATION_DISABLED", "Microsoft operation is unavailable."));
            }
            params
        } else {
            app.try_state::<general_preview::Scope>()
                .ok_or_else(play_freshness::denied)?.authorize(&method, params)?
        }
    } else if authenticated_play {
        // Shape and witness are both checked against a live integrated session below.
        params
    } else if matches!(profile, login_test_policy::Profile::IntegratedOffline | login_test_policy::Profile::IntegratedMicrosoft) {
        app.try_state::<integrated_qa::Scope>()
            .ok_or_else(|| SessionError::coded("QA_OPERATION_DISABLED", "Integrated QA fixture is unbound."))?
            .authorize(profile, &method, params, enabled)?
    } else {
        if !login_test_policy::allows(profile, &method, &params, enabled) {
            return Err(SessionError::coded("PREVIEW_OPERATION_DISABLED", "This operation is disabled by the Rust GUI test profile."));
        }
        params
    };
    let mut operation = diagnostics.operation(diagnostics::Event::CoreRequest, Some(&method));
    let result = async {
        let _activation_guard = activation.requests.read().await;
        let session = pool
            .get(session_id)
            .await
            .ok_or_else(|| SessionError::coded("SESSION_CLOSED", "This session is closed."))?;
        let dispatch_admission = if authenticated_play {
            let shared = app.try_state::<play_freshness::PlayFreshness>().ok_or_else(play_freshness::denied)?;
            let mut proof = shared.try_lock()?;
            let deadline = if general {
                proof.consume(params.get("auth"), Instant::now()).ok_or_else(play_freshness::denied)?
            } else {
                let scope = app.try_state::<integrated_qa::Scope>().ok_or_else(play_freshness::denied)?;
                let (projected, deadline) = scope.authenticated_launch(profile, params, &mut proof, Instant::now())?;
                params = projected;
                deadline
            };
            Some((deadline, proof))
        } else {
            // Explicit offline Play deauthorizes any unused Microsoft witness.
            if profile.uses_fresh_play() && method == "launch.execute" {
                let shared = app.try_state::<play_freshness::PlayFreshness>().ok_or_else(play_freshness::denied)?;
                shared.try_lock()?.clear();
            }
            None
        };

        let mut freshness = if profile.uses_fresh_play()
            && (method == play_freshness::REFRESH || play_freshness::invalidates(&method))
        {
            let shared = app.try_state::<play_freshness::PlayFreshness>().ok_or_else(play_freshness::denied)?;
            let mut state = shared.try_lock()?;
            if method == play_freshness::REFRESH {
                state.begin_refresh(Instant::now())?;
            } else {
                state.clear();
            }
            Some(state)
        } else {
            None
        };
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
            if profile.mute_events()
                && (!general || authenticated_play || login_test_policy::protected_method(&method)
                    || matches!(&event, SessionEvent::Diagnostic(_))) {
                if authenticated_play {
                    if let Some(safe) = play_freshness::safe_started(&event) {
                        let _ = events.send(safe);
                    }
                }
                return;
            }
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
        } else if let Some((deadline, admission_guard)) = dispatch_admission {
            session.request_before(&method, params, &mut on_event, deadline, move || drop(admission_guard)).await
        } else {
            session.request(&method, params, &mut on_event).await
        };
        if method == play_freshness::REFRESH {
            if let (Some(state), Ok(value)) = (&mut freshness, &result) {
                state.observe_terminal(value, Instant::now());
            }
        }
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
    let result = if authenticated_play {
        if let Some(version) = version.as_deref() {
            play_freshness::safe_terminal_for(result, version)
        } else {
            play_freshness::safe_terminal(result)
        }
    } else if profile.restricted_microsoft()
        && login_test_policy::protected_method(&method)
    {
        result
            .and_then(|value| login_test_policy::sanitize_result(&method, value))
            .map_err(login_test_policy::safe_error)
    } else {
        result
    };
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
    let context = tauri::generate_context!();
    let config = context.config();
    use login_test_policy::{Profile, MICROSOFT_TEST_BINARY, MICROSOFT_TEST_PRODUCT, MICROSOFT_TEST_WEBVIEW};
    let preview = cfg!(feature = "experimental-gui-preview");
    let microsoft = cfg!(feature = "experimental-microsoft-login-test");
    let integrated = cfg!(feature = "experimental-integrated-gui-test");
    let profile = if integrated {
        assert!(!cfg!(debug_assertions), "integrated QA requires a release build");
        integrated_qa::select(preview, microsoft, &config.identifier, std::env::args_os().skip(1))
    } else {
        Profile::select(preview, microsoft, &config.identifier)
    }
    .expect("invalid JMCL GUI test identity or launch intent");
    let general = profile == Profile::General;
    let app_identifier = config.identifier.clone();
    if preview {
        let (product, binary) = if integrated {
            (integrated_qa::PRODUCT, integrated_qa::BINARY)
        } else if general {
            (general_preview::PRODUCT, general_preview::BINARY)
        } else if microsoft {
            (MICROSOFT_TEST_PRODUCT, MICROSOFT_TEST_BINARY)
        } else {
            ("JMCL Rust GUI Test", "jmcl-rust-gui-test")
        };
        assert_eq!(config.product_name.as_deref(), Some(product));
        assert_eq!(config.main_binary_name.as_deref(), Some(binary));
        assert_eq!(config.bundle.create_updater_artifacts, tauri::utils::config::Updater::Bool(false));
        assert!(update_config::compiled().is_none());
        assert_eq!(config.app.windows.len(), 1);
        let window = &config.app.windows[0];
        assert!(!window.create);
        if microsoft && !(general && cfg!(windows)) {
            assert!(!tauri::is_dev(), "Microsoft test requires embedded release assets");
            assert!(cfg!(all(target_os = "macos", target_arch = "aarch64")));
            assert!(config.app.app_directories_override.is_none());
            // The packaged Info.plist and Mach-O, not the embedded runtime context, carry the OS minimum.
            assert_eq!(window.label, "main");
            assert!(window.data_store_identifier.is_none());
            assert!(window.data_directory.is_none() && !window.incognito);
        }
        if integrated || general {
            assert!(!tauri::is_dev());
            assert!(config.app.app_directories_override.is_none());
            assert_eq!(window.devtools, Some(false));
            assert!(!window.drag_drop_enabled);
        }
        #[cfg(windows)]
        assert_eq!(window.data_directory.as_deref(), Some(std::path::Path::new(
            if general { "jmcl-rust-general-win-x64-profile-v1" } else { "jmcl-rust-gui-test-profile-v1" })));
    }
    let builder = tauri::Builder::default().manage(profile);
    let builder = if general {
        builder.plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
            .plugin(tauri_plugin_dialog::init())
    } else if !integrated {
        builder
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
    } else if profile == Profile::IntegratedMicrosoft {
        builder.plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
    } else {
        builder
    };
    let builder = builder
        .manage(updater::UpdateState::default())
        .manage(pack_activation::PackActivationState::default())
        .setup(move |app| {
            // Core children run with the app-data dir as CWD so the core's
            // CWD-relative defaults (e.g. the `accounts` registry, contract
            // §6) live under app data instead of polluting the repo in dev
            // or failing from Finder's "/" CWD in production.
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data dir unavailable: {e}"))?;
            #[cfg(all(windows, feature = "experimental-general-gui-test"))]
            if general { windows_general::check_roaming_root(&dir)?; }
            if preview {
                assert_eq!(dir.file_name().and_then(|name| name.to_str()), Some(app_identifier.as_str()));
                let roots = ["instances", "store", "servers", "diagnostics"]
                    .into_iter().chain(profile.restricted_microsoft().then_some("accounts"));
                for path in std::iter::once(dir.clone()).chain(roots.map(|name| dir.join(name))) {
                    match path.symlink_metadata() {
                        Ok(meta) if !meta.file_type().is_dir() => return Err("Rust GUI test data path is not an ordinary directory".into()),
                        Ok(_) => (),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                        Err(e) => return Err(e.into()),
                    }
                }
            }
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("cannot create app data dir: {e}"))?;
            let diagnostics = diagnostics::Diagnostics::start(dir.join("diagnostics"));
            diagnostics.event(diagnostics::Event::AppStarted);
            app.manage(diagnostics);
            if integrated {
                app.manage(integrated_qa::Scope::bind(&dir)?);
                if profile == Profile::IntegratedMicrosoft {
                    app.manage(play_freshness::PlayFreshness::default());
                }
            }
            if general {
                app.manage(general_preview::Scope::bind(&dir)?);
                app.manage(play_freshness::PlayFreshness::default());
            }
            app.manage(SessionPool::new(Some(dir)));
            if preview {
                let window = &app.config().app.windows[0];
                let builder = tauri::WebviewWindowBuilder::from_config(app, window)?;
                #[cfg(target_os = "macos")]
                let builder = builder.data_store_identifier(if integrated {
                    integrated_qa::WEBVIEW
                } else if general {
                    general_preview::WEBVIEW
                } else if microsoft {
                    MICROSOFT_TEST_WEBVIEW
                } else {
                    [100, 225, 237, 75, 104, 231, 70, 250, 179, 100, 74, 2, 225, 20, 187, 42]
                });
                #[cfg(all(windows, feature = "experimental-general-gui-test"))]
                let builder = if general {
                    let profile = windows_general::profile_path(&app.path().app_local_data_dir()?)?;
                    builder.data_directory(profile)
                } else { builder };
                #[cfg(any(feature = "experimental-integrated-gui-test", feature = "experimental-general-gui-test"))]
                let builder = builder
                    .on_navigation(move |url| if general { general_preview::app_url(url) } else { integrated_qa::app_url(url) })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_download(|_, _| false);
                builder.build()?;
            }
            Ok(())
        });
    let builder = match profile {
        Profile::General => builder.invoke_handler(tauri::generate_handler![
            runtime_target, core_open, core_close, core_request,
            diagnostics::diagnostics_status, diagnostics::diagnostics_record,
            integrated_qa::qa_open_microsoft_link,
            endpoints::endpoint_config_read, server_status_cache::server_status_cache_read,
            credentials::credential_set, credentials::credential_get, credentials::credential_delete
        ]),
        Profile::IntegratedOffline => builder.invoke_handler(tauri::generate_handler![
            runtime_target,
            diagnostics::diagnostics_status,
            diagnostics::diagnostics_record,
            core_open,
            core_close,
            core_request,
            integrated_qa::qa_intent,
            integrated_qa::qa_endpoint_config_read,
            integrated_qa::qa_server_status_cache_read
        ]),
        Profile::IntegratedMicrosoft => builder.invoke_handler(tauri::generate_handler![
            runtime_target,
            diagnostics::diagnostics_status,
            diagnostics::diagnostics_record,
            core_open,
            core_close,
            core_request,
            integrated_qa::qa_intent,
            integrated_qa::qa_endpoint_config_read,
            integrated_qa::qa_server_status_cache_read,
            integrated_qa::qa_open_microsoft_link,
            credentials::credential_set,
            credentials::credential_get,
            credentials::credential_delete
        ]),
        _ => builder.invoke_handler(tauri::generate_handler![
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
        ]),
    };
    builder
        .build(context)
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
