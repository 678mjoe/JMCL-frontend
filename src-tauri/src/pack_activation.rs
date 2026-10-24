//! Narrow GUI-owned resource-pack activation. Core only installs pack files.
//!
//! No arbitrary path or file API is exposed. Unix directory descriptors and
//! O_NOFOLLOW pin each validated component. Windows uses handle-relative NT
//! file operations and rejects reparse points. The user must confirm that clients
//! launched outside this GUI are stopped; Core has no client-status endpoint.
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::{Mutex, RwLock};

use crate::session::SessionError;

const MAX_OPTIONS: usize = 1024 * 1024;

#[derive(Default)]
pub struct PackActivationState {
    // Requests take shared guards for their entire lifetime (including launch).
    // Activation takes exclusive, nonblocking guards. Different Core requests
    // remain concurrent; activation conservatively refuses while any is active.
    pub requests: RwLock<()>,
    snapshots: Mutex<HashMap<String, SavedSnapshot>>,
    sequence: AtomicU64,
    shader_snapshots: Mutex<HashMap<String, SavedShaderSnapshot>>,
}

#[derive(Clone)]
struct SavedSnapshot {
    root: String,
    id: String,
    original: Vec<u8>,
    selected: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackActivationSnapshot {
    revision: String,
    resource_packs: Vec<String>,
    available_resource_packs: Vec<String>,
}

fn error(code: &str) -> SessionError {
    SessionError::coded(code, match code {
        "PACK_ACTIVATION_BUSY" => "Wait for active launcher operations and games to stop.",
        "PACK_ACTIVATION_CHANGED" => "The configuration changed. Reload before saving.",
        "PACK_ACTIVATION_UNSUPPORTED" => "Safe activation editing is not supported on this platform.",
        "PACK_ACTIVATION_CONFIRM_STOPPED" => "Confirm all Minecraft clients using this instance are stopped.",
        "PACK_ACTIVATION_OPTIONS_MISSING" => "Start and stop Minecraft once to create options.txt before editing activation.",
        "SHADER_ACTIVATION_CONFIG_MISSING" => "Start and stop the selected runtime once to create its configuration before editing.",
        "SHADER_ACTIVATION_CONFIRM_RUNTIME" => "Confirm that the selected runtime configuration format is the one installed in this instance.",
        "PACK_ACTIVATION_FORMAT" => "The existing resource-pack configuration is unsupported or ambiguous; edit it in Minecraft.",
        "PACK_ACTIVATION_SELECTION" => "Only installed local packs may be selected; unknown entries must be retained.",
        _ => "The instance configuration could not be safely accessed.",
    })
}

fn reject_bare_cr(bytes: &[u8]) -> Result<(), SessionError> {
    if bytes
        .iter()
        .enumerate()
        .any(|(i, b)| *b == b'\r' && bytes.get(i + 1) != Some(&b'\n'))
    {
        return Err(error("PACK_ACTIVATION_FORMAT"));
    }
    Ok(())
}

fn parse_options(bytes: &[u8]) -> Result<Vec<String>, SessionError> {
    reject_bare_cr(bytes)?;
    let text = std::str::from_utf8(bytes).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let entries: Vec<_> = text
        .lines()
        .filter_map(|line| line.strip_prefix("resourcePacks:"))
        .collect();
    if entries.len() != 1 {
        return Err(error("PACK_ACTIVATION_FORMAT"));
    }
    let selected: Vec<String> =
        serde_json::from_str(entries[0]).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let mut unique = HashSet::new();
    if selected.len() > 512 || selected.iter().any(|v| v.len() > 1024 || !unique.insert(v)) {
        return Err(error("PACK_ACTIVATION_FORMAT"));
    }
    Ok(selected)
}

fn replace_options(original: &[u8], selected: &[String]) -> Result<Vec<u8>, SessionError> {
    parse_options(original)?;
    let text = std::str::from_utf8(original).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let json = serde_json::to_string(selected).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let mut output = String::with_capacity(text.len() + json.len());
    for line in text.split_inclusive('\n') {
        if line.starts_with("resourcePacks:") {
            output.push_str("resourcePacks:");
            output.push_str(&json);
            if line.ends_with("\r\n") {
                output.push_str("\r\n");
            } else if line.ends_with('\n') {
                output.push('\n');
            }
        } else {
            output.push_str(line);
        }
    }
    Ok(output.into_bytes())
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
}

// Core 97b65186 src/instance_store.zig portable identity/manifest contract.
fn valid_instance_id(id: &str) -> bool {
    let alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if id.is_empty()
        || id.len() > 64
        || !alnum(id.as_bytes()[0])
        || id.ends_with('.')
        || !id
            .bytes()
            .all(|b| alnum(b) || b == b'.' || b == b'_' || b == b'-')
    {
        return false;
    }
    let stem = id.split('.').next().unwrap_or_default();
    !matches!(stem, "con" | "prn" | "aux" | "nul")
        && !(stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn validate_manifest<'a>(
    manifest: &'a serde_json::Value,
    id: &str,
) -> Result<&'a str, SessionError> {
    let fail = || error("PACK_ACTIVATION_PATH");
    if !valid_instance_id(id)
        || manifest.get("id").and_then(|v| v.as_str()) != Some(id)
        || manifest
            .get("schema_version")
            .is_some_and(|v| v.as_u64() != Some(1))
    {
        return Err(fail());
    }
    let valid_field = |key| {
        manifest
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty() && v.len() <= 256)
    };
    if valid_field("name").is_none() {
        return Err(fail());
    }
    let version = valid_field("version_id").ok_or_else(fail)?;
    if manifest
        .get("source")
        .is_some_and(|v| !matches!(v.as_str(), Some("official" | "bmclapi")))
    {
        return Err(fail());
    }
    let mut loaders = 0;
    for key in ["fabric_loader", "forge_version", "neoforge_version"] {
        if let Some(value) = manifest.get(key).filter(|v| !v.is_null()) {
            if !value
                .as_str()
                .is_some_and(|v| !v.is_empty() && v.len() <= 256)
            {
                return Err(fail());
            }
            loaders += 1;
        }
    }
    if loaders > 1 {
        return Err(fail());
    }
    Ok(version)
}

fn validate_selection(
    selected: &[String],
    saved: &[String],
    available: &[String],
) -> Result<(), SessionError> {
    let mut unique = HashSet::new();
    if selected.len() > 512 || selected.iter().any(|v| !unique.insert(v)) {
        return Err(error("PACK_ACTIVATION_SELECTION"));
    }
    let opaque = |list: &[String]| {
        list.iter()
            .filter(|v| !available.contains(v))
            .cloned()
            .collect::<Vec<_>>()
    };
    // Never silently drop unknown built-in IDs or missing packs. Their relative
    // order remains intact; a future runtime may still understand these entries.
    if opaque(selected) != opaque(saved) {
        return Err(error("PACK_ACTIVATION_SELECTION"));
    }
    Ok(())
}

