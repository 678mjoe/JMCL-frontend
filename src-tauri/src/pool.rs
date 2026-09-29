//! Registry of live sessions. The GUI opens extra sessions for concurrency
//! (contract §1: operations on different instance directories are
//! independent; never mutate the same instance from two sessions at once).

use std::collections::{HashMap, HashSet};
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
struct PoolState {
    sessions: HashMap<u64, Arc<Session>>,
    owners: HashMap<u64, String>,
    endpoint_sessions: HashMap<String, HashSet<u64>>,
    endpoint_generations: HashMap<String, u64>,
}

#[derive(Default)]
pub struct SessionPool {
    state: Mutex<PoolState>,
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
        self.insert_established(session, "local").await
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
        validate_endpoint_id(endpoint_id)?;
        // Capture before reading configuration or starting SSH so deletion can
        // invalidate every open already in flight, including handshakes.
        let endpoint_generation = {
            let state = self.state.lock().await;
            *state.endpoint_generations.get(endpoint_id).unwrap_or(&0)
        };
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
        self.insert_established_if_current(session, endpoint_id, endpoint_generation)
            .await
    }

    async fn insert_established(
        &self,
        session: Session,
        endpoint_id: &str,
    ) -> Result<SessionInfo, SessionError> {
        let info = SessionInfo {
            session_id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            core: session.identity().clone(),
        };
        let mut state = self.state.lock().await;
        state.sessions.insert(info.session_id, Arc::new(session));
        state.owners.insert(info.session_id, endpoint_id.to_owned());
        state
            .endpoint_sessions
            .entry(endpoint_id.to_owned())
            .or_default()
            .insert(info.session_id);
        Ok(info)
    }

    async fn insert_established_if_current(
        &self,
        session: Session,
        endpoint_id: &str,
        captured_generation: u64,
    ) -> Result<SessionInfo, SessionError> {
        let mut state = self.state.lock().await;
        let current_generation = *state.endpoint_generations.get(endpoint_id).unwrap_or(&0);
        if current_generation != captured_generation {
            drop(state);
            session.close().await;
            return Err(SessionError::coded(
                "ENDPOINT_NOT_FOUND",
                "The saved endpoint no longer exists.",
            ));
        }
        let info = SessionInfo {
            session_id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            core: session.identity().clone(),
        };
        state.sessions.insert(info.session_id, Arc::new(session));
        state.owners.insert(info.session_id, endpoint_id.to_owned());
        state
            .endpoint_sessions
            .entry(endpoint_id.to_owned())
            .or_default()
            .insert(info.session_id);
        Ok(info)
    }

    pub async fn get(&self, session_id: u64) -> Option<Arc<Session>> {
        self.state.lock().await.sessions.get(&session_id).cloned()
    }

    /// Close and remove a session; unknown ids are a no-op.
    pub async fn close(&self, session_id: u64) {
        let session = {
            let mut state = self.state.lock().await;
            let session = state.sessions.remove(&session_id);
            if let Some(endpoint_id) = state.owners.remove(&session_id) {
                if let Some(ids) = state.endpoint_sessions.get_mut(&endpoint_id) {
                    ids.remove(&session_id);
                    if ids.is_empty() {
                        state.endpoint_sessions.remove(&endpoint_id);
                    }
                }
            }
            session
        };
        if let Some(session) = session {
            session.close().await;
        }
    }

    /// Close every SSH session owned by one endpoint. Local sessions are
    /// intentionally protected from endpoint deletion cleanup.
    pub async fn close_endpoint(&self, endpoint_id: &str) -> Result<(), SessionError> {
        validate_endpoint_id(endpoint_id)?;
        if endpoint_id == "local" {
            return Err(SessionError::coded(
                "ENDPOINT_KIND_UNSUPPORTED",
                "This endpoint uses the local transport.",
            ));
        }
        let sessions = {
            let mut state = self.state.lock().await;
            let generation = state
                .endpoint_generations
                .entry(endpoint_id.to_owned())
                .or_default();
            *generation = generation.wrapping_add(1);
            let ids = state
                .endpoint_sessions
                .remove(endpoint_id)
                .unwrap_or_default();
            ids.into_iter()
                .filter_map(|id| {
                    state.owners.remove(&id);
                    state.sessions.remove(&id)
                })
                .collect::<Vec<_>>()
        };
        for session in &sessions {
            session.signal_close();
        }
        for session in sessions {
            session.close().await;
        }
        Ok(())
    }

    #[doc(hidden)]
    pub async fn endpoint_session_ids(&self, endpoint_id: &str) -> Vec<u64> {
        let state = self.state.lock().await;
        let mut ids = state
            .endpoint_sessions
            .get(endpoint_id)
            .into_iter()
            .flatten()
            .copied()
            .collect::<Vec<_>>();
        ids.sort_unstable();
        ids
    }

    /// Drop every session, killing its core process (app shutdown).
    pub async fn clear(&self) {
        let sessions: Vec<_> = {
            let mut state = self.state.lock().await;
            state.owners.clear();
            state.endpoint_sessions.clear();
            state.sessions.drain().map(|(_, session)| session).collect()
        };
        for session in &sessions {
            session.signal_close();
        }
        for session in sessions {
            session.close().await;
        }
    }
}

