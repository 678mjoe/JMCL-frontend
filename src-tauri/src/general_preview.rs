//! Native boundary for ordinary vanilla use in the separate Rust GUI test app.
use std::{fs, io::{self, Read}, path::{Path, PathBuf}};
use serde_json::{json, Value};
use crate::session::SessionError;

pub(crate) const IDENTIFIER: &str = "page.mjoe.jmcl.experimental-rust-preview.general";
pub(crate) const PRODUCT: &str = "JMCL Rust General Test";
pub(crate) const BINARY: &str = "jmcl-rust-general-test";
pub(crate) const CREDENTIALS: &str = "page.mjoe.jmcl.experimental-rust-preview.general.refresh";
pub(crate) const WEBVIEW: [u8; 16] = [198, 192, 172, 137, 150, 16, 68, 168, 161, 34, 213, 157, 189, 142, 54, 62];
const LOADERS: [&str; 3] = ["fabric_loader", "neoforge_version", "forge_version"];
pub(crate) struct Scope { root: PathBuf }

fn denied() -> SessionError {
    SessionError::coded("GENERAL_TEST_SCOPE", "Only ordinary official vanilla instances, isolated test folders and existing Java are available in this Rust test app.")
}
#[cfg(all(windows, feature = "experimental-general-gui-test"))]
fn ordinary_dir(p: &Path) -> bool { crate::windows_general::ordinary(p, false) }
#[cfg(not(all(windows, feature = "experimental-general-gui-test")))]
fn ordinary_dir(p: &Path) -> bool {
    p.symlink_metadata().is_ok_and(|m| m.file_type().is_dir())
        && p.canonicalize().is_ok_and(|c| c == p)
}
fn instance_id(x: &str) -> bool {
    let alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    !x.is_empty() && x.len() <= 64 && alnum(x.as_bytes()[0]) && !x.ends_with('.')
        && x.bytes().all(|b| alnum(b) || matches!(b, b'.' | b'_' | b'-'))
}
fn release_version(x: &str) -> bool {
    let fields: Vec<_> = x.split('.').collect();
    (2..=3).contains(&fields.len()) && fields.iter().all(|s| !s.is_empty() && s.len() <= 4
        && s.bytes().all(|b| b.is_ascii_digit()))
}
fn is_vanilla(p: &Value) -> bool {
    LOADERS.iter().all(|k| p.get(*k).is_none_or(Value::is_null))
        && p.get("source").is_none_or(|v| v.as_str() == Some("official"))
}
fn string<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}
#[cfg(all(windows, feature = "experimental-general-gui-test"))]
fn ordinary_java(s: &str) -> bool { crate::windows_general::approved_java(Path::new(s)) }
#[cfg(not(all(windows, feature = "experimental-general-gui-test")))]
fn ordinary_java(s: &str) -> bool {
    let p = Path::new(s);
    let Ok(p) = p.canonicalize() else { return false };
    if p == Path::new("/usr/bin/java") { return true; }
    let mut roots = vec![PathBuf::from("/Library/Java/JavaVirtualMachines"),
                         PathBuf::from("/opt/homebrew/Cellar"), PathBuf::from("/opt/homebrew/Caskroom")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Library/Java/JavaVirtualMachines"));
    }
    roots.iter().any(|root| p.starts_with(root)) && (p.is_dir() || p.ends_with("bin/java") && p.is_file())
}
fn raw_local_java(s: &str) -> bool { ordinary_java(s) && Path::new(s).is_file() }

