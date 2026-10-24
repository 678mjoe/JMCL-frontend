//! Narrow native updater bridge. Webviews cannot supply endpoints, keys or bytes.
use crate::{pool::SessionPool, update_config};
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Unconfigured,
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Downloaded,
    Installing,
    Installed,
    Error,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Check,
    Download,
    Install,
    Discard,
    Restart,
}

fn allowed(phase: Phase, action: Action) -> bool {
    matches!(
        (phase, action),
        (Phase::Idle | Phase::Current | Phase::Error, Action::Check)
            | (Phase::Available, Action::Download)
            | (Phase::Downloaded, Action::Install)
            | (
                Phase::Available | Phase::Downloaded | Phase::Error,
                Action::Discard
            )
            | (Phase::Installed, Action::Restart)
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    phase: Phase,
    channel: Option<String>,
    version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<&'static str>,
}
struct Inner {
    snapshot: Snapshot,
    update: Option<tauri_plugin_updater::Update>,
    bytes: Option<Vec<u8>>,
}
pub struct UpdateState {
    operation: tokio::sync::Mutex<()>,
    inner: Mutex<Inner>,
}
impl Default for UpdateState {
    fn default() -> Self {
        let config = update_config::compiled();
        Self {
            operation: tokio::sync::Mutex::new(()),
            inner: Mutex::new(Inner {
                snapshot: Snapshot {
                    phase: if config.is_some() {
                        Phase::Idle
                    } else {
                        Phase::Unconfigured
                    },
                    channel: config.map(|c| c.channel),
                    version: None,
                    downloaded: 0,
                    total: None,
                    error: None,
                },
                update: None,
                bytes: None,
            }),
        }
    }
}
impl UpdateState {
    fn snapshot(&self) -> Result<Snapshot, &'static str> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "updater unavailable")?
            .snapshot
            .clone())
    }
    fn phase(&self, phase: Phase) -> Result<(), &'static str> {
        self.inner
            .lock()
            .map_err(|_| "updater unavailable")?
            .snapshot
            .phase = phase;
        Ok(())
    }
    fn fail(&self, code: &'static str) -> Result<Snapshot, &'static str> {
        let mut inner = self.inner.lock().map_err(|_| "updater unavailable")?;
        inner.update = None;
        inner.bytes = None;
        inner.snapshot.phase = Phase::Error;
        inner.snapshot.error = Some(code);
        inner.snapshot.version = None;
        inner.snapshot.downloaded = 0;
        inner.snapshot.total = None;
        Ok(inner.snapshot.clone())
    }
}

