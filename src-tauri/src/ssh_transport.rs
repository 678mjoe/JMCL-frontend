//! System OpenSSH transport for one remote `jmcl-core rpc` process.

use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

use crate::endpoints::validate_destination;
use crate::transport::{LineTransport, TransportEvent, TransportFailure};

const REMOTE_RPC_COMMAND: &str = "exec jmcl-core rpc";
pub const MAX_DIAGNOSTIC_TAIL: usize = 32 * 1024;
/// Maximum SSH stdout JSON line size, excluding its newline. Two MiB leaves
/// room for the documented server log/RCON payloads plus JSON framing while
/// keeping each remote line allocation strictly bounded.
pub const MAX_SSH_STDOUT_LINE_BYTES: usize = 2 * 1024 * 1024;
const SSH_STDOUT_EVENT_CAPACITY: usize = 8;
const SSH_REAP_GRACE: Duration = Duration::from_millis(100);
const SSH_KILL_REAP_GRACE: Duration = Duration::from_secs(1);
/// Give an EOF reader one bounded scheduling window to record protocol
/// corruption before cleanup aborts a sender blocked on the bounded channel.
const SSH_STDOUT_SETTLE_GRACE: Duration = Duration::from_millis(100);

/// Build the full OpenSSH argument list. The destination is validated as one
/// token and the remote command is a private fixed constant.
pub fn build_ssh_argv(destination: &str) -> Vec<String> {
    vec![
        "-T".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        destination.into(),
        REMOTE_RPC_COMMAND.into(),
    ]
}

#[cfg(windows)]
pub fn system_ssh_executable() -> &'static str {
    "ssh.exe"
}
#[cfg(not(windows))]
pub fn system_ssh_executable() -> &'static str {
    "ssh"
}

#[derive(Debug)]
enum ReaderEvent {
    Line(String),
    Eof,
    ReadError,
    ProtocolCorruption,
}

enum BoundedLine {
    Line(Vec<u8>),
    Eof,
    PartialEof,
    ReadError,
    TooLong,
}

async fn read_bounded_line<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R) -> BoundedLine {
    let mut bytes = Vec::with_capacity(8 * 1024);
    loop {
        let available = match reader.fill_buf().await {
            Ok(available) if available.is_empty() => {
                return if bytes.is_empty() {
                    BoundedLine::Eof
                } else {
                    BoundedLine::PartialEof
                };
            }
            Ok(available) => available,
            Err(_) => return BoundedLine::ReadError,
        };
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if bytes.len().saturating_add(newline) > MAX_SSH_STDOUT_LINE_BYTES {
                return BoundedLine::TooLong;
            }
            bytes.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return BoundedLine::Line(bytes);
        }
        if bytes.len().saturating_add(available.len()) > MAX_SSH_STDOUT_LINE_BYTES {
            return BoundedLine::TooLong;
        }
        let length = available.len();
        bytes.extend_from_slice(available);
        reader.consume(length);
    }
}

/// A child-owned SSH stdin/stdout channel. Raw stderr is retained only in a
/// bounded private tail for classification and is never emitted to callers.
pub struct SshProcessTransport {
    stdin: Option<ChildStdin>,
    rx: mpsc::Receiver<ReaderEvent>,
    child: Child,
    stdout_reader: Option<JoinHandle<()>>,
    stderr_tail: Arc<Mutex<VecDeque<u8>>>,
    stderr_reader: Option<JoinHandle<()>>,
    protocol_corruption: Arc<AtomicBool>,
    terminal: bool,
}

impl SshProcessTransport {
    pub async fn spawn(executable: &Path, destination: &str) -> Result<Self, TransportFailure> {
        Self::spawn_with_env(executable, destination, std::iter::empty::<(&str, &str)>()).await
    }

