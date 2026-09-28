use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::Ipv6Addr;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use thiserror::Error;

pub const ENDPOINT_CONFIG_FILE_NAME: &str = "endpoints.v1.json";
pub const MAX_ENDPOINT_CONFIG_BYTES: usize = 256 * 1024;
pub const MAX_ENDPOINTS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "lowercase")]
pub enum Endpoint {
    Local {
        id: String,
        label: String,
    },
    Ssh {
        id: String,
        label: String,
        destination: String,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "serversDirectory"
        )]
        servers_directory: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointConfigV1 {
    pub version: u8,
    pub endpoints: Vec<Endpoint>,
}

#[derive(Debug, Error)]
pub enum EndpointError {
    #[error("endpoint configuration is invalid")]
    Validation,
    #[error("endpoint configuration serialization failed")]
    Serialization,
    #[error("endpoint configuration I/O failed during {0}")]
    Io(&'static str),
}

pub fn canonical_endpoint_config() -> EndpointConfigV1 {
    EndpointConfigV1 {
        version: 1,
        endpoints: vec![Endpoint::Local {
            id: "local".into(),
            label: "Local".into(),
        }],
    }
}

pub fn validate_destination(input: &str) -> Result<String, EndpointError> {
    let value = input.trim();
    if value.is_empty()
        || value.len() > 255
        || !value.is_ascii()
        || value.starts_with('-')
        || value
            .bytes()
            .any(|c| c.is_ascii_whitespace() || c.is_ascii_control())
        || value.chars().any(|c| "\\;|&$`<>\"'(){}!*?".contains(c))
    {
        return Err(EndpointError::Validation);
    }
    let (user, host) = match value.split_once('@') {
        Some((user, host)) if !host.contains('@') => (Some(user), host),
        Some(_) => return Err(EndpointError::Validation),
        None => (None, value),
    };
    if user.is_some_and(|s| s.is_empty() || !s.bytes().all(host_token_char)) {
        return Err(EndpointError::Validation);
    }
    if host.starts_with('[') && host.ends_with(']') {
        let inner = &host[1..host.len() - 1];
        if inner.parse::<Ipv6Addr>().is_err() {
            return Err(EndpointError::Validation);
        }
    } else if !valid_host(host) {
        return Err(EndpointError::Validation);
    }
    Ok(value.to_owned())
}

fn host_token_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
}
fn valid_host(host: &str) -> bool {
    let bytes = host.as_bytes();
    !bytes.is_empty()
        && bytes[0].is_ascii_alphanumeric()
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.iter().all(|c| host_token_char(*c))
}

pub fn validate_endpoint_config(config: &EndpointConfigV1) -> Result<(), EndpointError> {
    if config.version != 1
        || config.endpoints.is_empty()
        || config.endpoints.len() > MAX_ENDPOINTS
        || !matches!(config.endpoints.first(), Some(Endpoint::Local { id, label }) if id == "local" && label == "Local")
    {
        return Err(EndpointError::Validation);
    }
    let mut ids = std::collections::HashSet::new();
    let mut local_count = 0;
    for endpoint in &config.endpoints {
        match endpoint {
            Endpoint::Local { id, label } => {
                local_count += 1;
                if id != "local" || label != "Local" {
                    return Err(EndpointError::Validation);
                }
            }
            Endpoint::Ssh {
                id,
                label,
                destination,
                servers_directory,
            } => {
                if !valid_uuid(id)
                    || label.trim().is_empty()
                    || label.trim().chars().count() > 80
                    || label.trim().chars().any(char::is_control)
                    || validate_destination(destination).is_err()
                {
                    return Err(EndpointError::Validation);
                }
                if let Some(directory) = servers_directory {
                    let value = directory.trim();
                    if !value.is_empty()
                        && (!value.starts_with('/')
                            || value.len() > 4096
                            || value.contains('\0')
                            || value.contains('\r')
                            || value.contains('\n'))
                    {
                        return Err(EndpointError::Validation);
                    }
                }
            }
        }
        let id = match endpoint {
            Endpoint::Local { id, .. } | Endpoint::Ssh { id, .. } => id,
        };
        if !ids.insert(id) {
            return Err(EndpointError::Validation);
        }
    }
    if local_count != 1 {
        return Err(EndpointError::Validation);
    }
    let bytes = serde_json::to_vec(config).map_err(|_| EndpointError::Serialization)?;
    if bytes.len() > MAX_ENDPOINT_CONFIG_BYTES {
        return Err(EndpointError::Validation);
    }
    Ok(())
}