pub(crate) fn app_url(url: &tauri::Url) -> bool {
    if cfg!(windows) {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
            && url.username().is_empty() && url.password().is_none()
            && url.port().is_none() && url.query().is_none() && url.fragment().is_none()
            && matches!(url.path(), "" | "/" | "/index.html")
    } else {
        crate::integrated_qa::app_url(url)
    }
}
pub(crate) fn offline(params: &Value) -> bool {
    let Some(a) = params.get("auth") else { return false };
    let name = string(a, "player_name");
    let uuid = string(a, "uuid");
    a.as_object().is_some_and(|obj| obj.len() == 4)
        && string(a, "access_token") == "offline" && string(a, "user_type") == "legacy"
        && (1..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && uuid.len() == 32 && uuid.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Scope {
    pub(crate) fn bind(root: &Path) -> io::Result<Self> {
        if !ordinary_dir(root) || root.file_name().and_then(|n| n.to_str()) != Some(IDENTIFIER) {
            return Err(io::Error::other("Rust general test requires a canonical isolated app-data root"));
        }
        for name in ["instances", "store"] {
            let child = root.join(name);
            if !child.exists() { fs::create_dir(&child)?; }
            if !ordinary_dir(&child) { return Err(io::Error::other("Unsafe test data path")); }
        }
        Ok(Self { root: root.to_owned() })
    }

    fn manifest_for(&self, instance: &Path, version: &str) -> Option<()> {
        if !ordinary_dir(instance) { return None; }
        let slug = instance.file_name()?.to_str()?;
        let file = instance.join("instance.json");
        let md = file.symlink_metadata().ok()?;
        if !md.file_type().is_file() || md.len() > 65536 { return None; }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if md.nlink() != 1 { return None; }
        }
        #[cfg(all(windows, feature = "experimental-general-gui-test"))]
        if !crate::windows_general::ordinary(&file, true) { return None; }
        let f = fs::File::open(file).ok()?;
        #[cfg(all(windows, feature = "experimental-general-gui-test"))]
        if !crate::windows_general::single_link(&f) { return None; }
        let mut data = Vec::new();
        f.take(65537).read_to_end(&mut data).ok()?;
        if data.len() > 65536 { return None; }
        let m: Value = serde_json::from_slice(&data).ok()?;
        (m.get("schema_version").and_then(Value::as_u64) == Some(1)
            && string(&m, "id") == slug && string(&m, "version_id") == version
            && is_vanilla(&m)).then_some(())
    }

    pub(crate) fn authorize(&self, method: &str, mut p: Value) -> Result<Value, SessionError> {
        let instances = self.root.join("instances");
        let store = self.root.join("store");
        if p.as_object().is_none() || !ordinary_dir(&self.root) || !ordinary_dir(&instances)
            || !ordinary_dir(&store) || !is_vanilla(&p) {
            return Err(denied());
        }
        let permitted: &[&str] = match method {
            "ping" | "core.version" => &[],
            "version.list" => &["type", "limit", "source"],
            "version.get" | "version.resolve" => &["id", "source"],
            "java.detect" => &["paths"],
            "java.select" => &["id", "source", "arch", "paths"],
            "java.runtime.list" => &["store_directory"],
            "instance.list" => &["directory"],
            "instance.create" => &["directory", "id", "version_id", "name", "source", "validate"],
            "instance.get" => &["directory", "id"],
            "install.execute" => &["id", "directory", "store_directory", "source", "os", "arch", "workers", "retries", "java_policy", "java_paths"],
            "install.prepare" => &["id", "directory", "source", "os", "arch"],
            "launch.execute" => &["id", "directory", "store_directory", "source", "arch", "java_policy", "java_paths", "java_override", "options", "auth"],
            _ => return Err(denied()),
        };
        if !p.as_object().is_some_and(|fields| fields.keys().all(|key| permitted.contains(&key.as_str())))
            || p.get("os").is_some_and(|v| v.as_str() != Some(if cfg!(windows) { "windows" } else { "osx" }))
            || p.get("arch").is_some_and(|v| v.as_str() != Some(if cfg!(windows) { "x86_64" } else { "arm64" })) {
            return Err(denied());
        }
        let paths = if method == "java.detect" || method == "java.select" { "paths" } else { "java_paths" };
        if let Some(xs) = p.get(paths) {
            if !xs.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|p| p.as_str().is_some_and(ordinary_java))) {
                return Err(denied());
            }
        }
        if let Some(path) = p.get("java_override") {
            if p.get("java_paths").is_some() || !path.as_str().is_some_and(|s| raw_local_java(s)) {
                return Err(denied());
            }
            // An explicit GUI pick is a candidate, not a force-incompatible executable.
            let selected = p.as_object_mut().unwrap().remove("java_override").unwrap();
            p["java_paths"] = json!([selected]);
        }
        // Windows Core sees only a trusted system PATH; supply the bounded reviewed JDK inventory.
        #[cfg(all(windows, feature = "experimental-general-gui-test"))]
        if matches!(method, "java.detect" | "java.select" | "install.execute" | "launch.execute")
            && p.get(paths).is_none()
        {
            let discovered = crate::windows_general::discover_java();
            p[paths] = json!(discovered);
        }
        match method {
            "ping" | "core.version" if p == json!({}) => (),
            "version.list" | "version.get" | "version.resolve" | "java.detect" | "java.select" => (),
            "java.runtime.list" if p.get("store_directory").is_none_or(|v| v == &json!(store)) => {
                p["store_directory"] = json!(store);
            }
            "instance.list" if p.get("directory") == Some(&json!(instances)) => (),
            "instance.create" if p.get("directory") == Some(&json!(instances))
                && instance_id(string(&p, "id")) && release_version(string(&p, "version_id"))
                && p.get("validate").is_none_or(Value::is_boolean) => (),
            "instance.get" if p.get("directory") == Some(&json!(instances))
                && instance_id(string(&p, "id")) => (),
            "install.execute" | "install.prepare" | "launch.execute" => {
                let dir = Path::new(string(&p, "directory"));
                let rel = dir.strip_prefix(&instances).map_err(|_| denied())?;
                let mut c = rel.components();
                let Some(std::path::Component::Normal(slug)) = c.next() else { return Err(denied()); };
                if !slug.to_str().is_some_and(instance_id)
                    || c.next() != Some(std::path::Component::Normal(std::ffi::OsStr::new(".minecraft")))
                    || c.next().is_some()
                    || dir != instances.join(slug).join(".minecraft") || !ordinary_dir(dir)
                    || !release_version(string(&p, "id"))
                    || self.manifest_for(&instances.join(slug), string(&p, "id")).is_none()
                    || p.get("store_directory").is_some_and(|v| v != &json!(store)) {
                    return Err(denied());
                }
                if method != "install.prepare" { p["store_directory"] = json!(store); }
                if method != "install.prepare" {
                    if p.get("java_policy").is_some_and(|v| !matches!(v.as_str(), Some("local" | "auto"))) {
                        return Err(denied());
                    }
                    p["java_policy"] = json!("local");
                }
                if method.starts_with("launch.") {
                    if !p.get("options").is_none_or(|opts| opts.as_object().is_some_and(|m|
                        m.keys().all(|k| matches!(k.as_str(), "resolution_width" | "resolution_height" | "demo" | "include_default_user_jvm")))) {
                        return Err(denied());
                    }
                }
            }
            _ => return Err(denied()),
        }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_only_local_vanilla_ids_and_offline_shape() {
        for bad in ["", "/", "../prod", "Demo", "demo."] { assert!(!instance_id(bad)); }
        assert!(instance_id("separate-test-1"));
        assert!(release_version("1.20.1") && release_version("26.1"));
        assert!(!release_version("24w02a") && !release_version("1.20.1-pre"));
        let mut data = json!({"auth":{"player_name":"New_Player","access_token":"offline","user_type":"legacy",
            "uuid":"0123456789abcdef0123456789abcdef"}});
        assert!(offline(&data));
        data["auth"]["user_type"] = json!("msa");
        assert!(!offline(&data));
    }
    #[test]
    fn scoped_vanilla_request_shape_prevents_other_roots_and_managed_java() {
        let outer = std::env::temp_dir().canonicalize().unwrap().join(format!("jmcl-general-scope-{}", std::process::id()));
        fs::create_dir(&outer).unwrap();
        let root = outer.join(IDENTIFIER);
        fs::create_dir(&root).unwrap();
        let scope = Scope::bind(&root).unwrap();
        let instance = root.join("instances/example-test");
        let game = instance.join(".minecraft");
        fs::create_dir_all(&game).unwrap();
        fs::write(instance.join("instance.json"), br#"{"schema_version":1,"id":"example-test","version_id":"1.20.1","source":"official"}"#).unwrap();
        let req = json!({"id":"1.20.1", "directory":game, "store_directory":root.join("store"),
            "source":"official", "java_policy":"auto", "java_paths":[]});
        let create = json!({"id":"example-two", "directory":root.join("instances"),
            "version_id":"1.20.1","name":"Second","source":"official","validate":false});
        assert!(scope.authorize("instance.create", create).is_ok());
        let allowed = scope.authorize("install.execute", req.clone()).unwrap();
        assert_eq!(allowed["java_policy"], "local");
        for (key, value) in [
            ("directory", json!(outer.join("wrong"))), ("store_directory", json!(root.join("other"))),
            ("id", json!("1.19.4")), ("java_policy", json!("managed")), ("source", json!("bmclapi")),
            ("fabric_loader", json!("0.15.0")), ("java_paths", json!([outer.join("wrong")]))] {
            let mut denied_request = req.clone();
            denied_request[key] = value;
            assert!(scope.authorize("install.execute", denied_request).is_err(), "{key}");
        }
        assert!(scope.authorize("launch.plan", req.clone()).is_err());
        assert!(scope.authorize("java.runtime.install", json!({})).is_err());
        assert!(scope.authorize("server.list", json!({})).is_err());
        fs::remove_file(instance.join("instance.json")).unwrap();
        assert!(scope.authorize("install.execute", req).is_err());
        // Remove only the exact synthetic tree created by this test.
        fs::remove_dir_all(outer).unwrap();
    }

}