    /// Internal process seam used by deterministic fake executable tests.
    #[doc(hidden)]
    pub async fn spawn_with_env<'a>(
        executable: &Path,
        destination: &str,
        extra_env: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<Self, TransportFailure> {
        let destination = validate_destination(destination).map_err(|_| {
            TransportFailure::new(
                "ENDPOINT_CONFIG_INVALID",
                "The saved SSH destination is invalid.",
            )
        })?;
        let argv = build_ssh_argv(&destination);
        let mut command = Command::new(executable);
        command
            .args(&argv)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.envs(extra_env);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                TransportFailure::new("SSH_EXECUTABLE_NOT_FOUND", "OpenSSH was not found on PATH. Install or enable the system OpenSSH client.")
            } else {
                TransportFailure::new("SSH_CONNECTION_FAILED", "OpenSSH could not start a connection. Check the system SSH installation and endpoint configuration.")
            }
        })?;
        let stdin = child.stdin.take().expect("SSH stdin is piped");
        let stdout = child.stdout.take().expect("SSH stdout is piped");
        let stderr = child.stderr.take().expect("SSH stderr is piped");
        let (tx, rx) = mpsc::channel(SSH_STDOUT_EVENT_CAPACITY);
        let stdout_tx = tx.clone();
        let protocol_corruption = Arc::new(AtomicBool::new(false));
        let reader_protocol_corruption = protocol_corruption.clone();
        let stdout_reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_bounded_line(&mut reader).await {
                    BoundedLine::Eof => {
                        let _ = stdout_tx.send(ReaderEvent::Eof).await;
                        break;
                    }
                    BoundedLine::Line(bytes) => {
                        let line = String::from_utf8_lossy(&bytes).into_owned();
                        if stdout_tx.send(ReaderEvent::Line(line)).await.is_err() {
                            break;
                        }
                    }
                    BoundedLine::PartialEof | BoundedLine::TooLong => {
                        reader_protocol_corruption.store(true, Ordering::SeqCst);
                        let _ = stdout_tx.send(ReaderEvent::ProtocolCorruption).await;
                        break;
                    }
                    BoundedLine::ReadError => {
                        let _ = stdout_tx.send(ReaderEvent::ReadError).await;
                        break;
                    }
                }
            }
        });
        let tail = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_DIAGNOSTIC_TAIL)));
        let stderr_tail = tail.clone();
        let stderr_reader = tokio::spawn(async move {
            let mut reader = stderr;
            let mut buffer = [0u8; 4096];
            while let Ok(count) = reader.read(&mut buffer).await {
                if count == 0 {
                    break;
                }
                let mut tail = stderr_tail.lock().unwrap_or_else(|e| e.into_inner());
                for byte in &buffer[..count] {
                    if tail.len() == MAX_DIAGNOSTIC_TAIL {
                        tail.pop_front();
                    }
                    tail.push_back(*byte);
                }
            }
        });
        Ok(Self {
            stdin: Some(stdin),
            rx,
            child,
            stdout_reader: Some(stdout_reader),
            stderr_tail: tail,
            stderr_reader: Some(stderr_reader),
            protocol_corruption,
            terminal: false,
        })
    }

    pub fn diagnostic_tail_len(&self) -> usize {
        self.stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len()
    }

    fn classified_failure(&self, status: Option<std::process::ExitStatus>) -> TransportFailure {
        let mut tail = self.stderr_tail.lock().unwrap_or_else(|e| e.into_inner());
        let diagnostic = String::from_utf8_lossy(tail.make_contiguous()).to_ascii_lowercase();
        classify_ssh_failure(&diagnostic, status.is_some_and(|s| !s.success()))
    }

    /// Stop stdout delivery once cleanup no longer needs protocol lines. The
    /// sender may be blocked on the bounded event channel, so abort it before
    /// joining rather than waiting for the receiver to drain queued lines.
    async fn stop_stdout_reader(&mut self) {
        if let Some(reader) = self.stdout_reader.take() {
            reader.abort();
            let _ = reader.await;
        }
    }

    async fn settle_or_stop_stdout_reader(&mut self) {
        if let Some(mut reader) = self.stdout_reader.take() {
            if timeout(SSH_STDOUT_SETTLE_GRACE, &mut reader).await.is_err() {
                reader.abort();
                let _ = reader.await;
            }
        }
    }

    async fn reap_and_classify(&mut self) -> TransportFailure {
        if self.terminal {
            return TransportFailure::new("SSH_DISCONNECTED", "The SSH connection is closed.");
        }
        self.stdin.take();
        let (status, forced_kill) = match timeout(SSH_REAP_GRACE, self.child.wait()).await {
            Ok(Ok(status)) => (Some(status), false),
            Ok(Err(_)) | Err(_) => {
                let _ = self.child.start_kill();
                (
                    timeout(SSH_KILL_REAP_GRACE, self.child.wait())
                        .await
                        .ok()
                        .and_then(Result::ok),
                    true,
                )
            }
        };
        self.settle_or_stop_stdout_reader().await;
        if let Some(reader) = self.stderr_reader.take() {
            if status.is_some() {
                let _ = reader.await;
            } else {
                reader.abort();
                let _ = reader.await;
            }
        }
        self.terminal = status.is_some();
        let failure = if self.protocol_corruption.load(Ordering::SeqCst) {
            protocol_corruption_failure()
        } else if forced_kill {
            // A closed stdout pipe is the only evidence of failure here. A
            // killed child has a nonzero status by construction, so do not
            // turn that cleanup status into a generic connection failure.
            // Host-key and authentication diagnostics remain useful typed
            // classifications even when SSH itself needed to be reaped.
            self.classified_failure(None)
        } else {
            self.classified_failure(status)
        };
        self.stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        failure
    }

    async fn write_failure(&mut self) -> TransportFailure {
        if self.protocol_corruption.load(Ordering::SeqCst) {
            let _ = self.abort().await;
            return protocol_corruption_failure();
        }
        // The writer and stdout reader race when the remote closes its
        // channel. Use the same bounded, idempotent reaper in either case so
        // a failed write cannot leave the SSH child or reader tasks behind.
        self.reap_and_classify().await
    }
}