fn valid_uuid(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 36 || [8, 13, 18, 23].iter().any(|i| b[*i] != b'-') {
        return false;
    }
    if !b.iter().enumerate().all(|(i, c)| {
        [8, 13, 18, 23].contains(&i) || c.is_ascii_digit() || (b'a'..=b'f').contains(c)
    }) {
        return false;
    }
    matches!(b[14], b'1'..=b'5') && matches!(b[19], b'8' | b'9' | b'a' | b'b')
}

pub fn parse_endpoint_config(bytes: &[u8]) -> EndpointConfigV1 {
    if bytes.len() > MAX_ENDPOINT_CONFIG_BYTES {
        return canonical_endpoint_config();
    }
    match serde_json::from_slice::<EndpointConfigV1>(bytes) {
        Ok(config) => {
            let config = canonicalize_config(config);
            if validate_endpoint_config(&config).is_ok() {
                config
            } else {
                canonical_endpoint_config()
            }
        }
        _ => canonical_endpoint_config(),
    }
}

fn canonicalize_config(mut config: EndpointConfigV1) -> EndpointConfigV1 {
    for endpoint in &mut config.endpoints {
        if let Endpoint::Ssh {
            label,
            destination,
            servers_directory,
            ..
        } = endpoint
        {
            *label = label.trim().to_owned();
            *destination = destination.trim().to_owned();
            *servers_directory = servers_directory.take().and_then(|path| {
                let path = path.trim().to_owned();
                (!path.is_empty()).then_some(path)
            });
        }
    }
    config
}

pub fn read_endpoint_config_from_dir(dir: &Path) -> Result<EndpointConfigV1, EndpointError> {
    let file = match File::open(dir.join(ENDPOINT_CONFIG_FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(canonical_endpoint_config())
        }
        Err(_) => return Err(EndpointError::Io("opening config")),
    };
    let metadata = file
        .metadata()
        .map_err(|_| EndpointError::Io("reading config metadata"))?;
    if metadata.len() > MAX_ENDPOINT_CONFIG_BYTES as u64 {
        return Ok(canonical_endpoint_config());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_ENDPOINT_CONFIG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| EndpointError::Io("reading config"))?;
    Ok(parse_endpoint_config(&bytes))
}

/// Strict counterpart used when opening a persisted endpoint session. The
/// Stage 2A convenience reader intentionally falls back to Local for recovery;
/// a session open must distinguish corrupt configuration from a missing ID.
pub fn read_endpoint_config_strict_from_dir(dir: &Path) -> Result<EndpointConfigV1, EndpointError> {
    let file = match File::open(dir.join(ENDPOINT_CONFIG_FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(canonical_endpoint_config())
        }
        Err(_) => return Err(EndpointError::Io("opening config")),
    };
    let metadata = file
        .metadata()
        .map_err(|_| EndpointError::Io("reading config metadata"))?;
    if metadata.len() > MAX_ENDPOINT_CONFIG_BYTES as u64 {
        return Err(EndpointError::Validation);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_ENDPOINT_CONFIG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| EndpointError::Io("reading config"))?;
    if bytes.len() > MAX_ENDPOINT_CONFIG_BYTES {
        return Err(EndpointError::Validation);
    }
    let config = serde_json::from_slice::<EndpointConfigV1>(&bytes)
        .map_err(|_| EndpointError::Validation)?;
    let config = canonicalize_config(config);
    validate_endpoint_config(&config)?;
    Ok(config)
}