#[cfg(unix)]
mod files {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::path::{Component, Path};

    pub struct InstanceFiles {
        game: File,
        packs: Option<File>,
        target_name: &'static str,
        shader: bool,
    }
    fn child(parent: &File, name: &str, directory: bool) -> Result<File, SessionError> {
        let name = CString::new(name).map_err(|_| error("PACK_ACTIVATION_PATH"))?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | if directory {
                libc::O_DIRECTORY
            } else {
                libc::O_NONBLOCK
            };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(error("PACK_ACTIVATION_PATH"));
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata().map_err(|_| error("PACK_ACTIVATION_PATH"))?;
        if (directory && !metadata.is_dir())
            || (!directory && (!metadata.is_file() || metadata.nlink() != 1))
        {
            return Err(error("PACK_ACTIVATION_PATH"));
        }
        Ok(file)
    }
    fn read_file(mut file: File) -> Result<Vec<u8>, SessionError> {
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_OPTIONS as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error("PACK_ACTIVATION_PATH"))?;
        if bytes.len() > MAX_OPTIONS {
            return Err(error("PACK_ACTIVATION_FORMAT"));
        }
        Ok(bytes)
    }
    impl InstanceFiles {
        pub fn open(root: &str, id: &str) -> Result<Self, SessionError> {
            Self::open_kind(root, id, None)
        }
        pub fn shader(root: &str, id: &str, runtime: ShaderRuntime) -> Result<Self, SessionError> {
            Self::open_kind(root, id, Some(runtime))
        }
        fn open_kind(
            root: &str,
            id: &str,
            runtime: Option<ShaderRuntime>,
        ) -> Result<Self, SessionError> {
            if !valid_instance_id(id) || !Path::new(root).is_absolute() {
                return Err(error("PACK_ACTIVATION_PATH"));
            }
            let mut directory = File::open("/").map_err(|_| error("PACK_ACTIVATION_PATH"))?;
            for part in Path::new(root).components() {
                match part {
                    Component::RootDir => (),
                    Component::Normal(part) => {
                        directory = child(
                            &directory,
                            part.to_str().ok_or_else(|| error("PACK_ACTIVATION_PATH"))?,
                            true,
                        )?;
                    }
                    _ => return Err(error("PACK_ACTIVATION_PATH")),
                }
            }
            // Path::components normalizes '.', so reject it lexically as well.
            if root.split('/').any(|v| v == "." || v == "..") {
                return Err(error("PACK_ACTIVATION_PATH"));
            }
            let instance = child(&directory, id, true)?;
            let manifest = read_file(child(&instance, "instance.json", false)?)?;
            if manifest.len() > 64 * 1024 {
                return Err(error("PACK_ACTIVATION_PATH"));
            }
            let manifest: serde_json::Value =
                serde_json::from_slice(&manifest).map_err(|_| error("PACK_ACTIVATION_PATH"))?;
            let version = validate_manifest(&manifest, id)?;
            let parts: Vec<_> = version.split('.').collect();
            if runtime.is_none()
                && (parts.len() < 2
                    || parts.len() > 3
                    || parts[0] != "1"
                    || parts
                        .iter()
                        .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
                    || parts[1].parse::<u32>().unwrap_or(0) < 13)
            {
                return Err(error("PACK_ACTIVATION_FORMAT"));
            }
            let game = child(&instance, ".minecraft", true)?;
            let pack_directory = if runtime.is_some() {
                "shaderpacks"
            } else {
                "resourcepacks"
            };
            let packs = match child(&game, pack_directory, true) {
                Ok(packs) => Some(packs),
                Err(e) => {
                    let name = CString::new(pack_directory).unwrap();
                    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
                    if unsafe {
                        libc::fstatat(
                            game.as_raw_fd(),
                            name.as_ptr(),
                            &mut stat,
                            libc::AT_SYMLINK_NOFOLLOW,
                        )
                    } == -1
                        && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
                    {
                        None
                    } else {
                        return Err(e);
                    }
                }
            };
            let target_name = match runtime {
                Some(ShaderRuntime::Iris) => "iris.properties",
                Some(ShaderRuntime::Oculus) => "oculus.properties",
                None => "options.txt",
            };
            let game = if runtime.is_some() {
                child(&game, "config", true)?
            } else {
                game
            };
            Ok(Self {
                game,
                packs,
                target_name,
                shader: runtime.is_some(),
            })
        }
        pub fn options(&self) -> Result<Vec<u8>, SessionError> {
            let name = CString::new(self.target_name).unwrap();
            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe {
                libc::fstatat(
                    self.game.as_raw_fd(),
                    name.as_ptr(),
                    &mut stat,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } == -1
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
            {
                return Err(error(if self.shader {
                    "SHADER_ACTIVATION_CONFIG_MISSING"
                } else {
                    "PACK_ACTIVATION_OPTIONS_MISSING"
                }));
            }
            read_file(child(&self.game, self.target_name, false)?)
        }
        pub fn available(&self) -> Result<Vec<String>, SessionError> {
            let Some(packs) = &self.packs else {
                return Ok(Vec::new());
            };
            // fdopendir owns its fd. Reopen '.' rather than dup: duplicated fds
            // share directory offset, which could make subsequent scans empty.
            let scan = child(packs, ".", true)?;
            use std::os::fd::IntoRawFd;
            let fd = scan.into_raw_fd();
            let directory = unsafe { libc::fdopendir(fd) };
            if directory.is_null() {
                unsafe { libc::close(fd) };
                return Err(error("PACK_ACTIVATION_PATH"));
            }
            let mut names = Vec::new();
            loop {
                let entry = unsafe { libc::readdir(directory) };
                if entry.is_null() {
                    break;
                }
                let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
                    .to_str()
                    .ok()
                    .map(str::to_owned);
                if let Some(name) = name {
                    if valid_name(&name)
                        && (!self.shader
                            || (name.is_ascii() && name.trim() == name && name != "(internal)"))
                    {
                        let valid = if name.to_ascii_lowercase().ends_with(".zip") {
                            // Core may use hardlinks for installed pack artifacts.
                            let c = CString::new(name.as_str()).unwrap();
                            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
                            (unsafe {
                                libc::fstatat(
                                    packs.as_raw_fd(),
                                    c.as_ptr(),
                                    &mut stat,
                                    libc::AT_SYMLINK_NOFOLLOW,
                                )
                            }) == 0
                                && stat.st_mode & libc::S_IFMT == libc::S_IFREG
                        } else {
                            child(packs, &name, true)
                                .and_then(|dir| {
                                    if self.shader {
                                        child(&dir, "shaders", true)
                                    } else {
                                        child(&dir, "pack.mcmeta", false)
                                    }
                                })
                                .is_ok()
                        };
                        if valid {
                            names.push(if self.shader {
                                name
                            } else {
                                format!("file/{name}")
                            });
                        }
                    }
                }
                if names.len() > 4096 {
                    unsafe { libc::closedir(directory) };
                    return Err(error("PACK_ACTIVATION_FORMAT"));
                }
            }
            unsafe { libc::closedir(directory) };
            names.sort();
            Ok(names)
        }
        pub fn replace(
            &self,
            expected: &[u8],
            replacement: &[u8],
            nonce: u64,
        ) -> Result<(), SessionError> {
            let original = child(&self.game, self.target_name, false)?;
            let metadata = original
                .metadata()
                .map_err(|_| error("PACK_ACTIVATION_PATH"))?;
            if read_file(original)? != expected {
                return Err(error("PACK_ACTIVATION_CHANGED"));
            }
            let temporary =
                CString::new(format!(".jmcl-options-{}-{nonce}.tmp", std::process::id())).unwrap();
            let fd = unsafe {
                libc::openat(
                    self.game.as_raw_fd(),
                    temporary.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 {
                return Err(error("PACK_ACTIVATION_PATH"));
            }
            let mut output = unsafe { File::from_raw_fd(fd) };
            let result = (|| {
                output
                    .write_all(replacement)
                    .and_then(|_| {
                        output.set_permissions(std::fs::Permissions::from_mode(
                            metadata.mode() & 0o777,
                        ))
                    })
                    .and_then(|_| output.sync_all())
                    .map_err(|_| error("PACK_ACTIVATION_PATH"))?;
                // Immediately re-read the destination via the pinned directory.
                // External programs do not honor our gate: any observed change
                // invalidates the save rather than overwriting unknown settings.
                let current = child(&self.game, self.target_name, false)?;
                let current_meta = current
                    .metadata()
                    .map_err(|_| error("PACK_ACTIVATION_PATH"))?;
                if metadata.dev() != current_meta.dev()
                    || metadata.ino() != current_meta.ino()
                    || read_file(current)? != expected
                {
                    return Err(error("PACK_ACTIVATION_CHANGED"));
                }
                let destination = CString::new(self.target_name).unwrap();
                if unsafe {
                    libc::renameat(
                        self.game.as_raw_fd(),
                        temporary.as_ptr(),
                        self.game.as_raw_fd(),
                        destination.as_ptr(),
                    )
                } != 0
                {
                    return Err(error("PACK_ACTIVATION_PATH"));
                }
                self.game
                    .sync_all()
                    .map_err(|_| error("PACK_ACTIVATION_PATH"))
            })();
            if result.is_err() {
                unsafe { libc::unlinkat(self.game.as_raw_fd(), temporary.as_ptr(), 0) };
            }
            result
        }
    }
}

#[cfg(windows)]
#[path = "pack_activation/windows.rs"]
mod files;

impl PackActivationState {
    #[cfg(any(unix, windows))]
    async fn read(&self, root: String, id: String) -> Result<PackActivationSnapshot, SessionError> {
        let _guard = self
            .requests
            .try_write()
            .map_err(|_| error("PACK_ACTIVATION_BUSY"))?;
        let files = files::InstanceFiles::open(&root, &id)?;
        let original = files.options()?;
        let selected = parse_options(&original)?;
        let available = files.available()?;
        self.snapshot(root, id, original, selected, available).await
    }
    #[cfg(any(unix, windows))]
    async fn snapshot(
        &self,
        root: String,
        id: String,
        original: Vec<u8>,
        selected: Vec<String>,
        available: Vec<String>,
    ) -> Result<PackActivationSnapshot, SessionError> {
        let revision = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let mut snapshots = self.snapshots.lock().await;
        if snapshots.len() >= 64 {
            snapshots.clear();
        }
        snapshots.insert(
            revision.clone(),
            SavedSnapshot {
                root,
                id,
                original,
                selected: selected.clone(),
            },
        );
        Ok(PackActivationSnapshot {
            revision,
            resource_packs: selected,
            available_resource_packs: available,
        })
    }
    #[cfg(any(unix, windows))]
    async fn write(
        &self,
        root: String,
        id: String,
        revision: String,
        selected: Vec<String>,
        confirmed_stopped: bool,
    ) -> Result<PackActivationSnapshot, SessionError> {
        if !confirmed_stopped {
            return Err(error("PACK_ACTIVATION_CONFIRM_STOPPED"));
        }
        let _guard = self
            .requests
            .try_write()
            .map_err(|_| error("PACK_ACTIVATION_BUSY"))?;
        let saved = self
            .snapshots
            .lock()
            .await
            .remove(&revision)
            .ok_or_else(|| error("PACK_ACTIVATION_CHANGED"))?;
        if saved.root != root || saved.id != id {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        let files = files::InstanceFiles::open(&root, &id)?;
        if files.options()? != saved.original {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        let available = files.available()?;
        validate_selection(&selected, &saved.selected, &available)?;
        let replacement = replace_options(&saved.original, &selected)?;
        files.replace(
            &saved.original,
            &replacement,
            self.sequence.fetch_add(1, Ordering::Relaxed),
        )?;
        self.snapshot(root, id, replacement, selected, available)
            .await
    }
}

#[tauri::command]
pub async fn pack_activation_read(
    state: State<'_, PackActivationState>,
    instances_root: String,
    instance_id: String,
) -> Result<PackActivationSnapshot, SessionError> {
    #[cfg(any(unix, windows))]
    {
        state.read(instances_root, instance_id).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (state, instances_root, instance_id);
        Err(error("PACK_ACTIVATION_UNSUPPORTED"))
    }
}

#[tauri::command]
pub async fn pack_activation_write(
    state: State<'_, PackActivationState>,
    instances_root: String,
    instance_id: String,
    revision: String,
    resource_packs: Vec<String>,
    confirmed_stopped: bool,
) -> Result<PackActivationSnapshot, SessionError> {
    #[cfg(any(unix, windows))]
    {
        state
            .write(
                instances_root,
                instance_id,
                revision,
                resource_packs,
                confirmed_stopped,
            )
            .await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (
            state,
            instances_root,
            instance_id,
            revision,
            resource_packs,
            confirmed_stopped,
        );
        Err(error("PACK_ACTIVATION_UNSUPPORTED"))
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShaderRuntime {
    Iris,
    Oculus,
}

struct SavedShaderSnapshot {
    root: String,
    id: String,
    runtime: ShaderRuntime,
    original: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderActivationSnapshot {
    revision: String,
    runtime: ShaderRuntime,
    shader_pack: Option<String>,
    enabled: bool,
    available_shader_packs: Vec<String>,
}

// Deliberately limited Java Properties subset. Java supports Latin-1, escaped
// separators/unicode and continued lines; never reinterpret those as UTF-8 or
// silently corrupt them. Unknown simple properties and comments are untouched.
fn property(line: &str) -> Result<Option<(&str, &str)>, SessionError> {
    let line = line
        .trim_start_matches([' ', '\t', '\x0c'])
        .trim_end_matches(['\r', '\n']);
    if line.is_empty() || line.starts_with(['#', '!']) {
        return Ok(None);
    }
    if !line.is_ascii() || line.contains('\\') {
        return Err(error("PACK_ACTIVATION_FORMAT"));
    }
    let index = line
        .find(['=', ':', ' ', '\t', '\x0c'])
        .unwrap_or(line.len());
    let key = &line[..index];
    let remainder = line[index..].trim_start_matches([' ', '\t', '\x0c']);
    let value = remainder
        .strip_prefix(['=', ':'])
        .unwrap_or(remainder)
        .trim_start_matches([' ', '\t', '\x0c']);
    Ok(Some((key, value)))
}

fn parse_shader(bytes: &[u8]) -> Result<(Option<String>, bool), SessionError> {
    reject_bare_cr(bytes)?;
    let text = std::str::from_utf8(bytes).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let mut pack = None;
    let mut pack_seen = false;
    let mut enabled = None;
    for line in text.lines() {
        match property(line)? {
            Some(("shaderPack", value)) => {
                if pack_seen {
                    return Err(error("PACK_ACTIVATION_FORMAT"));
                }
                pack_seen = true;
                if !value.is_empty() && value != "(internal)" {
                    pack = Some(value.to_owned());
                }
            }
            Some(("enableShaders", value)) => {
                if enabled.is_some() {
                    return Err(error("PACK_ACTIVATION_FORMAT"));
                }
                enabled = Some(match value {
                    "true" => true,
                    "false" => false,
                    _ => return Err(error("PACK_ACTIVATION_FORMAT")),
                });
            }
            _ => (),
        }
    }
    // Existing runtime-generated config required; no guessed defaults.
    Ok((
        pack,
        enabled.ok_or_else(|| error("PACK_ACTIVATION_FORMAT"))?,
    ))
}

fn replace_shader(
    bytes: &[u8],
    pack: Option<&str>,
    enabled: bool,
) -> Result<Vec<u8>, SessionError> {
    parse_shader(bytes)?;
    let text = std::str::from_utf8(bytes).map_err(|_| error("PACK_ACTIVATION_FORMAT"))?;
    let mut output = String::new();
    let mut pack_written = false;
    for line in text.split_inclusive('\n') {
        let ending = if line.ends_with("\r\n") {
            "\r\n"
        } else if line.ends_with('\n') {
            "\n"
        } else {
            ""
        };
        match property(line)? {
            Some(("shaderPack", _)) => {
                pack_written = true;
                output.push_str(&format!(
                    "shaderPack={}{}",
                    pack.unwrap_or_default(),
                    ending
                ));
            }
            Some(("enableShaders", _)) => {
                output.push_str(&format!("enableShaders={enabled}{ending}"))
            }
            _ => output.push_str(line),
        }
    }
    if !pack_written && pack.is_some() {
        let ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
        if !output.is_empty() && !output.ends_with('\n') {
            output.push_str(ending);
        }
        output.push_str(&format!("shaderPack={}{}", pack.unwrap(), ending));
    }
    Ok(output.into_bytes())
}

impl PackActivationState {
    #[cfg(any(unix, windows))]
    async fn shader_snapshot(
        &self,
        root: String,
        id: String,
        runtime: ShaderRuntime,
        original: Vec<u8>,
        available: Vec<String>,
    ) -> Result<ShaderActivationSnapshot, SessionError> {
        let (shader_pack, enabled) = parse_shader(&original)?;
        let revision = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let mut snapshots = self.shader_snapshots.lock().await;
        if snapshots.len() >= 64 {
            snapshots.clear();
        }
        snapshots.insert(
            revision.clone(),
            SavedShaderSnapshot {
                root,
                id,
                runtime,
                original,
            },
        );
        Ok(ShaderActivationSnapshot {
            revision,
            runtime,
            shader_pack,
            enabled,
            available_shader_packs: available,
        })
    }
    #[cfg(any(unix, windows))]
    async fn read_shader(
        &self,
        root: String,
        id: String,
        runtime: ShaderRuntime,
    ) -> Result<ShaderActivationSnapshot, SessionError> {
        let _guard = self
            .requests
            .try_write()
            .map_err(|_| error("PACK_ACTIVATION_BUSY"))?;
        let files = files::InstanceFiles::shader(&root, &id, runtime)?;
        self.shader_snapshot(root, id, runtime, files.options()?, files.available()?)
            .await
    }
    #[cfg(any(unix, windows))]
    #[allow(clippy::too_many_arguments)]
    async fn write_shader(
        &self,
        root: String,
        id: String,
        runtime: ShaderRuntime,
        revision: String,
        pack: Option<String>,
        enabled: bool,
        confirmed_stopped: bool,
        confirmed_runtime: bool,
    ) -> Result<ShaderActivationSnapshot, SessionError> {
        if !confirmed_stopped {
            return Err(error("PACK_ACTIVATION_CONFIRM_STOPPED"));
        }
        if !confirmed_runtime {
            return Err(error("SHADER_ACTIVATION_CONFIRM_RUNTIME"));
        }
        let _guard = self
            .requests
            .try_write()
            .map_err(|_| error("PACK_ACTIVATION_BUSY"))?;
        let saved = self
            .shader_snapshots
            .lock()
            .await
            .remove(&revision)
            .ok_or_else(|| error("PACK_ACTIVATION_CHANGED"))?;
        if saved.root != root || saved.id != id || saved.runtime != runtime {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        let files = files::InstanceFiles::shader(&root, &id, runtime)?;
        if files.options()? != saved.original {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        let available = files.available()?;
        let (old_pack, _) = parse_shader(&saved.original)?;
        if (enabled && pack.is_none())
            || pack.as_ref().is_some_and(|p| {
                (!available.contains(p) && (enabled || pack != old_pack))
                    || p == "(internal)"
                    || !valid_name(p)
                    || !p.is_ascii()
                    || p.trim() != p
            })
        {
            return Err(error("PACK_ACTIVATION_SELECTION"));
        }
        let replacement = replace_shader(&saved.original, pack.as_deref(), enabled)?;
        files.replace(
            &saved.original,
            &replacement,
            self.sequence.fetch_add(1, Ordering::Relaxed),
        )?;
        self.shader_snapshot(root, id, runtime, replacement, available)
            .await
    }
}

#[tauri::command]
pub async fn shader_activation_read(
    state: State<'_, PackActivationState>,
    instances_root: String,
    instance_id: String,
    runtime: ShaderRuntime,
) -> Result<ShaderActivationSnapshot, SessionError> {
    #[cfg(any(unix, windows))]
    {
        state
            .read_shader(instances_root, instance_id, runtime)
            .await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (state, instances_root, instance_id, runtime);
        Err(error("PACK_ACTIVATION_UNSUPPORTED"))
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn shader_activation_write(
    state: State<'_, PackActivationState>,
    instances_root: String,
    instance_id: String,
    runtime: ShaderRuntime,
    revision: String,
    shader_pack: Option<String>,
    enabled: bool,
    confirmed_stopped: bool,
    confirmed_runtime: bool,
) -> Result<ShaderActivationSnapshot, SessionError> {
    #[cfg(any(unix, windows))]
    {
        state
            .write_shader(
                instances_root,
                instance_id,
                runtime,
                revision,
                shader_pack,
                enabled,
                confirmed_stopped,
                confirmed_runtime,
            )
            .await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (
            state,
            instances_root,
            instance_id,
            runtime,
            revision,
            shader_pack,
            enabled,
            confirmed_stopped,
            confirmed_runtime,
        );
        Err(error("PACK_ACTIVATION_UNSUPPORTED"))
    }
}

#[cfg(all(test, any(unix, windows)))]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "jmcl-pack-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let game = root.join("demo/.minecraft");
            fs::create_dir_all(game.join("resourcepacks/Folder")).unwrap();
            fs::create_dir_all(game.join("shaderpacks/ShaderFolder/shaders")).unwrap();
            fs::create_dir_all(game.join("config")).unwrap();
            fs::write(
                root.join("demo/instance.json"),
                r#"{"name":"Synthetic","id":"demo","version_id":"1.21.1"}"#,
            )
            .unwrap();
            fs::write(game.join("options.txt"), "music:0.4\r\nresourcePacks:[\"vanilla\",\"file/Old.zip\",\"mod/builtin\"]\r\nincompatibleResourcePacks:[\"file/Old.zip\"]\r\nunknown:keep:verbatim\r\n").unwrap();
            fs::write(game.join("resourcepacks/Old.zip"), "synthetic pack").unwrap();
            fs::write(game.join("resourcepacks/New.zip"), "synthetic pack").unwrap();
            fs::write(game.join("resourcepacks/Folder/pack.mcmeta"), "{}").unwrap();
            fs::write(game.join("shaderpacks/Shader.zip"), "synthetic shader").unwrap();
            fs::write(game.join("config/iris.properties"), "# synthetic fixture\r\nunknown=value\r\nenableShaders=false\r\nshaderPack=Shader.zip\r\nmaxShadowRenderDistance=32\r\n").unwrap();
            fs::write(
                game.join("config/oculus.properties"),
                "enableShaders=false\nshaderPack=Shader.zip\nother=1\n",
            )
            .unwrap();
            Self { root }
        }
        fn path(&self, path: &str) -> PathBuf {
            self.root.join("demo/.minecraft").join(path)
        }
        fn root(&self) -> String {
            self.root.to_str().unwrap().to_owned()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn code<T>(result: Result<T, SessionError>, expected: &str) {
        match result {
            Err(SessionError::Transport { code, .. }) => assert_eq!(code, expected),
            _ => panic!("expected {expected}"),
        }
    }

    #[tokio::test]
    async fn resource_selection_order_roundtrip_preserves_every_other_byte() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        let read = state.read(f.root(), "demo".into()).await.unwrap();
        assert_eq!(
            read.available_resource_packs,
            ["file/Folder", "file/New.zip", "file/Old.zip"]
        );
        let selected = vec![
            "vanilla".into(),
            "file/New.zip".into(),
            "mod/builtin".into(),
            "file/Old.zip".into(),
        ];
        let saved = state
            .write(
                f.root(),
                "demo".into(),
                read.revision,
                selected.clone(),
                true,
            )
            .await
            .unwrap();
        assert_eq!(saved.resource_packs, selected);
        assert_eq!(fs::read_to_string(f.path("options.txt")).unwrap(), "music:0.4\r\nresourcePacks:[\"vanilla\",\"file/New.zip\",\"mod/builtin\",\"file/Old.zip\"]\r\nincompatibleResourcePacks:[\"file/Old.zip\"]\r\nunknown:keep:verbatim\r\n");
        assert_eq!(
            fs::read_dir(f.path(""))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
    }
    #[test]
    fn options_parser_rejects_ambiguous_non_string_and_duplicate_entries() {
        for text in [
            "",
            "resourcePacks:[]\nresourcePacks:[]",
            "resourcePacks:[1]",
            "resourcePacks:[\"a\",\"a\"]",
            "resourcePacks:not json",
        ] {
            assert!(parse_options(text.as_bytes()).is_err(), "{text}");
        }
        assert_eq!(
            replace_options(b"first:x\nresourcePacks:[]", &["file/Foo.zip".into()]).unwrap(),
            b"first:x\nresourcePacks:[\"file/Foo.zip\"]"
        );
    }
    #[test]
    fn unknown_ids_must_remain_in_order_and_new_unknowns_are_rejected() {
        let old = vec!["vanilla".into(), "file/A.zip".into(), "mod/test".into()];
        let available = vec!["file/A.zip".into(), "file/B.zip".into()];
        assert!(
            validate_selection(&["mod/test".into(), "vanilla".into()], &old, &available).is_err()
        );
        assert!(validate_selection(
            &[
                "vanilla".into(),
                "mod/test".into(),
                "file/../../outside".into()
            ],
            &old,
            &available
        )
        .is_err());
        assert!(
            validate_selection(&["vanilla".into(), "mod/test".into()], &old, &available).is_ok()
        );
    }
    #[tokio::test]
    async fn confirmation_guard_and_scope_revision_are_native_enforced() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state.read(f.root(), "demo".into()).await.unwrap();
        code(
            state
                .write(
                    f.root(),
                    "demo".into(),
                    s.revision.clone(),
                    s.resource_packs.clone(),
                    false,
                )
                .await,
            "PACK_ACTIVATION_CONFIRM_STOPPED",
        );
        let guard = state.requests.read().await;
        code(
            state.read(f.root(), "demo".into()).await,
            "PACK_ACTIVATION_BUSY",
        );
        code(
            state
                .write(
                    f.root(),
                    "demo".into(),
                    s.revision.clone(),
                    s.resource_packs.clone(),
                    true,
                )
                .await,
            "PACK_ACTIVATION_BUSY",
        );
        drop(guard);
        code(
            state
                .write(
                    f.root(),
                    "other".into(),
                    s.revision.clone(),
                    s.resource_packs.clone(),
                    true,
                )
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
        code(
            state
                .write(f.root(), "demo".into(), s.revision, s.resource_packs, true)
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
    }
    #[tokio::test]
    async fn concurrent_external_change_is_not_overwritten_and_revision_is_single_use() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state.read(f.root(), "demo".into()).await.unwrap();
        fs::write(f.path("options.txt"), "resourcePacks:[]\nnew:external").unwrap();
        code(
            state
                .write(
                    f.root(),
                    "demo".into(),
                    s.revision.clone(),
                    s.resource_packs.clone(),
                    true,
                )
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
        assert_eq!(
            fs::read_to_string(f.path("options.txt")).unwrap(),
            "resourcePacks:[]\nnew:external"
        );
        code(
            state
                .write(f.root(), "demo".into(), s.revision, s.resource_packs, true)
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
    }
    #[tokio::test]
    async fn rejects_parent_traversal_relative_roots_and_wrong_manifest() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        for id in ["..", "../demo", "demo/a", "demo\\a", "demo:other"] {
            assert!(state.read(f.root(), id.into()).await.is_err());
        }
        for root in [
            "relative".into(),
            format!(
                "{}/../{}",
                f.root(),
                f.root.file_name().unwrap().to_str().unwrap()
            ),
            format!("{}/.", f.root()),
        ] {
            assert!(state.read(root, "demo".into()).await.is_err());
        }
        fs::write(
            f.root.join("demo/instance.json"),
            r#"{"name":"Synthetic","id":"other","version_id":"1.21.1"}"#,
        )
        .unwrap();
        assert!(state.read(f.root(), "demo".into()).await.is_err());
    }
    #[tokio::test]
    async fn unsupported_versions_and_missing_options_never_create_files() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        for version in ["1.12.2", "24w10a", "custom", "26.1", "1.13-pre1"] {
            fs::write(
                f.root.join("demo/instance.json"),
                format!(r#"{{"name":"Synthetic","id":"demo","version_id":"{version}"}}"#),
            )
            .unwrap();
            code(
                state.read(f.root(), "demo".into()).await,
                "PACK_ACTIVATION_FORMAT",
            );
        }
        fs::write(
            f.root.join("demo/instance.json"),
            r#"{"name":"Synthetic","id":"demo","version_id":"1.21"}"#,
        )
        .unwrap();
        fs::remove_file(f.path("options.txt")).unwrap();
        code(
            state.read(f.root(), "demo".into()).await,
            "PACK_ACTIVATION_OPTIONS_MISSING",
        );
        assert!(!f.path("options.txt").exists());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlinked_paths_targets_and_hardlinked_config() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let state = PackActivationState::default();
        symlink(f.root.join("demo"), f.root.join("alias")).unwrap();
        assert!(state.read(f.root(), "alias".into()).await.is_err());
        fs::rename(f.path("options.txt"), f.path("real.txt")).unwrap();
        symlink("real.txt", f.path("options.txt")).unwrap();
        assert!(state.read(f.root(), "demo".into()).await.is_err());
        fs::remove_file(f.path("options.txt")).unwrap();
        fs::hard_link(f.path("real.txt"), f.path("options.txt")).unwrap();
        assert!(state.read(f.root(), "demo".into()).await.is_err());
        fs::remove_file(f.path("options.txt")).unwrap();
        fs::rename(f.path("real.txt"), f.path("options.txt")).unwrap();
        fs::rename(f.path("resourcepacks"), f.path("realpacks")).unwrap();
        symlink("realpacks", f.path("resourcepacks")).unwrap();
        assert!(state.read(f.root(), "demo".into()).await.is_err());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn symlinked_pack_not_offered_but_core_hardlinked_zip_is_available() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let state = PackActivationState::default();
        symlink("Old.zip", f.path("resourcepacks/Link.zip")).unwrap();
        fs::hard_link(
            f.path("resourcepacks/Old.zip"),
            f.path("resourcepacks/Hard.zip"),
        )
        .unwrap();
        let s = state.read(f.root(), "demo".into()).await.unwrap();
        assert!(!s.available_resource_packs.contains(&"file/Link.zip".into()));
        assert!(s.available_resource_packs.contains(&"file/Hard.zip".into()));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn removed_selected_pack_and_late_target_symlink_are_rejected() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state.read(f.root(), "demo".into()).await.unwrap();
        fs::remove_file(f.path("resourcepacks/New.zip")).unwrap();
        let mut selected = s.resource_packs.clone();
        selected.push("file/New.zip".into());
        code(
            state
                .write(f.root(), "demo".into(), s.revision, selected, true)
                .await,
            "PACK_ACTIVATION_SELECTION",
        );
        let s = state.read(f.root(), "demo".into()).await.unwrap();
        fs::rename(f.path("options.txt"), f.path("real.txt")).unwrap();
        symlink("real.txt", f.path("options.txt")).unwrap();
        assert!(state
            .write(f.root(), "demo".into(), s.revision, s.resource_packs, true)
            .await
            .is_err());
    }
    #[test]
    fn java_properties_subset_preserves_comments_order_unknowns_and_line_endings() {
        let input=b"# comment\r\nunknown : keep\r\nenableShaders : false\r\nshaderPack = Old.zip\r\nlast=unchanged";
        assert_eq!(
            parse_shader(input).unwrap(),
            (Some("Old.zip".into()), false)
        );
        assert_eq!(replace_shader(input,Some("New pack.zip"),true).unwrap(), b"# comment\r\nunknown : keep\r\nenableShaders=true\r\nshaderPack=New pack.zip\r\nlast=unchanged");
        assert_eq!(
            replace_shader(b"enableShaders=false", Some("New.zip"), true).unwrap(),
            b"enableShaders=true\nshaderPack=New.zip\n"
        );
    }
    #[test]
    fn java_properties_escapes_continuations_duplicates_invalid_bools_fail_closed() {
        for input in [
            "enableShaders=true\nshaderPack=A\\ B.zip",
            "enableShaders=true\nunknown=continued\\\nnext",
            "enableShaders=true\nenableShaders=false",
            "enableShaders=true\nshaderPack=A\nshaderPack=B",
            "enableShaders=maybe",
            "shaderPack=Only.zip",
            "enableShaders=true\nunknown=é",
        ] {
            assert!(parse_shader(input.as_bytes()).is_err(), "{input}");
        }
    }
    #[tokio::test]
    async fn iris_and_oculus_have_distinct_fixed_configs_and_revision_scope() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .unwrap();
        assert_eq!(s.available_shader_packs, ["Shader.zip", "ShaderFolder"]);
        let saved = state
            .write_shader(
                f.root(),
                "demo".into(),
                ShaderRuntime::Iris,
                s.revision,
                Some("ShaderFolder".into()),
                true,
                true,
                true,
            )
            .await
            .unwrap();
        assert!(saved.enabled);
        assert!(fs::read_to_string(f.path("config/iris.properties")).unwrap().contains("unknown=value\r\nenableShaders=true\r\nshaderPack=ShaderFolder\r\nmaxShadowRenderDistance=32"));
        assert!(fs::read_to_string(f.path("config/oculus.properties"))
            .unwrap()
            .contains("enableShaders=false"));
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Oculus,
                    saved.revision,
                    Some("Shader.zip".into()),
                    true,
                    true,
                    true,
                )
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
    }
    #[tokio::test]
    async fn shader_requires_both_confirmations_and_installed_pack_when_enabling() {
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .unwrap();
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    s.revision.clone(),
                    Some("Shader.zip".into()),
                    true,
                    false,
                    true,
                )
                .await,
            "PACK_ACTIVATION_CONFIRM_STOPPED",
        );
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    s.revision.clone(),
                    Some("Shader.zip".into()),
                    true,
                    true,
                    false,
                )
                .await,
            "SHADER_ACTIVATION_CONFIRM_RUNTIME",
        );
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    s.revision,
                    Some("missing.zip".into()),
                    true,
                    true,
                    true,
                )
                .await,
            "PACK_ACTIVATION_SELECTION",
        );
        fs::remove_file(f.path("shaderpacks/Shader.zip")).unwrap();
        let s = state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .unwrap();
        assert!(state
            .write_shader(
                f.root(),
                "demo".into(),
                ShaderRuntime::Iris,
                s.revision,
                Some("Shader.zip".into()),
                false,
                true,
                true
            )
            .await
            .is_ok());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn shader_missing_config_symlink_and_external_changes_fail_closed() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let state = PackActivationState::default();
        let s = state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .unwrap();
        fs::write(
            f.path("config/iris.properties"),
            "enableShaders=true\nexternal=change",
        )
        .unwrap();
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    s.revision,
                    None,
                    false,
                    true,
                    true,
                )
                .await,
            "PACK_ACTIVATION_CHANGED",
        );
        fs::remove_file(f.path("config/iris.properties")).unwrap();
        code(
            state
                .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
                .await,
            "SHADER_ACTIVATION_CONFIG_MISSING",
        );
        symlink("oculus.properties", f.path("config/iris.properties")).unwrap();
        assert!(state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .is_err());
    }
    #[tokio::test]
    async fn bare_cr_cannot_hide_duplicate_keys_and_internal_shader_is_not_a_pack() {
        assert!(parse_shader(
            b"enableShaders=false\nunknown=x\renableShaders=true\nshaderPack=Shader.zip\n"
        )
        .is_err());
        assert!(
            parse_options(b"resourcePacks:[]\nunknown:x\rresourcePacks:[\"file/Hidden.zip\"]")
                .is_err()
        );
        assert_eq!(
            parse_shader(b"enableShaders=false\nshaderPack=(internal)\n").unwrap(),
            (None, false)
        );
        let f = Fixture::new();
        let state = PackActivationState::default();
        fs::create_dir_all(f.path("shaderpacks/(internal)/shaders")).unwrap();
        let s = state
            .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
            .await
            .unwrap();
        assert!(!s.available_shader_packs.contains(&"(internal)".into()));
        code(
            state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    s.revision,
                    Some("(internal)".into()),
                    true,
                    true,
                    true,
                )
                .await,
            "PACK_ACTIVATION_SELECTION",
        );
    }
    #[test]
    fn manifest_validation_matches_core_portable_id_schema_and_loader_rules() {
        for id in [
            "Upper",
            "has space",
            "con",
            "con.ext",
            "com1",
            "lpt9.ext",
            "name.",
            "../escape",
            "",
        ] {
            assert!(!valid_instance_id(id), "{id}");
        }
        assert!(valid_instance_id("fabric_test-1.21"));
        let good = serde_json::json!({"id":"demo","name":"Demo","version_id":"1.21.1"});
        assert!(validate_manifest(&good, "demo").is_ok());
        for bad in [
            serde_json::json!({"schema_version":2}),
            serde_json::json!({"name":""}),
            serde_json::json!({"version_id":""}),
            serde_json::json!({"source":"other"}),
            serde_json::json!({"fabric_loader":"1","forge_version":"2"}),
        ] {
            let mut value = good.clone();
            for (k, v) in bad.as_object().unwrap() {
                value[k] = v.clone();
            }
            assert!(validate_manifest(&value, "demo").is_err());
        }
    }
    #[cfg(windows)]
    mod windows {
        use super::*;
        use std::process::Command;
        fn junction(link: &std::path::Path, target: &std::path::Path) {
            // Only process-owned synthetic fixture paths; no elevation or system
            // settings changes. Junctions require no symlink developer privilege.
            // cmd's built-in mklink uses ordinary drive paths; the fixture's
            // canonicalized paths carry Rust's extended-length prefix.
            let ordinary = |path: &std::path::Path| {
                let text = path.to_str().unwrap();
                text.strip_prefix(r"\\?\").unwrap_or(text).to_owned()
            };
            let output = Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(ordinary(link))
                .arg(ordinary(target))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "junction: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        #[tokio::test]
        async fn junctions_at_root_instance_game_packs_and_config_are_rejected() {
            for component in [
                "",
                "demo",
                "demo/.minecraft",
                "demo/.minecraft/resourcepacks",
                "demo/.minecraft/config",
            ] {
                let f = Fixture::new();
                let state = PackActivationState::default();
                let target = if component.is_empty() {
                    f.root.clone()
                } else {
                    f.root.join(component)
                };
                let moved = target.with_extension("actual");
                fs::rename(&target, &moved).unwrap();
                junction(&target, &moved);
                if component.ends_with("config") {
                    assert!(state
                        .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
                        .await
                        .is_err());
                } else {
                    assert!(state.read(f.root(), "demo".into()).await.is_err());
                }
                // Explicitly remove junction itself before returning real tree;
                // cleanup never recursively follows a junction.
                fs::remove_dir(&target).unwrap();
                fs::rename(&moved, &target).unwrap();
            }
        }
        #[tokio::test]
        async fn target_hardlinks_late_replacement_and_runtime_conflicts_fail_closed() {
            let f = Fixture::new();
            let state = PackActivationState::default();
            let snapshot = state.read(f.root(), "demo".into()).await.unwrap();
            fs::rename(f.path("options.txt"), f.path("real.txt")).unwrap();
            fs::hard_link(f.path("real.txt"), f.path("options.txt")).unwrap();
            assert!(state
                .write(
                    f.root(),
                    "demo".into(),
                    snapshot.revision,
                    snapshot.resource_packs,
                    true
                )
                .await
                .is_err());
            assert_eq!(
                fs::read(f.path("real.txt")).unwrap(),
                fs::read(f.path("options.txt")).unwrap()
            );
            for runtime in [ShaderRuntime::Iris, ShaderRuntime::Oculus] {
                let name = if runtime == ShaderRuntime::Iris {
                    "iris.properties"
                } else {
                    "oculus.properties"
                };
                let snapshot = state
                    .read_shader(f.root(), "demo".into(), runtime)
                    .await
                    .unwrap();
                let path = f.path(&format!("config/{name}"));
                fs::write(&path, "enableShaders=false\nexternal=changed\n").unwrap();
                code(
                    state
                        .write_shader(
                            f.root(),
                            "demo".into(),
                            runtime,
                            snapshot.revision,
                            None,
                            false,
                            true,
                            true,
                        )
                        .await,
                    "PACK_ACTIVATION_CHANGED",
                );
                assert_eq!(
                    fs::read_to_string(&path).unwrap(),
                    "enableShaders=false\nexternal=changed\n"
                );
                fs::hard_link(&path, f.path(&format!("config/{name}.link"))).unwrap();
                assert!(state
                    .read_shader(f.root(), "demo".into(), runtime)
                    .await
                    .is_err());
            }
        }
        #[tokio::test]
        async fn pack_junction_not_offered_and_core_hardlinked_zip_is_available() {
            let f = Fixture::new();
            junction(
                &f.path("resourcepacks/LinkedFolder"),
                &f.path("resourcepacks/Folder"),
            );
            fs::hard_link(
                f.path("resourcepacks/New.zip"),
                f.path("resourcepacks/Hard.zip"),
            )
            .unwrap();
            let snapshot = PackActivationState::default()
                .read(f.root(), "demo".into())
                .await
                .unwrap();
            assert!(!snapshot
                .available_resource_packs
                .contains(&"file/LinkedFolder".into()));
            assert!(snapshot
                .available_resource_packs
                .contains(&"file/Hard.zip".into()));
            fs::remove_dir(f.path("resourcepacks/LinkedFolder")).unwrap();
        }
        #[tokio::test]
        async fn late_target_and_shader_file_symlinks_never_modify_referents() {
            use std::os::windows::fs::symlink_file;
            let f = Fixture::new();
            let state = PackActivationState::default();
            let snapshot = state.read(f.root(), "demo".into()).await.unwrap();
            let outside = f.root.join("outside-options.txt");
            fs::write(&outside, "outside sentinel").unwrap();
            fs::remove_file(f.path("options.txt")).unwrap();
            symlink_file(&outside, f.path("options.txt")).unwrap();
            assert!(state
                .write(
                    f.root(),
                    "demo".into(),
                    snapshot.revision,
                    snapshot.resource_packs,
                    true
                )
                .await
                .is_err());
            assert_eq!(fs::read_to_string(&outside).unwrap(), "outside sentinel");
            let snapshot = state
                .read_shader(f.root(), "demo".into(), ShaderRuntime::Iris)
                .await
                .unwrap();
            fs::remove_file(f.path("config/iris.properties")).unwrap();
            symlink_file(&outside, f.path("config/iris.properties")).unwrap();
            assert!(state
                .write_shader(
                    f.root(),
                    "demo".into(),
                    ShaderRuntime::Iris,
                    snapshot.revision,
                    None,
                    false,
                    true,
                    true
                )
                .await
                .is_err());
            assert_eq!(fs::read_to_string(&outside).unwrap(), "outside sentinel");
        }
        #[test]
        fn pinned_ancestors_cannot_be_renamed_and_staging_collision_does_not_overwrite() {
            let f = Fixture::new();
            let files = files::InstanceFiles::open(&f.root(), "demo").unwrap();
            assert!(fs::rename(f.root.join("demo"), f.root.join("moved")).is_err());
            assert!(fs::rename(f.path(""), f.root.join("moved-game")).is_err());
            let original = files.options().unwrap();
            let temporary = f.path(&format!(".jmcl-options-{}-123456.tmp", std::process::id()));
            fs::write(&temporary, "do not overwrite").unwrap();
            assert!(files
                .replace(&original, b"resourcePacks:[]\n", 123456)
                .is_err());
            assert_eq!(fs::read_to_string(&temporary).unwrap(), "do not overwrite");
            assert_eq!(files.options().unwrap(), original);
        }
        #[tokio::test]
        async fn bounded_reads_and_windows_namespace_aliases_fail_closed() {
            let f = Fixture::new();
            let state = PackActivationState::default();
            for root in [
                r"\\server\share".to_owned(),
                r"\\.\C:\path".to_owned(),
                r"C:relative".to_owned(),
                format!("{}\\..", f.root()),
                format!("{}\\.", f.root()),
                format!("{}:stream", f.root()),
                format!("{} ", f.root()),
            ] {
                assert!(state.read(root, "demo".into()).await.is_err());
            }
            fs::write(f.path("options.txt"), vec![b'x'; MAX_OPTIONS + 1]).unwrap();
            code(
                state.read(f.root(), "demo".into()).await,
                "PACK_ACTIVATION_FORMAT",
            );
        }
        #[test]
        fn competing_target_write_handle_blocks_save_without_partial_write() {
            use std::fs::OpenOptions;
            use std::os::windows::fs::OpenOptionsExt;
            let f = Fixture::new();
            let files = files::InstanceFiles::open(&f.root(), "demo").unwrap();
            let original = files.options().unwrap();
            let _writer = OpenOptions::new()
                .write(true)
                .share_mode(7)
                .open(f.path("options.txt"))
                .unwrap();
            assert!(files
                .replace(&original, b"resourcePacks:[]\n", 999)
                .is_err());
            assert_eq!(fs::read(f.path("options.txt")).unwrap(), original);
        }
    }
}