fn protocol_corruption_failure() -> TransportFailure {
    TransportFailure::new(
        "SSH_PROTOCOL_ERROR",
        "The SSH endpoint sent an invalid RPC line.",
    )
}

pub fn classify_ssh_failure(stderr: &str, nonzero: bool) -> TransportFailure {
    let text = stderr.to_ascii_lowercase();
    if text.contains("remote host identification has changed")
        || text.contains("offending ") && text.contains(" key in ")
    {
        return TransportFailure::new(
            "SSH_HOST_KEY_CHANGED",
            "The SSH host key changed. Inspect your known_hosts entry before connecting.",
        );
    }
    if text.contains("no ") && text.contains(" host key is known") {
        return TransportFailure::new(
            "SSH_HOST_KEY_UNKNOWN",
            "The SSH host key is not verified. Verify it and add it to known_hosts with OpenSSH.",
        );
    }
    if text.contains("permission denied (publickey")
        || text.contains("no supported authentication methods")
        || text.contains("read_passphrase")
    {
        return TransportFailure::new("SSH_AUTH_REQUIRED_OR_FAILED", "SSH authentication failed or requires interaction. Configure a key or unlock your system SSH agent.");
    }
    if nonzero
        && (text.contains("jmcl-core: command not found") || text.contains("exec request failed"))
    {
        return TransportFailure::new("SSH_REMOTE_COMMAND_FAILED", "The remote jmcl-core rpc command failed. Check that jmcl-core is installed and available on the remote PATH.");
    }
    if nonzero {
        return TransportFailure::new(
            "SSH_CONNECTION_FAILED",
            "The SSH connection failed. Check the remote host, network, and OpenSSH configuration.",
        );
    }
    TransportFailure::new(
        "SSH_DISCONNECTED",
        "The SSH connection ended. Reconnect and check the remote host and network.",
    )
}

#[async_trait]
impl LineTransport for SshProcessTransport {
    async fn write_line(&mut self, line: &str) -> Result<(), TransportFailure> {
        let result = if let Some(stdin) = self.stdin.as_mut() {
            async {
                stdin.write_all(line.as_bytes()).await?;
                stdin.write_all(b"\n").await?;
                stdin.flush().await
            }
            .await
        } else {
            return Err(TransportFailure::new(
                "SSH_DISCONNECTED",
                "The SSH connection is closed.",
            ));
        };
        match result {
            Ok(()) => Ok(()),
            Err(_) => Err(self.write_failure().await),
        }
    }

    async fn next_event(&mut self) -> TransportEvent {
        match self.rx.recv().await {
            Some(ReaderEvent::Line(line)) => TransportEvent::Line(line),
            Some(ReaderEvent::ProtocolCorruption) => {
                let _ = self.abort().await;
                TransportEvent::Closed(protocol_corruption_failure())
            }
            Some(ReaderEvent::Eof) | Some(ReaderEvent::ReadError) | None => {
                let error = self.reap_and_classify().await;
                TransportEvent::Closed(error)
            }
        }
    }

    async fn close(&mut self) -> Result<(), TransportFailure> {
        if self.terminal {
            return Ok(());
        }
        self.stdin.take();
        match timeout(Duration::from_secs(1), self.child.wait()).await {
            Ok(Ok(_)) => {
                self.stop_stdout_reader().await;
                if let Some(reader) = self.stderr_reader.take() {
                    let _ = reader.await;
                }
                self.terminal = true;
            }
            Ok(Err(_)) | Err(_) => self.abort().await?,
        }
        // Raw diagnostics are discarded as soon as the process is closed.
        self.stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        Ok(())
    }

    async fn abort(&mut self) -> Result<(), TransportFailure> {
        if self.terminal {
            return Ok(());
        }
        self.stdin.take();
        let _ = self.child.start_kill();
        let reaped = matches!(
            timeout(SSH_KILL_REAP_GRACE, self.child.wait()).await,
            Ok(Ok(_))
        );
        self.stop_stdout_reader().await;
        if let Some(reader) = self.stderr_reader.take() {
            if reaped {
                let _ = reader.await;
            } else {
                reader.abort();
                let _ = reader.await;
            }
        }
        self.stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.terminal = reaped;
        Ok(())
    }

    fn protocol_error_code(&self) -> &'static str {
        "SSH_PROTOCOL_ERROR"
    }
}

impl Drop for SshProcessTransport {
    fn drop(&mut self) {
        if !self.terminal {
            let _ = self.child.start_kill();
        }
        self.stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}
