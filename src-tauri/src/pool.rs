//! Registry of live sessions. The GUI opens extra sessions for concurrency
//! (contract §1: operations on different instance directories are
//! independent; never mutate the same instance from two sessions at once).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::endpoints::{read_endpoint_config_strict_from_dir, Endpoint};
use crate::session::{CoreIdentity, Session, SessionError};
use crate::ssh_transport::{system_ssh_executable, SshProcessTransport};
use crate::transport::{resolve_core_binary, LocalProcessTransport};

/// What the GUI learns when a session opens.
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: u64,
    pub core: CoreIdentity,
}

#[derive(Default)]
pub struct SessionPool {
    sessions: Mutex<HashMap<u64, Arc<Session>>>,
    next_id: AtomicU64,
    /// CWD for spawned core children; `None` inherits the app's CWD.
    working_dir: Option<PathBuf>,
}

impl SessionPool {
    pub fn new(working_dir: Option<PathBuf>) -> Self {
        Self {
            working_dir,
            ..Self::default()
        }
    }

    /// Spawn a core process and open a session on it.
    pub async fn open(&self, binary_path: Option<&str>) -> Result<SessionInfo, SessionError> {
        let binary = resolve_core_binary(binary_path).map_err(SessionError::transport)?;
        let transport =
            LocalProcessTransport::spawn(&binary, &["rpc"], self.working_dir.as_deref())
                .await
                .map_err(SessionError::transport)?;
        let session = Session::establish(Box::new(transport)).await?;
        let info = SessionInfo {
            session_id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            core: session.identity().clone(),
        };
        self.sessions
            .lock()
            .await
            .insert(info.session_id, Arc::new(session));
        Ok(info)
    }

    /// Open a new session for a persisted SSH endpoint. The executable seam is
    /// only exposed to Rust tests; production passes no path and resolves the
    /// system OpenSSH client from inherited PATH.
    pub async fn open_endpoint(&self, endpoint_id: &str) -> Result<SessionInfo, SessionError> {
        self.open_endpoint_with_executable(endpoint_id, None).await
    }

    #[doc(hidden)]
    pub async fn open_endpoint_with_executable(
        &self,
        endpoint_id: &str,
        executable: Option<&Path>,
    ) -> Result<SessionInfo, SessionError> {
        self.open_endpoint_with_env(endpoint_id, executable, std::iter::empty::<(&str, &str)>())
            .await
    }

    #[doc(hidden)]
    pub async fn open_endpoint_with_env<'a>(
        &self,
        endpoint_id: &str,
        executable: Option<&Path>,
        extra_env: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<SessionInfo, SessionError> {
        self.open_endpoint_with_timeout(endpoint_id, executable, extra_env, Duration::from_secs(15))
            .await
    }

    #[doc(hidden)]
    pub async fn open_endpoint_with_timeout<'a>(
        &self,
        endpoint_id: &str,
        executable: Option<&Path>,
        extra_env: impl IntoIterator<Item = (&'a str, &'a str)>,
        handshake_timeout: Duration,
    ) -> Result<SessionInfo, SessionError> {
        let app_data_dir = self.working_dir.as_deref().ok_or_else(|| {
            SessionError::coded(
                "ENDPOINT_CONFIG_INVALID",
                "The endpoint configuration is unavailable.",
            )
        })?;
        let config = read_endpoint_config_strict_from_dir(app_data_dir).map_err(|_| {
            SessionError::coded(
                "ENDPOINT_CONFIG_INVALID",
                "The saved endpoint configuration could not be read.",
            )
        })?;
        let endpoint = config
            .endpoints
            .iter()
            .find(|endpoint| match endpoint {
                Endpoint::Local { id, .. } | Endpoint::Ssh { id, .. } => id == endpoint_id,
            })
            .ok_or_else(|| {
                SessionError::coded("ENDPOINT_NOT_FOUND", "The saved endpoint no longer exists.")
            })?;
        let destination = match endpoint {
            Endpoint::Ssh { destination, .. } => destination,
            Endpoint::Local { .. } => {
                return Err(SessionError::coded(
                    "ENDPOINT_KIND_UNSUPPORTED",
                    "This endpoint uses the local transport.",
                ))
            }
        };
        let started = std::time::Instant::now();
        let executable = executable.unwrap_or_else(|| Path::new(system_ssh_executable()));
        let transport = SshProcessTransport::spawn_with_env(executable, destination, extra_env)
            .await
            .map_err(SessionError::from_transport)?;
        let remaining = handshake_timeout.saturating_sub(started.elapsed());
        let session = Session::establish_with_timeout(Box::new(transport), remaining).await?;
        self.insert_established(session).await
    }

    async fn insert_established(&self, session: Session) -> Result<SessionInfo, SessionError> {
        let info = SessionInfo {
            session_id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            core: session.identity().clone(),
        };
        self.sessions
            .lock()
            .await
            .insert(info.session_id, Arc::new(session));
        Ok(info)
    }

    pub async fn get(&self, session_id: u64) -> Option<Arc<Session>> {
        self.sessions.lock().await.get(&session_id).cloned()
    }

    /// Close and remove a session; unknown ids are a no-op.
    pub async fn close(&self, session_id: u64) {
        if let Some(session) = self.sessions.lock().await.remove(&session_id) {
            session.close().await;
        }
    }

    /// Drop every session, killing its core process (app shutdown).
    pub async fn clear(&self) {
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, session)| session)
            .collect();
        for session in &sessions {
            session.signal_close();
        }
        for session in sessions {
            session.close().await;
        }
    }
}
