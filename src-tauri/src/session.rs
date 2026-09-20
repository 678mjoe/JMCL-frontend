//! Protocol v1 session state machine on top of a [`LineTransport`].
//!
//! Protocol v1 is synchronous: one request in flight per session. A request
//! holds the transport lock for its whole lifetime, so concurrent callers
//! queue naturally. Use multiple sessions (see `pool`) for real concurrency.

use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::transport::{LineTransport, TransportEvent};

/// Wire protocol version this GUI speaks (contract §2).
pub const PROTOCOL_VERSION: u32 = 1;
/// Maximum request line size accepted by the core.
pub const MAX_REQUEST_LINE: usize = 64 * 1024;

/// Non-terminal items surfaced to the GUI while a request runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum SessionEvent {
    /// A core progress/lifecycle event (`started`, `progress`, `file`,
    /// `retry`, `stdout`, `stderr`, ...), forwarded verbatim.
    Event(Value),
    /// A core stderr diagnostics line.
    Diagnostic(String),
}

/// Why a request failed. Serializes to the GUI as `{kind, ...}`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionError {
    /// The core rejected the request; `code` is a stable contract code.
    Rpc { code: String, message: String },
    /// Session/transport failure: spawn, write, EOF, protocol violation.
    Transport { message: String },
}

impl SessionError {
    pub fn transport(message: impl Into<String>) -> Self {
        Self::Transport {
            message: message.into(),
        }
    }
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rpc { code, message } => write!(f, "{code}: {message}"),
            Self::Transport { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for SessionError {}

/// `core.version` handshake result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreIdentity {
    pub name: String,
    pub version: String,
    pub protocol: u64,
}

/// One synchronous RPC session with a core endpoint.
pub struct Session {
    transport: Mutex<Box<dyn LineTransport>>,
    sequence: AtomicU64,
    closed: AtomicBool,
    identity: CoreIdentity,
}

impl Session {
    /// Establish a session: wrap the transport and run the `core.version`
    /// handshake, rejecting incompatible protocol versions (contract §3).
    pub async fn establish(transport: Box<dyn LineTransport>) -> Result<Self, SessionError> {
        let mut session = Self {
            transport: Mutex::new(transport),
            sequence: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            identity: CoreIdentity {
                name: String::new(),
                version: String::new(),
                protocol: 0,
            },
        };
        let result = session.request("core.version", json!({}), |_| {}).await?;
        let identity: CoreIdentity = serde_json::from_value(result)
            .map_err(|e| SessionError::transport(format!("malformed core.version result: {e}")))?;
        if identity.protocol != u64::from(PROTOCOL_VERSION) {
            return Err(SessionError::transport(format!(
                "core speaks protocol {}, GUI requires {} — core/GUI version mismatch",
                identity.protocol, PROTOCOL_VERSION
            )));
        }
        session.identity = identity;
        Ok(session)
    }

    pub fn identity(&self) -> &CoreIdentity {
        &self.identity
    }

    /// Send one request and wait for its terminal event. Progress events and
    /// diagnostics are passed to `on_event` as they arrive.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        mut on_event: impl FnMut(SessionEvent),
    ) -> Result<Value, SessionError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(SessionError::transport("session is closed"));
        }
        // Held for the whole request: protocol v1 allows one request at a
        // time per session, so concurrent callers queue here.
        let mut transport = self.transport.lock().await;

        let id = format!("req-{}", self.sequence.fetch_add(1, Ordering::Relaxed));
        let line = json!({
            "protocol": PROTOCOL_VERSION,
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        if line.len() > MAX_REQUEST_LINE {
            return Err(SessionError::transport(format!(
                "request exceeds {MAX_REQUEST_LINE} bytes"
            )));
        }
        transport
            .write_line(&line)
            .await
            .map_err(SessionError::transport)?;

        loop {
            match transport.next_event().await {
                TransportEvent::Line(line) => {
                    let event: Value = serde_json::from_str(&line).map_err(|e| {
                        SessionError::transport(format!("core emitted invalid JSON: {e}"))
                    })?;
                    let event_id = event.get("id").and_then(Value::as_str);
                    let kind = event
                        .get("event")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if event_id != Some(id.as_str()) {
                        // `id: null` errors flag malformed requests; our
                        // serializer never produces them, so seeing one means
                        // a contract drift. Anything else with a foreign id is
                        // a v1 violation — neither belongs to this request.
                        if kind == "error" && event_id.is_none() {
                            let message = event
                                .pointer("/error/message")
                                .and_then(Value::as_str)
                                .unwrap_or("malformed request rejected by core");
                            return Err(SessionError::transport(message));
                        }
                        continue;
                    }
                    match kind {
                        "result" => return Ok(event.get("result").cloned().unwrap_or(Value::Null)),
                        "error" => {
                            let code = event
                                .pointer("/error/code")
                                .and_then(Value::as_str)
                                .unwrap_or("UNKNOWN")
                                .to_string();
                            let message = event
                                .pointer("/error/message")
                                .and_then(Value::as_str)
                                .unwrap_or("core error")
                                .to_string();
                            return Err(SessionError::Rpc { code, message });
                        }
                        "" => {
                            return Err(SessionError::transport(
                                "core event missing \"event\" field",
                            ))
                        }
                        _ => on_event(SessionEvent::Event(event)),
                    }
                }
                TransportEvent::Diagnostic(line) => on_event(SessionEvent::Diagnostic(line)),
                TransportEvent::Closed(reason) => {
                    self.closed.store(true, Ordering::SeqCst);
                    return Err(SessionError::transport(format!(
                        "core session ended: {reason}"
                    )));
                }
            }
        }
    }

    /// Half-close the request stream; an in-flight request finishes first.
    pub async fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let mut transport = self.transport.lock().await;
        let _ = transport.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_events_use_lowercase_wire_discriminators() {
        let event = serde_json::to_value(SessionEvent::Event(json!({
            "event": "progress"
        })))
        .unwrap();
        let diagnostic =
            serde_json::to_value(SessionEvent::Diagnostic("line".to_string())).unwrap();

        assert_eq!(event["kind"], "event");
        assert_eq!(diagnostic["kind"], "diagnostic");
    }
}
