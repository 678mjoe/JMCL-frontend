#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use jmcl_lib::endpoints::{Endpoint, EndpointConfigV1};
use jmcl_lib::pool::SessionPool;
use jmcl_lib::session::{Session, SessionError};
use jmcl_lib::ssh_transport::{build_ssh_argv, SshProcessTransport};
use jmcl_lib::transport::LineTransport;
use serde_json::json;

#[test]
fn ssh_argv_is_exact_and_has_one_immutable_remote_command() {
    let argv = build_ssh_argv("fake-host");
    assert_eq!(
        argv,
        vec![
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
            "fake-host",
            "exec jmcl-core rpc",
        ]
    );
    assert_eq!(argv.last().unwrap(), "exec jmcl-core rpc");
    assert!(!argv
        .iter()
        .any(|arg| arg == "-n" || arg.contains("StrictHostKeyChecking=no")));
}

struct TempFiles(PathBuf);
impl TempFiles {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "jmcl-fake-ssh-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for TempFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-ssh")
}

fn write_config(tmp: &TempFiles, destination: &str) {
    let config = EndpointConfigV1 {
        version: 1,
        endpoints: vec![
            Endpoint::Local {
                id: "local".into(),
                label: "Local".into(),
            },
            Endpoint::Ssh {
                id: "123e4567-e89b-42d3-a456-426614174000".into(),
                label: "Fake test endpoint".into(),
                destination: destination.into(),
                servers_directory: None,
            },
        ],
    };
    std::fs::write(
        tmp.path("endpoints.v1.json"),
        serde_json::to_vec(&config).unwrap(),
    )
    .unwrap();
}

async fn spawn_fake<'a>(tmp: &'a TempFiles, mode: &'a str) -> SshProcessTransport {
    let argv = tmp.path("argv");
    let pid = tmp.path("pid");
    SshProcessTransport::spawn_with_env(
        &fixture(),
        "fake-host",
        [
            ("FAKE_SSH_MODE", mode),
            ("FAKE_SSH_ARGV_FILE", argv.to_str().unwrap()),
            ("FAKE_SSH_PID_FILE", pid.to_str().unwrap()),
        ],
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn fake_process_receives_exact_tokens_and_handshakes() {
    let tmp = TempFiles::new();
    let transport = spawn_fake(&tmp, "valid").await;
    let session = Session::establish(Box::new(transport)).await.unwrap();
    assert_eq!(
        session.request("ping", json!({}), |_| {}).await.unwrap(),
        json!({"pong": true})
    );
    session.close().await;
    let args: Vec<_> = std::fs::read_to_string(tmp.path("argv"))
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    assert_eq!(args, build_ssh_argv("fake-host"));
    assert_eq!(
        args.iter()
            .filter(|arg| arg.as_str() == "exec jmcl-core rpc")
            .count(),
        1
    );
    assert_eq!(args.last().unwrap(), "exec jmcl-core rpc");
}

#[tokio::test]
async fn valid_crlf_stdout_lines_are_accepted() {
    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "crlf").await))
        .await
        .unwrap();
    assert_eq!(
        session.request("ping", json!({}), |_| {}).await.unwrap(),
        json!({"pong": true})
    );
    session.close().await;
}

#[tokio::test]
async fn stderr_flood_is_drained_and_never_reaches_events_or_errors() {
    let tmp = TempFiles::new();
    let mut transport = spawn_fake(&tmp, "stderr").await;
    transport
        .write_line(r#"{"protocol":1,"id":"req-0","method":"core.version","params":{}}"#)
        .await
        .unwrap();
    assert!(matches!(
        transport.next_event().await,
        jmcl_lib::transport::TransportEvent::Line(_)
    ));
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        transport.diagnostic_tail_len(),
        jmcl_lib::ssh_transport::MAX_DIAGNOSTIC_TAIL
    );
    transport
        .write_line(r#"{"protocol":1,"id":"req-1","method":"ping","params":{}}"#)
        .await
        .unwrap();
    assert!(matches!(
        transport.next_event().await,
        jmcl_lib::transport::TransportEvent::Line(_)
    ));
    transport.abort().await.unwrap();
}

#[tokio::test]
async fn known_ssh_failures_are_typed_and_redacted() {
    let cases = [
        ("host_unknown", "SSH_HOST_KEY_UNKNOWN"),
        ("host_changed", "SSH_HOST_KEY_CHANGED"),
        ("auth", "SSH_AUTH_REQUIRED_OR_FAILED"),
        ("remote_failed", "SSH_REMOTE_COMMAND_FAILED"),
        ("generic_failed", "SSH_CONNECTION_FAILED"),
    ];
    for (mode, code) in cases {
        let tmp = TempFiles::new();
        let transport = spawn_fake(&tmp, mode).await;
        let error = match Session::establish(Box::new(transport)).await {
            Ok(_) => panic!("expected failure"),
            Err(error) => error,
        };
        let SessionError::Transport {
            code: actual,
            message,
        } = error
        else {
            panic!("expected transport error")
        };
        assert_eq!(actual, code, "mode={mode}: {message}");
        assert!(!message.contains("DESTINATION_SECRET"));
        let serialized = serde_json::to_string(&SessionError::coded(actual, message)).unwrap();
        assert!(!serialized.contains("synthetic"));
        assert!(!serialized.contains("fake-host"));
    }
}

#[tokio::test]
async fn malformed_stdout_and_later_disconnect_have_ssh_codes() {
    let tmp = TempFiles::new();
    let error = match Session::establish(Box::new(spawn_fake(&tmp, "malformed").await)).await {
        Ok(_) => panic!("expected malformed stream failure"),
        Err(error) => error,
    };
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_PROTOCOL_ERROR"));

    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "disconnect").await))
        .await
        .unwrap();
    let error = session
        .request("ping", json!({}), |_| {})
        .await
        .unwrap_err();
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_DISCONNECTED"));
}