#[tauri::command]
pub fn updater_status(state: State<'_, UpdateState>) -> Result<Snapshot, &'static str> {
    state.snapshot()
}

#[tauri::command]
pub async fn updater_action(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
    action: Action,
) -> Result<Snapshot, &'static str> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "updater operation in progress")?;
    let config = update_config::compiled().ok_or("updater is not configured in this build")?;
    if !allowed(state.snapshot()?.phase, action) {
        return Err("invalid updater transition");
    }
    match action {
        Action::Check => {
            {
                let mut inner = state.inner.lock().map_err(|_| "updater unavailable")?;
                inner.update = None;
                inner.bytes = None;
                inner.snapshot.error = None;
                inner.snapshot.phase = Phase::Checking;
            }
            let result = async {
                let updater = app
                    .updater_builder()
                    .pubkey(config.public_key)
                    .endpoints(vec![config.endpoint])?
                    .timeout(Duration::from_secs(60))
                    .restart_after_install(false)
                    // Enforce HTTPS on redirects too, including debug builds.
                    .configure_client(|client| client.https_only(true))
                    .build()?;
                updater.check().await
            }
            .await;
            match result {
                Ok(mut update) => {
                    if update.as_ref().is_some_and(|u| {
                        update_config::secure_url(u.download_url.as_str()).is_err()
                    }) {
                        return state.fail("unsafeDownloadUrl");
                    }
                    if let Some(update) = &mut update {
                        // Plugin check timeout is not copied into Update::timeout.
                        update.timeout = Some(Duration::from_secs(600));
                    }
                    let mut inner = state.inner.lock().map_err(|_| "updater unavailable")?;
                    inner.snapshot.phase = if update.is_some() {
                        Phase::Available
                    } else {
                        Phase::Current
                    };
                    inner.snapshot.version = update.as_ref().map(|u| u.version.clone());
                    inner.update = update;
                }
                Err(_) => return state.fail("checkFailed"),
            }
        }
        Action::Download => {
            let update = state
                .inner
                .lock()
                .map_err(|_| "updater unavailable")?
                .update
                .clone();
            let Some(update) = update else {
                return state.fail("missingUpdate");
            };
            state.phase(Phase::Downloading)?;
            // The plugin verifies the signature before returning these in-memory bytes.
            // No cancellation is claimed: discard is available after completion only.
            let result = update
                .download(
                    |chunk, total| {
                        if let Ok(mut inner) = state.inner.lock() {
                            inner.snapshot.downloaded =
                                inner.snapshot.downloaded.saturating_add(chunk as u64);
                            inner.snapshot.total = total;
                        }
                    },
                    || {},
                )
                .await;
            match result {
                Ok(bytes) => {
                    let mut inner = state.inner.lock().map_err(|_| "updater unavailable")?;
                    inner.bytes = Some(bytes);
                    inner.snapshot.phase = Phase::Downloaded;
                }
                Err(_) => return state.fail("downloadOrSignatureFailed"),
            }
        }
        Action::Install => {
            let resources = {
                let mut inner = state.inner.lock().map_err(|_| "updater unavailable")?;
                inner.update.take().zip(inner.bytes.take())
            };
            let Some((update, bytes)) = resources else {
                return state.fail("missingUpdate");
            };
            // Fail before interrupting any sessions if in-memory bytes no longer verify.
            if update.verify(&bytes).is_err() {
                return state.fail("downloadOrSignatureFailed");
            }
            state.phase(Phase::Installing)?;
            // Windows may exit inside install(), bypassing the normal exit event.
            // The explicit install confirmation warns that active tasks are stopped.
            app.state::<SessionPool>().clear().await;
            let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
            match result {
                Ok(Ok(())) => state.phase(Phase::Installed)?,
                _ => return state.fail("installFailed"),
            }
        }
        Action::Discard => {
            let mut inner = state.inner.lock().map_err(|_| "updater unavailable")?;
            inner.update = None;
            inner.bytes = None;
            inner.snapshot.phase = Phase::Idle;
            inner.snapshot.version = None;
            inner.snapshot.error = None;
            inner.snapshot.downloaded = 0;
            inner.snapshot.total = None;
        }
        Action::Restart => {
            app.state::<SessionPool>().clear().await;
            app.restart();
        }
    }
    state.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_plugin_parses_required_security_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let plugin: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        assert!(plugin.require_signed_version);
        assert!(!plugin.allow_downgrades);
        assert!(!plugin.dangerous_insecure_transport_protocol);
        assert!(!plugin.dangerous_accept_invalid_certs);
        assert!(!plugin.dangerous_accept_invalid_hostnames);
        assert!(plugin.endpoints.is_empty());
        assert!(plugin.pubkey.is_empty());
    }
    #[test]
    fn install_requires_verified_download_and_restart_requires_install() {
        for phase in [
            Phase::Unconfigured,
            Phase::Idle,
            Phase::Checking,
            Phase::Current,
            Phase::Available,
            Phase::Downloading,
            Phase::Installing,
            Phase::Error,
        ] {
            assert!(!allowed(phase, Action::Install));
            assert!(!allowed(phase, Action::Restart));
        }
        assert!(allowed(Phase::Downloaded, Action::Install));
        assert!(allowed(Phase::Installed, Action::Restart));
    }
    #[test]
    fn busy_operations_cannot_repeat_or_claim_cancel() {
        for phase in [
            Phase::Unconfigured,
            Phase::Checking,
            Phase::Downloading,
            Phase::Installing,
        ] {
            for action in [
                Action::Check,
                Action::Download,
                Action::Install,
                Action::Discard,
                Action::Restart,
            ] {
                assert!(!allowed(phase, action));
            }
        }
        assert!(allowed(Phase::Error, Action::Check));
        assert!(allowed(Phase::Available, Action::Discard));
        assert!(allowed(Phase::Downloaded, Action::Discard));
    }
    #[test]
    fn operation_gate_and_failure_clear_resources_and_progress() {
        let state = UpdateState::default();
        let guard = state.operation.try_lock().unwrap();
        assert!(state.operation.try_lock().is_err());
        drop(guard);
        assert!(state.operation.try_lock().is_ok());
        state.inner.lock().unwrap().bytes = Some(vec![1, 2, 3]);
        state.fail("downloadOrSignatureFailed").unwrap();
        let inner = state.inner.lock().unwrap();
        assert!(inner.bytes.is_none());
        assert!(inner.update.is_none());
        assert_eq!(inner.snapshot.phase, Phase::Error);
        assert_eq!(inner.snapshot.downloaded, 0);
    }
}
