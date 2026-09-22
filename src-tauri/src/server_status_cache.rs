use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::Manager;
use thiserror::Error;

pub const CACHE_FILE_NAME: &str = "server-status-cache.v1.json";
pub const MAX_CACHE_BYTES: usize = 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("cache validation failed: {0}")]
    Validation(&'static str),
    #[error("cache serialization failed")]
    Serialization,
    #[error("cache I/O failed during {0}")]
    Io(&'static str),
}

pub fn canonical_empty_cache() -> Value {
    json!({ "schema_version": 1, "scopes": {} })
}

pub fn validate_cache(value: &Value) -> Result<(), CacheError> {
    let object = value
        .as_object()
        .ok_or(CacheError::Validation("top-level value is not an object"))?;
    if !has_only_keys(object, &["schema_version", "scopes"]) {
        return Err(CacheError::Validation("unknown top-level cache field"));
    }
    if object.get("schema_version") != Some(&Value::from(1)) {
        return Err(CacheError::Validation("unsupported schema version"));
    }
    let scopes = object
        .get("scopes")
        .and_then(Value::as_object)
        .ok_or(CacheError::Validation("scopes is not an object"))?;
    for scope in scopes.values() {
        let scope = scope
            .as_object()
            .ok_or(CacheError::Validation("scope is not an object"))?;
        if !has_only_keys(scope, &["directory", "servers"]) {
            return Err(CacheError::Validation("unknown scope field"));
        }
        if !scope.get("directory").is_some_and(Value::is_string) {
            return Err(CacheError::Validation("scope directory is not a string"));
        }
        let servers = scope
            .get("servers")
            .and_then(Value::as_object)
            .ok_or(CacheError::Validation("servers is not an object"))?;
        for server in servers.values() {
            let server = server
                .as_object()
                .ok_or(CacheError::Validation("server status is not an object"))?;
            if !has_only_keys(
                server,
                &[
                    "state",
                    "pid",
                    "supervisor_pid",
                    "java_path",
                    "started_at_ms",
                    "checked_at_ms",
                    "last_stale_cleanup_at_ms",
                ],
            ) {
                return Err(CacheError::Validation("unknown server status field"));
            }
            if !matches!(
                server.get("state").and_then(Value::as_str),
                Some("created" | "stopped" | "running" | "unknown")
            ) {
                return Err(CacheError::Validation("invalid server lifecycle state"));
            }
            for field in ["pid", "supervisor_pid"] {
                if !server.get(field).is_some_and(is_u32_or_null) {
                    return Err(CacheError::Validation("invalid process id"));
                }
            }
            for field in ["started_at_ms", "last_stale_cleanup_at_ms"] {
                if !server.get(field).is_some_and(is_safe_integer_or_null) {
                    return Err(CacheError::Validation("invalid server timestamp"));
                }
            }
            if !server
                .get("java_path")
                .is_some_and(|value| value.is_string() || value.is_null())
            {
                return Err(CacheError::Validation("invalid Java path"));
            }
            if !server.get("checked_at_ms").is_some_and(is_safe_integer) {
                return Err(CacheError::Validation("invalid checked time"));
            }
        }
    }
    Ok(())
}

fn has_only_keys(object: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn is_u32_or_null(value: &Value) -> bool {
    value.is_null()
        || value
            .as_u64()
            .is_some_and(|number| number <= u32::MAX as u64)
}

fn is_safe_integer_or_null(value: &Value) -> bool {
    value.is_null() || is_safe_integer(value)
}

fn is_safe_integer(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|number| number <= MAX_SAFE_INTEGER)
}

pub fn canonicalize_bytes(bytes: &[u8]) -> Value {
    if bytes.len() > MAX_CACHE_BYTES {
        return canonical_empty_cache();
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value) if validate_cache(&value).is_ok() => value,
        _ => canonical_empty_cache(),
    }
}

pub fn read_cache_from_dir(app_data_dir: &Path) -> Result<Value, CacheError> {
    let path = app_data_dir.join(CACHE_FILE_NAME);
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(canonical_empty_cache());
        }
        Err(_) => return Err(CacheError::Io("opening cache")),
    };
    let metadata = file
        .metadata()
        .map_err(|_| CacheError::Io("reading cache metadata"))?;
    if metadata.len() > MAX_CACHE_BYTES as u64 {
        return Ok(canonical_empty_cache());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_CACHE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| CacheError::Io("reading cache"))?;
    Ok(canonicalize_bytes(&bytes))
}

