//! Registry of live sessions. The GUI opens extra sessions for concurrency
//! (contract §1: operations on different instance directories are
//! independent; never mutate the same instance from two sessions at once).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::session::{CoreIdentity, Session, SessionError};
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
}

impl SessionPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a core process and open a session on it.
    pub async fn open(&self, binary_path: Option<&str>) -> Result<SessionInfo, SessionError> {
        let binary = resolve_core_binary(binary_path).map_err(SessionError::transport)?;
        let transport = LocalProcessTransport::spawn(&binary, &["rpc"])
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
        self.sessions.lock().await.clear();
    }
}