#[tokio::test]
async fn stdout_eof_with_live_child_returns_safe_disconnect_and_reaps_child() {
    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "stdout_close_alive").await))
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(
        Duration::from_millis(500),
        session.request("ping", json!({}), |_| {}),
    )
    .await;
    let elapsed = started.elapsed();
    let error = result.expect("request must finish promptly").unwrap_err();
    session.close().await;

    let SessionError::Transport { code, message } = error else {
        panic!("expected transport error")
    };
    assert_eq!(code, "SSH_DISCONNECTED");
    assert!(elapsed <= Duration::from_millis(500));
    let serialized = serde_json::to_string(&SessionError::coded(code, message)).unwrap();
    assert!(!serialized.contains("DESTINATION_SECRET"));
    assert!(!serialized.contains("fake-host"));
    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn malformed_identity_uses_ssh_protocol_code() {
    let tmp = TempFiles::new();
    let error = Session::establish(Box::new(spawn_fake(&tmp, "malformed_identity").await))
        .await
        .err()
        .unwrap();
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_PROTOCOL_ERROR"));
}

#[tokio::test]
async fn null_id_error_is_fixed_and_redacted() {
    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "null_error").await))
        .await
        .unwrap();
    let error = session
        .request("ping", json!({}), |_| {})
        .await
        .unwrap_err();
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_PROTOCOL_ERROR"));
    assert!(!serialized.contains("DESTINATION_SECRET"));
}

#[tokio::test]
async fn partial_stdout_at_eof_is_protocol_corruption_and_reaped() {
    for attempt in 0..20 {
        let tmp = TempFiles::new();
        let error = Session::establish(Box::new(spawn_fake(&tmp, "partial_stdout").await))
            .await
            .err()
            .unwrap();
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(
            matches!(&error, SessionError::Transport { code, .. } if code == "SSH_PROTOCOL_ERROR"),
            "attempt {attempt}: {error}"
        );
        assert!(!serialized.contains("DESTINATION_SECRET"));
        assert!(!serialized.contains("partial protocol marker"));
        let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists(),
            "attempt {attempt}: child {pid} remains"
        );
    }
}