pub fn write_cache_to_dir(app_data_dir: &Path, value: &Value) -> Result<(), CacheError> {
    validate_cache(value)?;
    let serialized = serde_json::to_vec(value).map_err(|_| CacheError::Serialization)?;
    if serialized.len() > MAX_CACHE_BYTES {
        return Err(CacheError::Validation(
            "serialized cache exceeds size limit",
        ));
    }

    fs::create_dir_all(app_data_dir).map_err(|_| CacheError::Io("creating app data directory"))?;
    let destination = app_data_dir.join(CACHE_FILE_NAME);
    let temporary = temporary_path(app_data_dir);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| CacheError::Io("creating temporary cache"))?;
        file.write_all(&serialized)
            .map_err(|_| CacheError::Io("writing temporary cache"))?;
        file.flush()
            .map_err(|_| CacheError::Io("flushing temporary cache"))?;
        file.sync_all()
            .map_err(|_| CacheError::Io("syncing temporary cache"))?;
        drop(file);
        replace_destination(&temporary, &destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path(app_data_dir: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    app_data_dir.join(format!(
        ".{CACHE_FILE_NAME}.tmp-{}-{nonce}",
        std::process::id()
    ))
}

#[cfg(not(windows))]
fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), CacheError> {
    fs::rename(temporary, destination).map_err(|_| CacheError::Io("replacing cache"))?;
    let parent = destination
        .parent()
        .ok_or(CacheError::Io("finding cache directory"))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| CacheError::Io("syncing cache directory"))
}

#[cfg(windows)]
fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), CacheError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            temporary_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(CacheError::Io("replacing cache"))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn server_status_cache_read(app: tauri::AppHandle) -> Result<Value, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_owned())?;
    read_cache_from_dir(&app_data_dir).map_err(|_| "server status cache read failed".to_owned())
}