pub fn write_endpoint_config_to_dir(
    dir: &Path,
    config: &EndpointConfigV1,
) -> Result<(), EndpointError> {
    let config = canonicalize_config(config.clone());
    validate_endpoint_config(&config)?;
    let bytes = serde_json::to_vec(&config).map_err(|_| EndpointError::Serialization)?;
    if bytes.len() > MAX_ENDPOINT_CONFIG_BYTES {
        return Err(EndpointError::Validation);
    }
    fs::create_dir_all(dir).map_err(|_| EndpointError::Io("creating app data directory"))?;
    let destination = dir.join(ENDPOINT_CONFIG_FILE_NAME);
    let temporary = temporary_path(dir);
    let result = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| EndpointError::Io("creating temporary config"))?;
        file.write_all(&bytes)
            .map_err(|_| EndpointError::Io("writing temporary config"))?;
        file.flush()
            .map_err(|_| EndpointError::Io("flushing temporary config"))?;
        file.sync_all()
            .map_err(|_| EndpointError::Io("syncing temporary config"))?;
        drop(file);
        replace_destination(&temporary, &destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path(dir: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    dir.join(format!(
        ".{ENDPOINT_CONFIG_FILE_NAME}.tmp-{}-{nonce}",
        std::process::id()
    ))
}

#[cfg(not(windows))]
fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), EndpointError> {
    fs::rename(temporary, destination).map_err(|_| EndpointError::Io("replacing config"))?;
    File::open(
        destination
            .parent()
            .ok_or(EndpointError::Io("finding app data directory"))?,
    )
    .and_then(|dir| dir.sync_all())
    .map_err(|_| EndpointError::Io("syncing app data directory"))
}

#[cfg(windows)]
fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), EndpointError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(EndpointError::Io("replacing config"))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn endpoint_config_read(app: tauri::AppHandle) -> Result<EndpointConfigV1, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_owned())?;
    read_endpoint_config_from_dir(&dir).map_err(|_| "endpoint config read failed".to_owned())
}

