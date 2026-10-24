//! Opt-in local diagnostics. Only closed enums and bounded numbers cross the
//! persistence boundary; request payloads, errors, paths and console output do not.
//! A bounded, best-effort queue keeps disk I/O off RPC/transport reader tasks.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_BYTES: usize = 262_144;
const MAX_FILES: usize = 4;
const MAX_LINE: usize = 1024;
const MAX_RECORDS: usize = 4096;
const ERROR: &str = "Diagnostic storage is unavailable.";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    AppStarted,
    AppStopped,
    CoreOpen,
    EndpointOpen,
    CoreClose,
    EndpointClose,
    CoreRequest,
    FrontendReady,
    FrontendError,
    UnhandledRejection,
    BridgeError,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontendEvent {
    FrontendReady,
    FrontendError,
    UnhandledRejection,
    BridgeError,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Info,
    Error,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Ok,
    Error,
    Cancelled,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Core,
    Instance,
    Server,
    Content,
    Account,
    Auth,
    Java,
    Other,
}
// A closed wire-name vocabulary: unknown renderer method strings are never persisted.
macro_rules! operations {
    ($( $variant:ident => ($wire:literal, $family:ident) ),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, Serialize, Deserialize)]
        pub enum OperationName {
            $( #[serde(rename = $wire)] $variant, )+
            #[serde(rename = "other")] Other,
        }
        impl OperationName {
            fn classify(value: &str) -> Self { match value { $( $wire => Self::$variant, )+ _ => Self::Other } }
            fn family(self) -> Method { match self { $( Self::$variant => Method::$family, )+ Self::Other => Method::Other } }
        }
    };
}
operations! {
    AccountMicrosoftDelete => ("account.microsoft.delete", Account),
    AccountMicrosoftGet => ("account.microsoft.get", Account),
    AccountMicrosoftList => ("account.microsoft.list", Account),
    AccountMicrosoftSave => ("account.microsoft.save", Account),
    AuthMicrosoftDeviceBegin => ("auth.microsoft.device.begin", Auth),
    AuthMicrosoftDevicePoll => ("auth.microsoft.device.poll", Auth),
    AuthMicrosoftRefresh => ("auth.microsoft.refresh", Auth),
    AuthMinecraftExchange => ("auth.minecraft.exchange", Auth),
    AuthMinecraftRefresh_Exchange => ("auth.minecraft.refresh_exchange", Auth),
    CoreVersion => ("core.version", Core),
    DatapacksAdopt => ("datapacks.adopt", Content),
    DatapacksDisable => ("datapacks.disable", Content),
    DatapacksEnable => ("datapacks.enable", Content),
    DatapacksInstall => ("datapacks.install", Content),
    DatapacksList => ("datapacks.list", Content),
    DatapacksRemove => ("datapacks.remove", Content),
    DatapacksSetVersion => ("datapacks.set-version", Content),
    InstallExecute => ("install.execute", Instance),
    InstallPlan => ("install.plan", Instance),
    InstallPrepare => ("install.prepare", Instance),
    InstanceCreate => ("instance.create", Instance),
    InstanceDelete => ("instance.delete", Instance),
    InstanceGet => ("instance.get", Instance),
    InstanceList => ("instance.list", Instance),
    JavaDetect => ("java.detect", Java),
    JavaRuntimeInstall => ("java.runtime.install", Java),
    JavaRuntimeList => ("java.runtime.list", Java),
    JavaRuntimeRemove => ("java.runtime.remove", Java),
    JavaSelect => ("java.select", Java),
    LaunchExecute => ("launch.execute", Instance),
    LaunchPlan => ("launch.plan", Instance),
    ModpackInstall => ("modpack.install", Content),
    ModsAdopt => ("mods.adopt", Content),
    ModsDisable => ("mods.disable", Content),
    ModsEnable => ("mods.enable", Content),
    ModsInstall => ("mods.install", Content),
    ModsList => ("mods.list", Content),
    ModsRemove => ("mods.remove", Content),
    ModsSetVersion => ("mods.set-version", Content),
    Ping => ("ping", Core),
    ResourcepacksAdopt => ("resourcepacks.adopt", Content),
    ResourcepacksDisable => ("resourcepacks.disable", Content),
    ResourcepacksEnable => ("resourcepacks.enable", Content),
    ResourcepacksInstall => ("resourcepacks.install", Content),
    ResourcepacksList => ("resourcepacks.list", Content),
    ResourcepacksRemove => ("resourcepacks.remove", Content),
    ResourcepacksSetVersion => ("resourcepacks.set-version", Content),
    ServerCommand => ("server.command", Server),
    ServerCreate => ("server.create", Server),
    ServerDatapacksAdopt => ("server.datapacks.adopt", Server),
    ServerDatapacksDisable => ("server.datapacks.disable", Server),
    ServerDatapacksEnable => ("server.datapacks.enable", Server),
    ServerDatapacksInstall => ("server.datapacks.install", Server),
    ServerDatapacksList => ("server.datapacks.list", Server),
    ServerDatapacksRemove => ("server.datapacks.remove", Server),
    ServerDatapacksSetVersion => ("server.datapacks.set-version", Server),
    ServerDelete => ("server.delete", Server),
    ServerGet => ("server.get", Server),
    ServerInstall => ("server.install", Server),
    ServerList => ("server.list", Server),
    ServerLogs => ("server.logs", Server),
    ServerModsAdopt => ("server.mods.adopt", Server),
    ServerModsDisable => ("server.mods.disable", Server),
    ServerModsEnable => ("server.mods.enable", Server),
    ServerModsInstall => ("server.mods.install", Server),
    ServerModsList => ("server.mods.list", Server),
    ServerModsRemove => ("server.mods.remove", Server),
    ServerModsSetVersion => ("server.mods.set-version", Server),
    ServerPropertiesGet => ("server.properties.get", Server),
    ServerPropertiesSet => ("server.properties.set", Server),
    ServerQuery => ("server.query", Server),
    ServerRconCommand => ("server.rcon.command", Server),
    ServerRestart => ("server.restart", Server),
    ServerStart => ("server.start", Server),
    ServerStatus => ("server.status", Server),
    ServerStop => ("server.stop", Server),
    ServerWorldsBackup => ("server.worlds.backup", Server),
    ServerWorldsBackups => ("server.worlds.backups", Server),
    ServerWorldsBackupsDelete => ("server.worlds.backups.delete", Server),
    ServerWorldsDelete => ("server.worlds.delete", Server),
    ServerWorldsGet => ("server.worlds.get", Server),
    ServerWorldsList => ("server.worlds.list", Server),
    ServerWorldsRename => ("server.worlds.rename", Server),
    ServerWorldsRestore => ("server.worlds.restore", Server),
    ShaderpacksAdopt => ("shaderpacks.adopt", Content),
    ShaderpacksDisable => ("shaderpacks.disable", Content),
    ShaderpacksEnable => ("shaderpacks.enable", Content),
    ShaderpacksInstall => ("shaderpacks.install", Content),
    ShaderpacksList => ("shaderpacks.list", Content),
    ShaderpacksRemove => ("shaderpacks.remove", Content),
    ShaderpacksSetVersion => ("shaderpacks.set-version", Content),
    StoreGc => ("store.gc", Content),
    VersionGet => ("version.get", Instance),
    VersionList => ("version.list", Instance),
    VersionResolve => ("version.resolve", Instance),
    WorldsBackup => ("worlds.backup", Content),
    WorldsBackups => ("worlds.backups", Content),
    WorldsBackupsDelete => ("worlds.backups.delete", Content),
    WorldsDelete => ("worlds.delete", Content),
    WorldsDuplicate => ("worlds.duplicate", Content),
    WorldsExport => ("worlds.export", Content),
    WorldsGet => ("worlds.get", Content),
    WorldsImport => ("worlds.import", Content),
    WorldsList => ("worlds.list", Content),
    WorldsRename => ("worlds.rename", Content),
    WorldsRestore => ("worlds.restore", Content),
}
impl Method {
    fn classify(value: &str) -> Self {
        OperationName::classify(value).family()
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    CoreUnavailable,
    SpawnFailed,
    RpcRejected,
    InvalidParams,
    Network,
    RateLimited,
    SessionClosed,
    Cancelled,
    Eof,
    ReadFailed,
    WriteFailed,
    ReadersStopped,
    Protocol,
    IncompatibleVersion,
    SshAuth,
    SshHostKey,
    SshTimeout,
    SshConnection,
    Credentials,
    Transport,
}
impl Failure {
    fn classify(error: &crate::session::SessionError) -> Self {
        use crate::session::SessionError;
        match error {
            SessionError::Rpc { code, .. } => match code.as_str() {
                "INVALID_PARAMS" => Self::InvalidParams,
                "HTTP_STATUS_ERROR"
                | "HTTP_REQUEST_FAILED"
                | "NETWORK_ERROR"
                | "AUTH_NETWORK_ERROR" => Self::Network,
                "RATE_LIMITED" => Self::RateLimited,
                _ => Self::RpcRejected,
            },
            SessionError::Transport { code, .. } => match code.as_str() {
                "CORE_BINARY_UNAVAILABLE" => Self::CoreUnavailable,
                "CORE_SPAWN_FAILED" => Self::SpawnFailed,
                "SESSION_CLOSED" => Self::SessionClosed,
                "SESSION_CANCELLED" => Self::Cancelled,
                "CORE_RPC_EOF" => Self::Eof,
                "CORE_RPC_READ_FAILED" => Self::ReadFailed,
                "CORE_RPC_WRITE_FAILED" => Self::WriteFailed,
                "CORE_RPC_READERS_STOPPED" => Self::ReadersStopped,
                "CORE_PROTOCOL_ERROR" | "SSH_PROTOCOL_ERROR" => Self::Protocol,
                "INCOMPATIBLE_VERSION" | "UNSUPPORTED_PROTOCOL" => Self::IncompatibleVersion,
                "SSH_AUTH_REQUIRED_OR_FAILED" => Self::SshAuth,
                "SSH_HOST_KEY_CHANGED" | "SSH_HOST_KEY_UNKNOWN" => Self::SshHostKey,
                "SSH_TIMEOUT" => Self::SshTimeout,
                "SSH_CONNECTION_FAILED"
                | "SSH_DISCONNECTED"
                | "SSH_EXECUTABLE_NOT_FOUND"
                | "SSH_REMOTE_COMMAND_FAILED" => Self::SshConnection,
                "CURSEFORGE_KEYCHAIN" | "CURSEFORGE_KEY_REQUIRED" | "CURSEFORGE_KEY_INVALID" => {
                    Self::Credentials
                }
                "CURSEFORGE_NETWORK" => Self::Network,
                "CURSEFORGE_RATE_LIMIT" => Self::RateLimited,
                _ => Self::Transport,
            },
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    version: u8,
    timestamp_ms: u64,
    level: Level,
    event: Event,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<Method>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<OperationName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<Failure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outcome: Option<Outcome>,
}
impl Record {
    fn new(event: Event) -> Self {
        Self {
            version: 1,
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(9_007_199_254_740_991) as u64,
            level: match event {
                Event::FrontendError | Event::UnhandledRejection | Event::BridgeError => {
                    Level::Error
                }
                _ => Level::Info,
            },
            event,
            method: None,
            operation: None,
            failure: None,
            duration_ms: None,
            correlation_id: None,
            outcome: None,
        }
    }
    fn valid(&self) -> bool {
        self.version == 1
            && self.timestamp_ms <= 9_007_199_254_740_991
            && self.duration_ms.is_none_or(|v| v <= 86_400_000)
            && self
                .correlation_id
                .is_none_or(|v| v <= 9_007_199_254_740_991)
    }
}
#[derive(Serialize)]
pub struct Status {
    enabled: bool,
    // Whether initialization or the most recent storage operation succeeded.
    // A successful read does not guarantee that the next write will succeed.
    available: bool,
    max_file_bytes: usize,
    max_files: usize,
    dropped: u64,
}
#[derive(Default, Serialize)]
pub struct Snapshot {
    records: Vec<Record>,
    skipped: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    enabled: bool,
}

struct Store {
    dir: PathBuf,
    enabled: bool,
}
impl Store {
    fn open(dir: PathBuf) -> Result<Self, &'static str> {
        fs::create_dir_all(&dir).map_err(|_| ERROR)?;
        if fs::symlink_metadata(&dir)
            .map_err(|_| ERROR)?
            .file_type()
            .is_symlink()
        {
            return Err(ERROR);
        }
        let path = dir.join("settings.json");
        // Default OFF, including unreadable/corrupt settings. Never log startup
        // before the saved setting is loaded.
        let enabled = read_regular(&path, 128)
            .ok()
            .and_then(|v| serde_json::from_slice::<Settings>(&v).ok())
            .is_some_and(|s| s.enabled);
        Ok(Self { dir, enabled })
    }
    fn file(&self, index: usize) -> PathBuf {
        self.dir.join(format!("diagnostic-{index}.jsonl"))
    }
    fn check_dir(&self) -> Result<(), &'static str> {
        let meta = fs::symlink_metadata(&self.dir).map_err(|_| ERROR)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(ERROR);
        }
        Ok(())
    }
    fn set_enabled(&mut self, enabled: bool) -> Result<(), &'static str> {
        self.check_dir()?;
        let path = self.dir.join("settings.json");
        let data = serde_json::to_vec(&Settings { enabled }).map_err(|_| ERROR)?;
        let mut file = open_regular_write(&path, false)?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|_| ERROR)?;
        self.enabled = enabled;
        Ok(())
    }
    fn append(&mut self, record: &Record) -> Result<(), &'static str> {
        if !self.enabled {
            return Ok(());
        }
        self.check_dir()?;
        let mut bytes = serde_json::to_vec(record).map_err(|_| ERROR)?;
        bytes.push(b'\n');
        if bytes.len() > MAX_LINE || !record.valid() {
            return Err(ERROR);
        }
        let path = self.file(0);
        let len = match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() => m.len(),
            Ok(_) => return Err(ERROR),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
            Err(_) => return Err(ERROR),
        };
        if len + bytes.len() as u64 > MAX_FILE_BYTES as u64 {
            // Refuse unexpected files, links, or directories rather than following them.
            for i in 0..MAX_FILES {
                check_optional_regular(&self.file(i))?;
            }
            if self.file(MAX_FILES - 1).exists() {
                fs::remove_file(self.file(MAX_FILES - 1)).map_err(|_| ERROR)?;
            }
            for i in (0..MAX_FILES - 1).rev() {
                if self.file(i).exists() {
                    fs::rename(self.file(i), self.file(i + 1)).map_err(|_| ERROR)?;
                }
            }
        }
        open_regular_write(&path, true)?
            .write_all(&bytes)
            .map_err(|_| ERROR)
    }
    fn read(&self) -> Result<Snapshot, &'static str> {
        self.check_dir()?;
        let mut out = Snapshot::default();
        for i in (0..MAX_FILES).rev() {
            let path = self.file(i);
            if !path.try_exists().map_err(|_| ERROR)? {
                continue;
            }
            // Oversized/tampered files are skipped, never read without a cap.
            let bytes = match read_regular(&path, MAX_FILE_BYTES) {
                Ok(v) => v,
                Err(_) => {
                    out.skipped += 1;
                    continue;
                }
            };
            for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
                let record = if line.len() <= MAX_LINE {
                    serde_json::from_slice::<Record>(line)
                        .ok()
                        .filter(Record::valid)
                } else {
                    None
                };
                match record {
                    Some(r) => {
                        if out.records.len() == MAX_RECORDS {
                            out.records.remove(0);
                            out.skipped += 1;
                        }
                        out.records.push(r);
                    }
                    None => out.skipped += 1,
                }
            }
        }
        Ok(out)
    }
    fn clear(&self) -> Result<(), &'static str> {
        self.check_dir()?;
        for i in 0..MAX_FILES {
            check_optional_regular(&self.file(i))?;
        }
        for i in 0..MAX_FILES {
            match fs::remove_file(self.file(i)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(ERROR),
            }
        }
        Ok(())
    }
}
fn check_optional_regular(path: &Path) -> Result<(), &'static str> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err(ERROR),
    }
}
fn read_regular(path: &Path, limit: usize) -> Result<Vec<u8>, &'static str> {
    check_optional_regular(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    no_follow(&mut options);
    let file = options.open(path).map_err(|_| ERROR)?;
    validate_file(&file)?;
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ERROR)?;
    if bytes.len() > limit {
        return Err(ERROR);
    }
    Ok(bytes)
}
fn no_follow(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
}
fn validate_file(file: &File) -> Result<(), &'static str> {
    let metadata = file.metadata().map_err(|_| ERROR)?;
    if !metadata.is_file() {
        return Err(ERROR);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(ERROR);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(ERROR);
        }
    }
    Ok(())
}
fn open_regular_write(path: &Path, append: bool) -> Result<File, &'static str> {
    check_optional_regular(path)?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).append(append);
    no_follow(&mut options);
    let file = options.open(path).map_err(|_| ERROR)?;
    validate_file(&file)?;
    if !append {
        file.set_len(0).map_err(|_| ERROR)?;
    }
    Ok(file)
}