#[tauri::command]
pub fn server_status_cache_write(app: tauri::AppHandle, cache: Value) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_owned())?;
    write_cache_to_dir(&app_data_dir, &cache)
        .map_err(|_| "server status cache write failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn isolated_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("jmcl-server-cache-{label}-{nonce}"));
        fs::create_dir_all(&path).expect("create isolated test directory");
        path
    }

    fn cleanup(path: &Path) {
        fs::remove_dir_all(path).expect("remove isolated test directory");
    }

    #[test]
    fn canonicalizes_missing_corrupt_oversized_unsupported_and_wrong_shape_values() {
        let empty = canonical_empty_cache();
        assert_eq!(canonicalize_bytes(br"{}"), empty);
        assert_eq!(canonicalize_bytes(b"not json"), empty);
        assert_eq!(canonicalize_bytes(&vec![b' '; MAX_CACHE_BYTES + 1]), empty);
        assert_eq!(
            canonicalize_bytes(br#"{"schema_version":2,"scopes":{}}"#),
            empty
        );
        assert_eq!(
            canonicalize_bytes(br#"{"schema_version":1,"scopes":[]}"#),
            empty
        );
        assert_eq!(
            canonicalize_bytes(br#"{"schema_version":1,"scopes":{}}"#),
            json!({
                "schema_version": 1,
                "scopes": {}
            })
        );
    }

    #[test]
    fn validates_writes_and_rejects_oversized_serialized_payloads() {
        let directory = isolated_dir("validation");
        assert!(validate_cache(&json!({ "schema_version": 1, "scopes": {} })).is_ok());
        assert!(validate_cache(&json!({ "schema_version": 2, "scopes": {} })).is_err());
        assert!(validate_cache(&json!({ "schema_version": 1, "scopes": [] })).is_err());
        assert!(write_cache_to_dir(
            &directory,
            &json!({
                "schema_version": 1,
                "scopes": { "local": { "directory": "x".repeat(MAX_CACHE_BYTES), "servers": {} } }
            })
        )
        .is_err());
        assert!(validate_cache(&json!({
            "schema_version": 1,
            "scopes": { "local": { "directory": "/servers", "servers": {
                "alpha": {
                    "state": "running",
                    "pid": 42,
                    "supervisor_pid": 7,
                    "java_path": "/java",
                    "started_at_ms": 1,
                    "checked_at_ms": 2,
                    "last_stale_cleanup_at_ms": null,
                    "uptime_ms": 1
                }
            } } }
        }))
        .is_err());
        assert!(!directory.join(CACHE_FILE_NAME).exists());
        cleanup(&directory);
    }

    fn valid_server_status() -> Value {
        json!({
            "state": "running",
            "pid": 42,
            "supervisor_pid": 7,
            "java_path": "/java",
            "started_at_ms": 1,
            "checked_at_ms": 2,
            "last_stale_cleanup_at_ms": null
        })
    }

    fn cache_with_status(status: Value) -> Value {
        json!({
            "schema_version": 1,
            "scopes": { "local": { "directory": "/servers", "servers": {
                "alpha": status
            } } }
        })
    }

    #[test]
    fn validates_strict_process_id_and_timestamp_numbers() {
        assert!(validate_cache(&cache_with_status(valid_server_status())).is_ok());

        for invalid in [json!(-1), json!(4_294_967_296u64), json!(1.5), json!("42")] {
            let mut status = valid_server_status();
            status["pid"] = invalid;
            assert!(validate_cache(&cache_with_status(status)).is_err());
        }
        for invalid in [
            json!(-1),
            json!(1.5),
            json!(9_007_199_254_740_992u64),
            json!("1"),
        ] {
            let mut status = valid_server_status();
            status["started_at_ms"] = invalid;
            assert!(validate_cache(&cache_with_status(status)).is_err());
        }
        for invalid in [
            json!(-1),
            json!(1.5),
            json!(9_007_199_254_740_992u64),
            json!(null),
        ] {
            let mut status = valid_server_status();
            status["checked_at_ms"] = invalid;
            assert!(validate_cache(&cache_with_status(status)).is_err());
        }

        let mut boundary = valid_server_status();
        boundary["pid"] = json!(u32::MAX);
        boundary["started_at_ms"] = json!(9_007_199_254_740_991u64);
        boundary["checked_at_ms"] = json!(9_007_199_254_740_991u64);
        boundary["last_stale_cleanup_at_ms"] = json!(9_007_199_254_740_991u64);
        assert!(validate_cache(&cache_with_status(boundary)).is_ok());
    }

    #[test]
    fn rejects_missing_and_unknown_server_status_fields() {
        let mut missing = valid_server_status();
        missing.as_object_mut().unwrap().remove("checked_at_ms");
        assert!(validate_cache(&cache_with_status(missing)).is_err());

        let mut unknown = valid_server_status();
        unknown["uptime_ms"] = json!(1);
        assert!(validate_cache(&cache_with_status(unknown)).is_err());

        let mut nullable = valid_server_status();
        nullable["pid"] = Value::Null;
        nullable["supervisor_pid"] = Value::Null;
        nullable["started_at_ms"] = Value::Null;
        nullable["last_stale_cleanup_at_ms"] = Value::Null;
        assert!(validate_cache(&cache_with_status(nullable)).is_ok());
    }

    #[test]
    fn persists_using_fixed_filename_and_replaces_previous_value() {
        let directory = isolated_dir("persistence");
        assert_eq!(
            read_cache_from_dir(&directory).unwrap(),
            canonical_empty_cache()
        );
        let first = json!({ "schema_version": 1, "scopes": { "local": { "directory": "/servers", "servers": {} } } });
        write_cache_to_dir(&directory, &first).expect("write first cache");
        assert_eq!(read_cache_from_dir(&directory).unwrap(), first);
        let second = json!({ "schema_version": 1, "scopes": { "local": { "directory": "/other", "servers": {} } } });
        write_cache_to_dir(&directory, &second).expect("replace cache");
        assert_eq!(read_cache_from_dir(&directory).unwrap(), second);
        assert!(directory.join(CACHE_FILE_NAME).is_file());
        cleanup(&directory);
    }
}
