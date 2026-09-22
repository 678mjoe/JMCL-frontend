//! JMCL GUI: Tauri bridge to `jmcl-core` JSON Lines RPC sessions.

pub mod credentials;
pub mod pool;
pub mod server_status_cache;
pub mod session;
pub mod transport;

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{ipc::Channel, Manager, State};

use pool::SessionPool;
use session::{SessionError, SessionEvent};

/// Open a new RPC session; returns its id and the core's identity.
#[tauri::command]
async fn core_open(
    pool: State<'_, SessionPool>,
    binary_path: Option<String>,
) -> Result<pool::SessionInfo, SessionError> {
    pool.open(binary_path.as_deref()).await
}

/// Close a session. Unknown ids are a no-op.
#[tauri::command]
async fn core_close(pool: State<'_, SessionPool>, session_id: u64) -> Result<(), SessionError> {
    pool.close(session_id).await;
    Ok(())
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
    pool: State<'_, SessionPool>,
    session_id: u64,
    method: String,
    params: Option<Value>,
    events: Channel<SessionEvent>,
    compact_events: Option<bool>,
) -> Result<Value, SessionError> {
    let session = pool
        .get(session_id)
        .await
        .ok_or_else(|| SessionError::transport(format!("unknown session {session_id}")))?;
    let mut forwarder = CompactEventForwarder::new(compact_events.unwrap_or(false));
    let result = session
        .request(&method, params.unwrap_or_else(|| json!({})), |event| {
            forwarder.push(event, |event| {
                let _ = events.send(event);
            });
        })
        .await;
    forwarder.flush(|event| {
        let _ = events.send(event);
    });
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
            app.manage(SessionPool::new(Some(dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_open,
            core_close,
            core_request,
            credentials::credential_set,
            credentials::credential_get,
            credentials::credential_delete,
            server_status_cache::server_status_cache_read,
            server_status_cache::server_status_cache_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill every core child before the process exits.
                let pool = app.state::<SessionPool>();
                tauri::async_runtime::block_on(pool.clear());
            }
        });
}