enum Command {
    Record(Record),
    Read(SyncSender<Result<Snapshot, &'static str>>),
    Clear(SyncSender<Result<(), &'static str>>),
    Enable(bool, SyncSender<Result<(), &'static str>>),
}
struct Shared {
    control_busy: AtomicBool,
    enabled: AtomicBool,
    available: AtomicBool,
    dropped: AtomicU64,
    sequence: AtomicU64,
}
#[derive(Clone)]
pub struct Diagnostics {
    sender: SyncSender<Command>,
    shared: Arc<Shared>,
}
impl Diagnostics {
    pub fn start(dir: PathBuf) -> Self {
        let store = Store::open(dir);
        let shared = Arc::new(Shared {
            control_busy: AtomicBool::new(false),
            enabled: AtomicBool::new(store.as_ref().is_ok_and(|s| s.enabled)),
            available: AtomicBool::new(store.is_ok()),
            dropped: AtomicU64::new(0),
            sequence: AtomicU64::new(0),
        });
        let (sender, receiver) = mpsc::sync_channel(256);
        let worker = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("jmcl-diagnostics".into())
            .spawn(move || {
                let mut store = store;
                while let Ok(command) = receiver.recv() {
                    match command {
                        Command::Record(record) => {
                            let result = store
                                .as_mut()
                                .map_err(|_| ERROR)
                                .and_then(|s| s.append(&record));
                            worker.available.store(result.is_ok(), Ordering::Relaxed);
                            if result.is_err() {
                                worker.dropped.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Command::Read(reply) => {
                            let result = store.as_ref().map_err(|_| ERROR).and_then(Store::read);
                            worker.available.store(result.is_ok(), Ordering::Relaxed);
                            let _ = reply.send(result);
                        }
                        Command::Clear(reply) => {
                            let result = store.as_ref().map_err(|_| ERROR).and_then(Store::clear);
                            worker.available.store(result.is_ok(), Ordering::Relaxed);
                            let _ = reply.send(result);
                        }
                        Command::Enable(enabled, reply) => {
                            let result = store
                                .as_mut()
                                .map_err(|_| ERROR)
                                .and_then(|s| s.set_enabled(enabled));
                            worker.available.store(result.is_ok(), Ordering::Relaxed);
                            if result.is_ok() {
                                worker.enabled.store(enabled, Ordering::Relaxed);
                            }
                            let _ = reply.send(result);
                        }
                    }
                }
            });
        if spawned.is_err() {
            shared.available.store(false, Ordering::Relaxed);
        }
        Self { sender, shared }
    }
    pub fn event(&self, event: Event) {
        self.record(Record::new(event));
    }
    fn record(&self, record: Record) {
        if !self.shared.enabled.load(Ordering::Relaxed) {
            return;
        }
        if self.sender.try_send(Command::Record(record)).is_err() {
            self.shared.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    fn control(&self) -> Result<ControlGuard, &'static str> {
        self.shared
            .control_busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Another diagnostic action is in progress.")?;
        Ok(ControlGuard(self.shared.clone()))
    }
    fn status(&self) -> Status {
        Status {
            enabled: self.shared.enabled.load(Ordering::Relaxed),
            available: self.shared.available.load(Ordering::Relaxed),
            max_file_bytes: MAX_FILE_BYTES,
            max_files: MAX_FILES,
            dropped: self.shared.dropped.load(Ordering::Relaxed),
        }
    }
    pub fn operation(&self, event: Event, method: Option<&str>) -> Operation {
        let mut record = Record::new(event);
        record.method = method.map(Method::classify);
        record.operation = method.map(OperationName::classify);
        record.correlation_id =
            Some(self.shared.sequence.fetch_add(1, Ordering::Relaxed) % 9_007_199_254_740_991);
        record.outcome = Some(Outcome::Cancelled);
        Operation {
            logger: self.clone(),
            record,
            start: Instant::now(),
        }
    }
    fn read(&self) -> Result<Snapshot, &'static str> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.sender.send(Command::Read(tx)).map_err(|_| ERROR)?;
        rx.recv().map_err(|_| ERROR)?
    }
    fn clear(&self) -> Result<(), &'static str> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.sender.send(Command::Clear(tx)).map_err(|_| ERROR)?;
        rx.recv().map_err(|_| ERROR)?
    }
    fn enable(&self, enabled: bool) -> Result<(), &'static str> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.sender
            .send(Command::Enable(enabled, tx))
            .map_err(|_| ERROR)?;
        rx.recv().map_err(|_| ERROR)?
    }
}
struct ControlGuard(Arc<Shared>);
impl Drop for ControlGuard {
    fn drop(&mut self) {
        self.0.control_busy.store(false, Ordering::Release);
    }
}
pub struct Operation {
    logger: Diagnostics,
    record: Record,
    start: Instant,
}
impl Operation {
    pub fn finish_session<T>(&mut self, result: &Result<T, crate::session::SessionError>) {
        self.finish(result);
        self.record.failure = result.as_ref().err().map(Failure::classify);
    }
    pub fn finish<T, E>(&mut self, result: &Result<T, E>) {
        self.record.outcome = Some(if result.is_ok() {
            Outcome::Ok
        } else {
            Outcome::Error
        });
        self.record.level = if result.is_ok() {
            Level::Info
        } else {
            Level::Error
        };
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        self.record.duration_ms = Some(self.start.elapsed().as_millis().min(86_400_000) as u64);
        self.logger.record(self.record.clone());
    }
}

#[tauri::command]
pub fn diagnostics_status(logger: State<'_, Diagnostics>) -> Status {
    logger.status()
}
#[tauri::command]
pub async fn diagnostics_set_enabled(
    logger: State<'_, Diagnostics>,
    enabled: bool,
) -> Result<Status, &'static str> {
    let logger = logger.inner().clone();
    let guard = logger.control()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        logger.enable(enabled)?;
        Ok(logger.status())
    })
    .await
    .map_err(|_| ERROR)?
}
#[tauri::command]
pub async fn diagnostics_read(logger: State<'_, Diagnostics>) -> Result<Snapshot, &'static str> {
    let logger = logger.inner().clone();
    tauri::async_runtime::spawn_blocking(move || logger.read())
        .await
        .map_err(|_| ERROR)?
}
#[tauri::command]
pub async fn diagnostics_clear(logger: State<'_, Diagnostics>) -> Result<(), &'static str> {
    let logger = logger.inner().clone();
    let guard = logger.control()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        logger.clear()
    })
    .await
    .map_err(|_| ERROR)?
}
#[tauri::command]
pub fn diagnostics_record(logger: State<'_, Diagnostics>, event: FrontendEvent) {
    logger.event(match event {
        FrontendEvent::FrontendReady => Event::FrontendReady,
        FrontendEvent::FrontendError => Event::FrontendError,
        FrontendEvent::UnhandledRejection => Event::UnhandledRejection,
        FrontendEvent::BridgeError => Event::BridgeError,
    });
}
#[tauri::command]
pub async fn diagnostics_export(
    app: tauri::AppHandle,
    logger: State<'_, Diagnostics>,
) -> Result<bool, &'static str> {
    let logger = logger.inner().clone();
    let _guard = logger.control()?;
    let snapshot = tauri::async_runtime::spawn_blocking(move || logger.read())
        .await
        .map_err(|_| ERROR)??;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name("jmcl-diagnostics.jsonl")
        .add_filter("JSON Lines", &["jsonl"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(path) = rx.await.map_err(|_| ERROR)? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|_| ERROR)?;
    // Do not allow an export to overwrite the logger's own settings or segments.
    let managed = app
        .path()
        .app_data_dir()
        .map_err(|_| ERROR)?
        .join("diagnostics");
    if path.parent().and_then(|p| p.canonicalize().ok()) == managed.canonicalize().ok() {
        return Err(ERROR);
    }
    tauri::async_runtime::spawn_blocking(move || write_snapshot(&path, snapshot).map(|()| true))
        .await
        .map_err(|_| ERROR)?
}
fn write_snapshot(path: &Path, snapshot: Snapshot) -> Result<(), &'static str> {
    let mut file = open_regular_write(path, false)?;
    for record in snapshot.records.into_iter().take(MAX_RECORDS) {
        if !record.valid() {
            continue;
        }
        let mut bytes = serde_json::to_vec(&record).map_err(|_| ERROR)?;
        bytes.push(b'\n');
        file.write_all(&bytes).map_err(|_| ERROR)?;
    }
    file.sync_all().map_err(|_| ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "jmcl-diagnostics-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn default_off_enable_disable_and_restart() {
        let dir = Temp::new();
        let mut store = Store::open(dir.0.clone()).unwrap();
        store.append(&Record::new(Event::AppStarted)).unwrap();
        assert!(store.read().unwrap().records.is_empty());
        store.set_enabled(true).unwrap();
        assert!(Store::open(dir.0.clone()).unwrap().enabled);
        store.append(&Record::new(Event::AppStarted)).unwrap();
        store.set_enabled(false).unwrap();
        let mut restarted = Store::open(dir.0.clone()).unwrap();
        assert!(!restarted.enabled);
        restarted.append(&Record::new(Event::AppStarted)).unwrap();
        assert_eq!(restarted.read().unwrap().records.len(), 1);
        fs::write(dir.0.join("settings.json"), b"invalid").unwrap();
        assert!(!Store::open(dir.0.clone()).unwrap().enabled);
    }
    #[test]
    fn sentinel_input_never_enters_records_and_unknown_fields_rejected() {
        let dir = Temp::new();
        let logger = Diagnostics::start(dir.0.clone());
        logger.enable(true).unwrap();
        let secret = "secret-password-token-api-key-account-/private/path?token=abc";
        let mut op = logger.operation(Event::CoreRequest, Some(secret));
        op.finish(&Err::<(), _>(secret));
        drop(op);
        let snapshot = logger.read().unwrap();
        assert!(
            !String::from_utf8(fs::read(dir.0.join("diagnostic-0.jsonl")).unwrap())
                .unwrap()
                .contains(secret)
        );
        let json = serde_json::to_string(&snapshot).unwrap();
        let destination = dir.0.join("export.jsonl");
        write_snapshot(&destination, snapshot).unwrap();
        assert!(!String::from_utf8(fs::read(destination).unwrap())
            .unwrap()
            .contains(secret));
        assert!(!json.contains(secret));
        assert!(json.contains("other"));
        assert!(serde_json::from_str::<FrontendEvent>(&format!("\"{secret}\"")).is_err());
        let mut malicious = serde_json::to_value(Record::new(Event::AppStarted)).unwrap();
        malicious["message"] = serde_json::json!(secret);
        assert!(serde_json::from_value::<Record>(malicious.clone()).is_err());
        fs::write(
            dir.0.join("diagnostic-0.jsonl"),
            serde_json::to_vec(&malicious).unwrap(),
        )
        .unwrap();
        let read = logger.read().unwrap();
        assert!(read.records.is_empty());
        assert_eq!(read.skipped, 1);
        write_snapshot(&dir.0.join("sanitized.jsonl"), read).unwrap();
        assert!(fs::read(dir.0.join("sanitized.jsonl")).unwrap().is_empty());
    }
    #[test]
    fn actionable_operations_and_failures_are_closed_and_secret_free() {
        use crate::session::SessionError;
        let dir = Temp::new();
        let logger = Diagnostics::start(dir.0.clone());
        logger.enable(true).unwrap();
        let secret = "SENTINEL-token-password-url?account=private";
        for (method, error) in [
            (
                "auth.microsoft.device.begin",
                SessionError::coded("CORE_RPC_EOF", secret),
            ),
            (
                "auth.microsoft.device.poll",
                SessionError::Rpc {
                    code: secret.into(),
                    message: secret.into(),
                },
            ),
            (secret, SessionError::coded(secret, secret)),
        ] {
            let mut op = logger.operation(Event::CoreRequest, Some(method));
            op.finish_session(&Err::<(), _>(error));
        }
        let snapshot = logger.read().unwrap();
        assert!(matches!(
            snapshot.records[0].operation,
            Some(OperationName::AuthMicrosoftDeviceBegin)
        ));
        assert!(matches!(snapshot.records[0].failure, Some(Failure::Eof)));
        assert!(matches!(
            snapshot.records[1].failure,
            Some(Failure::RpcRejected)
        ));
        assert!(matches!(
            snapshot.records[2].operation,
            Some(OperationName::Other)
        ));
        assert!(matches!(
            snapshot.records[2].failure,
            Some(Failure::Transport)
        ));
        let raw = String::from_utf8(fs::read(dir.0.join("diagnostic-0.jsonl")).unwrap()).unwrap();
        assert!(!raw.contains(secret));
        write_snapshot(&dir.0.join("export.jsonl"), snapshot).unwrap();
        assert!(
            !String::from_utf8(fs::read(dir.0.join("export.jsonl")).unwrap())
                .unwrap()
                .contains(secret)
        );
        assert!(serde_json::from_str::<OperationName>(&format!("\"{secret}\"")).is_err());
        assert!(serde_json::from_str::<Failure>(&format!("\"{secret}\"")).is_err());
        for method in [
            "ping",
            "mods.list",
            "resourcepacks.set-version",
            "shaderpacks.install",
            "auth.microsoft.refresh",
            "auth.minecraft.refresh_exchange",
        ] {
            assert!(!matches!(
                OperationName::classify(method),
                OperationName::Other
            ));
        }
        assert!(matches!(
            Failure::classify(&SessionError::coded("CORE_RPC_READ_FAILED", secret)),
            Failure::ReadFailed
        ));
        assert!(matches!(
            Failure::classify(&SessionError::coded("CORE_RPC_WRITE_FAILED", secret)),
            Failure::WriteFailed
        ));
        assert!(matches!(
            Failure::classify(&SessionError::coded("CORE_PROTOCOL_ERROR", secret)),
            Failure::Protocol
        ));
    }
    #[test]
    fn repaired_storage_recovers_on_refresh_and_can_be_disabled() {
        let dir = Temp::new();
        let location = dir.0.join("logs");
        let displaced = dir.0.join("temporarily-unavailable");
        let logger = Diagnostics::start(location.clone());
        logger.enable(true).unwrap();
        fs::rename(&location, &displaced).unwrap();
        logger.event(Event::FrontendReady);
        assert!(logger.read().is_err()); // also a queue barrier after failed append
        assert!(!logger.status().available);
        assert!(logger.status().enabled);
        assert_eq!(logger.status().dropped, 1);
        assert!(logger.enable(false).is_err()); // truthful: not persisted yet
        fs::rename(&displaced, &location).unwrap();
        logger.read().unwrap();
        assert!(logger.status().available);
        logger.enable(false).unwrap();
        assert!(!logger.status().enabled);
        assert!(!Store::open(location).unwrap().enabled);
    }
    #[test]
    fn native_control_guard_survives_renderer_remount_and_releases() {
        let dir = Temp::new();
        let logger = Diagnostics::start(dir.0.clone());
        let guard = logger.control().unwrap();
        let remounted = logger.clone();
        assert!(remounted.control().is_err());
        drop(guard);
        assert!(remounted.control().is_ok());
    }
    #[test]
    fn interrupted_operation_records_only_bounded_metadata() {
        let dir = Temp::new();
        let logger = Diagnostics::start(dir.0.clone());
        logger.enable(true).unwrap();
        drop(logger.operation(Event::CoreRequest, Some("core.version")));
        let records = logger.read().unwrap().records;
        assert_eq!(records.len(), 1);
        assert!(matches!(records[0].outcome, Some(Outcome::Cancelled)));
        assert!(records[0].correlation_id.is_some());
        assert!(records[0].duration_ms.is_some());
        assert!(matches!(Method::classify("core.version"), Method::Core));
        assert!(matches!(
            Method::classify("account.microsoft.save"),
            Method::Account
        ));
        assert!(matches!(
            Method::classify("account.microsoft.save?token=sentinel"),
            Method::Other
        ));
    }
    #[test]
    fn rotation_bounded_and_clear_preserves_settings_and_unrelated_files() {
        let dir = Temp::new();
        let mut store = Store::open(dir.0.clone()).unwrap();
        store.set_enabled(true).unwrap();
        for _ in 0..14_000 {
            store.append(&Record::new(Event::FrontendReady)).unwrap();
        }
        for i in 0..MAX_FILES {
            assert!(store.file(i).metadata().unwrap().len() <= MAX_FILE_BYTES as u64);
        }
        assert!(!store.file(MAX_FILES).exists());
        assert!(store.read().unwrap().records.len() <= MAX_RECORDS);
        fs::write(dir.0.join("unrelated.txt"), b"preserve").unwrap();
        store.clear().unwrap();
        assert!(store.read().unwrap().records.is_empty());
        assert!(store.enabled);
        assert!(dir.0.join("settings.json").exists());
        assert!(dir.0.join("unrelated.txt").exists());
    }
    #[test]
    fn malformed_oversized_and_unknown_records_are_not_exportable() {
        let dir = Temp::new();
        let store = Store::open(dir.0.clone()).unwrap();
        fs::write(store.file(0), vec![b'x'; MAX_FILE_BYTES + 1]).unwrap();
        fs::write(store.file(1), b"not-json\n{\"version\":2}\n").unwrap();
        let mut invalid = Record::new(Event::AppStarted);
        invalid.version = 99;
        fs::write(store.file(2), serde_json::to_vec(&invalid).unwrap()).unwrap();
        let read = store.read().unwrap();
        assert!(read.records.is_empty());
        assert_eq!(read.skipped, 4);
    }
    #[test]
    fn concurrent_queue_read_clear_enable_and_failures_are_isolated() {
        let dir = Temp::new();
        let logger = Diagnostics::start(dir.0.clone());
        logger.enable(true).unwrap();
        let workers: Vec<_> = (0..4)
            .map(|i| {
                let logger = logger.clone();
                let destination = dir.0.join(format!("concurrent-export-{i}.jsonl"));
                std::thread::spawn(move || {
                    for _ in 0..300 {
                        logger.event(Event::FrontendReady);
                    }
                    write_snapshot(&destination, logger.read().unwrap()).unwrap();
                })
            })
            .collect();
        logger.clear().unwrap();
        for w in workers {
            w.join().unwrap();
        }
        logger.enable(false).unwrap();
        logger.clear().unwrap();
        logger.event(Event::FrontendError);
        assert!(logger.read().unwrap().records.is_empty());
        let failure_path = dir.0.join("file");
        fs::write(&failure_path, b"not-a-directory").unwrap();
        let failed = Diagnostics::start(failure_path);
        failed.event(Event::AppStarted);
        assert!(!failed.status().available);
        assert!(failed.read().is_err());
        // Ordinary results remain untouched even when no log destination exists.
        let result: Result<u32, &str> = Ok(42);
        let mut op = failed.operation(Event::CoreRequest, Some("core.version"));
        op.finish(&result);
        drop(op);
        assert_eq!(result.unwrap(), 42);
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_or_deleted() {
        use std::os::unix::fs::symlink;
        let dir = Temp::new();
        let target = dir.0.join("private");
        fs::write(&target, b"sentinel").unwrap();
        let mut store = Store::open(dir.0.join("logs")).unwrap();
        store.set_enabled(true).unwrap();
        symlink(&target, store.file(0)).unwrap();
        assert!(store.append(&Record::new(Event::AppStarted)).is_err());
        assert!(store.clear().is_err());
        assert!(store.read().unwrap().records.is_empty());
        assert_eq!(fs::read(&target).unwrap(), b"sentinel");
    }
}