fn validate_endpoint_id(endpoint_id: &str) -> Result<(), SessionError> {
    let bytes = endpoint_id.as_bytes();
    let valid = bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        })
        && matches!(bytes[14], b'1'..=b'5')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b');
    if endpoint_id != "local" && !valid {
        return Err(SessionError::coded(
            "ENDPOINT_ID_INVALID",
            "The endpoint id is invalid.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{LineTransport, TransportEvent, TransportFailure};
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Mutex as StdMutex;
    use tokio::sync::Notify;

    struct TestTransport {
        pending: StdMutex<Option<String>>,
        closes: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl LineTransport for TestTransport {
        async fn write_line(&mut self, line: &str) -> Result<(), TransportFailure> {
            let request: serde_json::Value = serde_json::from_str(line).unwrap();
            let id = request.get("id").and_then(|value| value.as_str()).unwrap();
            *self.pending.lock().unwrap() = Some(
                json!({
                    "id": id,
                    "event": "result",
                    "result": {"name": "fake-core", "version": "1", "protocol": 1}
                })
                .to_string(),
            );
            Ok(())
        }

        async fn next_event(&mut self) -> TransportEvent {
            TransportEvent::Line(self.pending.lock().unwrap().take().unwrap())
        }

        async fn close(&mut self) -> Result<(), TransportFailure> {
            self.closes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        async fn abort(&mut self) -> Result<(), TransportFailure> {
            Ok(())
        }
    }

    async fn session(closes: Arc<AtomicUsize>) -> Session {
        Session::establish(Box::new(TestTransport {
            pending: StdMutex::new(None),
            closes,
        }))
        .await
        .unwrap()
    }

    struct DelayedHandshakeTransport {
        entered: Arc<Notify>,
        release: Arc<Notify>,
        pending: StdMutex<Option<String>>,
        closes: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl LineTransport for DelayedHandshakeTransport {
        async fn write_line(&mut self, line: &str) -> Result<(), TransportFailure> {
            let request: serde_json::Value = serde_json::from_str(line).unwrap();
            let id = request.get("id").and_then(|value| value.as_str()).unwrap();
            self.entered.notify_one();
            self.release.notified().await;
            *self.pending.lock().unwrap() = Some(
                json!({
                    "id": id,
                    "event": "result",
                    "result": {"name": "fake-core", "version": "1", "protocol": 1}
                })
                .to_string(),
            );
            Ok(())
        }

        async fn next_event(&mut self) -> TransportEvent {
            TransportEvent::Line(self.pending.lock().unwrap().take().unwrap())
        }

        async fn close(&mut self) -> Result<(), TransportFailure> {
            self.closes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        async fn abort(&mut self) -> Result<(), TransportFailure> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn endpoint_index_tracks_independent_sessions_and_scoped_close() {
        let pool = SessionPool::default();
        let endpoint_a = "123e4567-e89b-42d3-a456-426614174000";
        let endpoint_b = "123e4567-e89b-42d3-a456-426614174001";
        let a_closes = Arc::new(AtomicUsize::new(0));
        let b_closes = Arc::new(AtomicUsize::new(0));
        let local_closes = Arc::new(AtomicUsize::new(0));
        let a1 = pool
            .insert_established(session(a_closes.clone()).await, endpoint_a)
            .await
            .unwrap();
        let a2 = pool
            .insert_established(session(a_closes.clone()).await, endpoint_a)
            .await
            .unwrap();
        let b1 = pool
            .insert_established(session(b_closes.clone()).await, endpoint_b)
            .await
            .unwrap();
        let local = pool
            .insert_established(session(local_closes.clone()).await, "local")
            .await
            .unwrap();
        assert_ne!(a1.session_id, a2.session_id);
        assert_eq!(
            pool.endpoint_session_ids(endpoint_a).await,
            vec![a1.session_id, a2.session_id]
        );

        pool.close(a1.session_id).await;
        assert!(pool.get(a1.session_id).await.is_none());
        assert!(pool.get(a2.session_id).await.is_some());
        assert_eq!(
            pool.endpoint_session_ids(endpoint_a).await,
            vec![a2.session_id]
        );
        assert_eq!(a_closes.load(Ordering::SeqCst), 1);

        pool.close_endpoint(endpoint_a).await.unwrap();
        assert!(pool.get(a2.session_id).await.is_none());
        assert!(pool.get(b1.session_id).await.is_some());
        assert!(pool.get(local.session_id).await.is_some());
        assert!(pool.endpoint_session_ids(endpoint_a).await.is_empty());
        assert_eq!(a_closes.load(Ordering::SeqCst), 2);
        assert_eq!(b_closes.load(Ordering::SeqCst), 0);
        assert_eq!(local_closes.load(Ordering::SeqCst), 0);

        pool.clear().await;
        pool.clear().await;
        assert!(pool.get(b1.session_id).await.is_none());
        assert_eq!(b_closes.load(Ordering::SeqCst), 1);
        assert_eq!(local_closes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn endpoint_group_close_rejects_local_and_malformed_ids() {
        assert!(validate_endpoint_id("local").is_ok());
        assert!(validate_endpoint_id("not-an-id").is_err());
        assert!(validate_endpoint_id("123e4567-e89b-42d3-a456-426614174000").is_ok());
    }

    #[tokio::test]
    async fn close_endpoint_rejects_and_reaps_a_session_whose_handshake_finishes_late() {
        let pool = Arc::new(SessionPool::default());
        let endpoint_id = "123e4567-e89b-42d3-a456-426614174000";
        let generation = *pool
            .state
            .lock()
            .await
            .endpoint_generations
            .get(endpoint_id)
            .unwrap_or(&0);
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let closes = Arc::new(AtomicUsize::new(0));
        let handshake = {
            let entered = entered.clone();
            let release = release.clone();
            let closes = closes.clone();
            tokio::spawn(async move {
                Session::establish(Box::new(DelayedHandshakeTransport {
                    entered,
                    release,
                    pending: StdMutex::new(None),
                    closes,
                }))
                .await
                .unwrap()
            })
        };
        entered.notified().await;
        pool.close_endpoint(endpoint_id).await.unwrap();
        release.notify_one();
        let session = handshake.await.unwrap();
        let result = pool
            .insert_established_if_current(session, endpoint_id, generation)
            .await;
        assert!(result.is_err());
        assert!(pool.endpoint_session_ids(endpoint_id).await.is_empty());
        assert_eq!(closes.load(Ordering::SeqCst), 1);
    }
}