#[tokio::test]
async fn oversized_stdout_is_protocol_corruption_and_reaped() {
    let tmp = TempFiles::new();
    let error = tokio::time::timeout(
        Duration::from_secs(3),
        Session::establish(Box::new(spawn_fake(&tmp, "oversized_stdout").await)),
    )
    .await
    .expect("oversized line is rejected promptly")
    .err()
    .unwrap();
    let serialized = serde_json::to_string(&error).unwrap();
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_PROTOCOL_ERROR"));
    assert!(!serialized.contains('M'));
    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn stdout_flood_is_bounded_and_cancellable() {
    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "flood").await))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), session.close())
        .await
        .expect("bounded reader backpressure must remain cancellable");
    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn close_after_natural_exit_does_not_wait_for_blocked_stdout_sender() {
    let tmp = TempFiles::new();
    let session = Session::establish(Box::new(spawn_fake(&tmp, "flood_exit").await))
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_millis(500), session.close())
        .await
        .expect("close must abort a stdout sender blocked on the bounded channel");

    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn unsupported_protocol_is_preserved_as_its_own_code() {
    let tmp = TempFiles::new();
    let error = match Session::establish(Box::new(spawn_fake(&tmp, "wrong_protocol").await)).await {
        Ok(_) => panic!("expected protocol mismatch"),
        Err(error) => error,
    };
    assert!(
        matches!(error, SessionError::Transport { code, .. } if code == "UNSUPPORTED_PROTOCOL")
    );
    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn cancelling_hung_fake_ssh_kills_only_its_child() {
    let first_files = TempFiles::new();
    let second_files = TempFiles::new();
    let first = std::sync::Arc::new(
        Session::establish(Box::new(spawn_fake(&first_files, "never_request").await))
            .await
            .unwrap(),
    );
    let second = Session::establish(Box::new(spawn_fake(&second_files, "valid").await))
        .await
        .unwrap();
    let request_session = first.clone();
    let request =
        tokio::spawn(async move { request_session.request("hang", json!({}), |_| {}).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    tokio::time::timeout(Duration::from_millis(300), first.close())
        .await
        .expect("close cancels hung request");
    assert!(request.await.unwrap().is_err());
    assert_eq!(
        second.request("ping", json!({}), |_| {}).await.unwrap(),
        json!({"pong": true})
    );
    second.close().await;
    let first_pid: i32 = std::fs::read_to_string(first_files.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let second_pid: i32 = std::fs::read_to_string(second_files.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!std::path::Path::new(&format!("/proc/{first_pid}")).exists());
    assert!(!std::path::Path::new(&format!("/proc/{second_pid}")).exists());
}

#[tokio::test]
async fn pool_inserts_only_established_endpoint_and_unknown_close_is_noop() {
    let tmp = TempFiles::new();
    write_config(&tmp, "fake-host");
    let pool = SessionPool::new(Some(tmp.0.clone()));
    let info = pool
        .open_endpoint_with_env(
            "123e4567-e89b-42d3-a456-426614174000",
            Some(&fixture()),
            [
                ("FAKE_SSH_MODE", "valid"),
                ("FAKE_SSH_ARGV_FILE", tmp.path("argv").to_str().unwrap()),
                ("FAKE_SSH_PID_FILE", tmp.path("pid").to_str().unwrap()),
            ],
        )
        .await
        .unwrap();
    assert_eq!(info.core.protocol, 1);
    assert!(pool.get(info.session_id).await.is_some());
    pool.close(u64::MAX).await;
    assert!(pool.get(info.session_id).await.is_some());
    pool.close(info.session_id).await;
    assert!(pool.get(info.session_id).await.is_none());
}

#[tokio::test]
async fn endpoint_open_reports_safe_not_found_kind_and_config_codes() {
    let tmp = TempFiles::new();
    write_config(&tmp, "fake-host");
    let pool = SessionPool::new(Some(tmp.0.clone()));
    let missing = pool
        .open_endpoint_with_executable("missing", Some(&fixture()))
        .await
        .unwrap_err();
    assert!(
        matches!(missing, SessionError::Transport { code, .. } if code == "ENDPOINT_NOT_FOUND")
    );
    let local = pool
        .open_endpoint_with_executable("local", Some(&fixture()))
        .await
        .unwrap_err();
    assert!(
        matches!(local, SessionError::Transport { code, .. } if code == "ENDPOINT_KIND_UNSUPPORTED")
    );
    std::fs::write(tmp.path("endpoints.v1.json"), b"{corrupt").unwrap();
    let corrupt = pool
        .open_endpoint_with_executable("local", Some(&fixture()))
        .await
        .unwrap_err();
    assert!(
        matches!(corrupt, SessionError::Transport { code, .. } if code == "ENDPOINT_CONFIG_INVALID")
    );
}

#[tokio::test]
async fn handshake_timeout_kills_child_and_does_not_insert_session() {
    let tmp = TempFiles::new();
    write_config(&tmp, "fake-host");
    let pool = SessionPool::new(Some(tmp.0.clone()));
    let error = pool
        .open_endpoint_with_timeout(
            "123e4567-e89b-42d3-a456-426614174000",
            Some(&fixture()),
            [
                ("FAKE_SSH_MODE", "delayed"),
                ("FAKE_SSH_ARGV_FILE", tmp.path("argv").to_str().unwrap()),
                ("FAKE_SSH_PID_FILE", tmp.path("pid").to_str().unwrap()),
            ],
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, SessionError::Transport { code, .. } if code == "SSH_TIMEOUT"));
    assert!(pool.get(1).await.is_none());
    let pid: i32 = std::fs::read_to_string(tmp.path("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
}

#[tokio::test]
async fn pool_clear_cancels_live_requests_before_removing_sessions() {
    let tmp = TempFiles::new();
    write_config(&tmp, "fake-host");
    let pool = std::sync::Arc::new(SessionPool::new(Some(tmp.0.clone())));
    let info = pool
        .open_endpoint_with_env(
            "123e4567-e89b-42d3-a456-426614174000",
            Some(&fixture()),
            [
                ("FAKE_SSH_MODE", "never_request"),
                ("FAKE_SSH_ARGV_FILE", tmp.path("argv").to_str().unwrap()),
                ("FAKE_SSH_PID_FILE", tmp.path("pid").to_str().unwrap()),
            ],
        )
        .await
        .unwrap();
    let session = pool.get(info.session_id).await.unwrap();
    let request = tokio::spawn(async move { session.request("hang", json!({}), |_| {}).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    tokio::time::timeout(Duration::from_millis(300), pool.clear())
        .await
        .expect("pool clear closes active sessions");
    assert!(request.await.unwrap().is_err());
    assert!(pool.get(info.session_id).await.is_none());
}