#[tauri::command]
pub fn endpoint_config_write(
    app: tauri::AppHandle,
    config: EndpointConfigV1,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_owned())?;
    write_endpoint_config_to_dir(&dir, &config)
        .map_err(|_| "endpoint config write failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("jmcl-endpoints-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn ssh(id: usize) -> Endpoint {
        Endpoint::Ssh {
            id: format!("123e4567-e89b-42d3-a456-{id:012x}"),
            label: "Remote".into(),
            destination: "pi".into(),
            servers_directory: None,
        }
    }
    fn config_with(count: usize) -> EndpointConfigV1 {
        let mut endpoints = vec![Endpoint::Local {
            id: "local".into(),
            label: "Local".into(),
        }];
        endpoints.extend((0..count).map(ssh));
        EndpointConfigV1 {
            version: 1,
            endpoints,
        }
    }

    #[test]
    fn reads_missing_corrupt_oversized_unsupported_wrong_shape_unknown_and_invalid_as_default() {
        let dir = temp_dir();
        assert_eq!(
            read_endpoint_config_from_dir(&dir).unwrap(),
            canonical_endpoint_config()
        );
        let path = dir.join(ENDPOINT_CONFIG_FILE_NAME);
        for bytes in [
            b"{".as_slice(),
            br#"{"version":2,"endpoints":[]}"#.as_slice(),
            br#"{"version":1,"endpoints":[{"id":"local","kind":"local","label":"Local"}],"extra":1}"#.as_slice(),
            br#"{"version":1,"endpoints":{}}"#.as_slice(),
            br#"{"version":1,"endpoints":[{"id":"local","kind":"local","label":"Local","extra":1}]}"#.as_slice(),
            br#"{"version":1,"endpoints":[{"id":"local","kind":"local","label":"Local"},{"id":"123e4567-e89b-42d3-a456-426614174000","kind":"ssh","label":"Remote","destination":"pi","extra":1}]}"#.as_slice(),
            br#"{"version":1,"endpoints":[{"id":"local","kind":"local","label":"Local"},{"id":"bad","kind":"ssh","label":"x","destination":"pi"}]}"#.as_slice(),
        ] {
            fs::write(&path, bytes).unwrap();
            assert_eq!(read_endpoint_config_from_dir(&dir).unwrap(), canonical_endpoint_config());
        }
        fs::write(&path, vec![b' '; MAX_ENDPOINT_CONFIG_BYTES + 1]).unwrap();
        assert_eq!(
            read_endpoint_config_from_dir(&dir).unwrap(),
            canonical_endpoint_config()
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn boundary_tables_match_the_typescript_contract() {
        assert!(validate_endpoint_config(&config_with(63)).is_ok());
        assert!(validate_endpoint_config(&config_with(64)).is_err());
        let mut value = config_with(1);
        if let Endpoint::Ssh { label, .. } = &mut value.endpoints[1] {
            *label = "😀".repeat(80);
        }
        assert!(validate_endpoint_config(&value).is_ok());
        if let Endpoint::Ssh { label, .. } = &mut value.endpoints[1] {
            *label = "😀".repeat(81);
        }
        assert!(validate_endpoint_config(&value).is_err());
        for (destination, valid) in [("a".repeat(255), true), ("a".repeat(256), false)] {
            assert_eq!(validate_destination(&destination).is_ok(), valid);
        }
        let mut value = config_with(1);
        if let Endpoint::Ssh {
            servers_directory, ..
        } = &mut value.endpoints[1]
        {
            *servers_directory = Some(format!("/{}a", "é".repeat(2047)));
        }
        assert!(validate_endpoint_config(&value).is_ok());
        if let Endpoint::Ssh {
            servers_directory, ..
        } = &mut value.endpoints[1]
        {
            *servers_directory = Some(format!("/{}", "é".repeat(2048)));
        }
        assert!(validate_endpoint_config(&value).is_err());
    }

    #[test]
    fn destination_table_accepts_only_aligned_tokens() {
        for value in ["pi", "user@pi", "host.example", "user@[2001:db8::1]"] {
            assert!(validate_destination(value).is_ok(), "{value}");
        }
        for value in [
            "-oProxyCommand=x",
            "two words",
            "bad\nname",
            "host;id",
            "[2001:::1]",
            "user@@pi",
            "[abc]",
        ] {
            assert!(validate_destination(value).is_err(), "{value}");
        }
        let mut invalid = config_with(1);
        if let Endpoint::Ssh { id, .. } = &mut invalid.endpoints[1] {
            *id = "123E4567-E89B-42D3-A456-426614174000".into();
        }
        assert!(validate_endpoint_config(&invalid).is_err());
        if let Endpoint::Ssh { label, .. } = &mut invalid.endpoints[1] {
            *label = "bad\0label".into();
        }
        assert!(validate_endpoint_config(&invalid).is_err());
        let mut trimmed_label = config_with(1);
        if let Endpoint::Ssh { label, .. } = &mut trimmed_label.endpoints[1] {
            *label = "\tRemote\t".into();
        }
        assert!(validate_endpoint_config(&trimmed_label).is_ok());
    }

    #[test]
    fn strict_write_rejects_invalid_config_and_round_trip_replaces_fixed_file_atomically() {
        let dir = temp_dir();
        let valid = config_with(1);
        write_endpoint_config_to_dir(&dir, &valid).unwrap();
        assert!(dir.join(ENDPOINT_CONFIG_FILE_NAME).is_file());
        assert_eq!(read_endpoint_config_from_dir(&dir).unwrap(), valid);
        let mut replacement = config_with(2);
        if let Endpoint::Ssh { destination, .. } = &mut replacement.endpoints[1] {
            *destination = "new-host".into();
        }
        write_endpoint_config_to_dir(&dir, &replacement).unwrap();
        assert_eq!(read_endpoint_config_from_dir(&dir).unwrap(), replacement);
        let mut invalid = replacement;
        invalid.endpoints.push(ssh(0));
        assert!(write_endpoint_config_to_dir(&dir, &invalid).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.join(ENDPOINT_CONFIG_FILE_NAME))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
