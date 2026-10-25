//! Smoke tests against the real `jmcl-core` binary in `backend-binaries`.

use std::path::PathBuf;
use std::sync::Arc;

use jmcl_lib::session::{Session, SessionError};
use jmcl_lib::transport::LocalProcessTransport;
use serde_json::json;

fn core_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("backend-binaries")
        .join(if cfg!(windows) {
            "jmcl-core.exe"
        } else {
            "jmcl-core"
        })
}

#[cfg(windows)]
#[test]
fn local_child_has_no_console_and_keeps_rpc_pipes() {
    use jmcl_lib::transport::{LineTransport, TransportEvent};
    use std::path::Path;
    use std::time::Duration;

    runtime().block_on(async {
        let script = r#"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
}
'@
[Console]::WriteLine("console=" + [ConsoleProbe]::GetConsoleWindow().ToInt64());
[Console]::Out.Flush();
[Console]::WriteLine("echo=" + [Console]::ReadLine());
"#;
        let mut transport = LocalProcessTransport::spawn(
            Path::new("powershell.exe"),
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            None,
        )
        .await
        .expect("spawn a console-subsystem probe through the local RPC transport");
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            let event = transport.next_event().await;
            assert!(
                matches!(event, TransportEvent::Line(ref line) if line == "console=0"),
                "{event:?}"
            );
            transport.write_line("pipe-check").await.unwrap();
            let event = transport.next_event().await;
            assert!(
                matches!(event, TransportEvent::Line(ref line) if line == "echo=pipe-check"),
                "{event:?}"
            );
        })
        .await;
        transport.close().await.unwrap();
        result.expect("console probe and piped echo complete promptly");
    });
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

struct FixtureRoot(PathBuf);

impl FixtureRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("jmcl-{}-{}", label, std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn add_instance(
        &self,
        id: &str,
        manifest_source: &str,
        marker_version: &str,
        marker_source: &str,
    ) {
        let minecraft = self.0.join(id).join(".minecraft");
        std::fs::create_dir_all(minecraft.join(".jmcl")).unwrap();
        std::fs::write(
            self.0.join(id).join("instance.json"),
            serde_json::to_vec(&json!({
                "schema_version": 1,
                "id": id,
                "name": id,
                "version_id": "1.21.4",
                "fabric_loader": null,
                "neoforge_version": null,
                "forge_version": null,
                "source": manifest_source,
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            minecraft.join(".jmcl").join("install.json"),
            serde_json::to_vec(&json!({
                "schema_version": 1,
                "version_id": marker_version,
                "fabric_loader": null,
                "neoforge_version": null,
                "forge_version": null,
                "source": marker_source,
                "os": "osx",
                "arch": "arm64",
            }))
            .unwrap(),
        )
        .unwrap();
    }
}

impl Drop for FixtureRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn open() -> Session {
    let transport = LocalProcessTransport::spawn(&core_path(), &["rpc"], None)
        .await
        .expect("spawn jmcl-core");
    Session::establish(Box::new(transport))
        .await
        .expect("handshake")
}

#[test]
fn handshake_reports_protocol_v1() {
    runtime().block_on(async {
        let session = open().await;
        assert_eq!(session.identity().name, "jmcl-core");
        assert_eq!(session.identity().protocol, 1);
    });
}

#[test]
fn ping_error_mapping_and_session_survival() {
    runtime().block_on(async {
        let session = open().await;

        let pong = session.request("ping", json!({}), |_| {}).await.unwrap();
        assert_eq!(pong, json!({"pong": true}));

        let err = session
            .request("no.such.method", json!({}), |_| {})
            .await
            .unwrap_err();
        match err {
            SessionError::Rpc { code, .. } => assert_eq!(code, "METHOD_NOT_FOUND"),
            other => panic!("expected Rpc error, got {other}"),
        }

        // The session survives an error response.
        let pong = session.request("ping", json!({}), |_| {}).await.unwrap();
        assert_eq!(pong["pong"], true);
    });
}

#[test]
fn java_detect_returns_object() {
    runtime().block_on(async {
        let session = open().await;
        let result = session
            .request("java.detect", json!({}), |_| {})
            .await
            .unwrap();
        assert!(
            result.is_object(),
            "unexpected java.detect result: {result}"
        );
    });
}

#[test]
fn java_runtime_list_on_empty_store() {
    runtime().block_on(async {
        let fixture = FixtureRoot::new("runtime-list");
        let session = open().await;
        let result = session
            .request(
                "java.runtime.list",
                json!({"store_directory": fixture.0}),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(
            result["runtimes"],
            json!([]),
            "expected no managed runtimes in a fresh store: {result}"
        );
    });
}

#[test]
fn instance_status_matches_version_and_loader_but_not_source() {
    runtime().block_on(async {
        let fixture = FixtureRoot::new("installed-status");
        fixture.add_instance("source-mismatch", "bmclapi", "1.21.4", "official");
        fixture.add_instance("version-mismatch", "official", "1.21.3", "official");

        let session = open().await;
        let result = session
            .request(
                "instance.list",
                json!({"directory": fixture.0.to_str().unwrap()}),
                |_| {},
            )
            .await
            .unwrap();
        let instances = result["instances"].as_array().unwrap();

        let source_mismatch = instances
            .iter()
            .find(|instance| instance["id"] == "source-mismatch")
            .unwrap();
        assert_eq!(source_mismatch["installed"], true);

        let version_mismatch = instances
            .iter()
            .find(|instance| instance["id"] == "version-mismatch")
            .unwrap();
        assert_eq!(version_mismatch["installed"], false);
    });
}

#[test]
fn concurrent_callers_on_one_session_are_serialized() {
    runtime().block_on(async {
        let session = Arc::new(open().await);
        let s1 = Arc::clone(&session);
        let s2 = Arc::clone(&session);
        let (a, b) = tokio::join!(
            async move { s1.request("ping", json!({}), |_| {}).await },
            async move { s2.request("core.version", json!({}), |_| {}).await },
        );
        assert_eq!(a.unwrap()["pong"], true);
        assert_eq!(b.unwrap()["protocol"], 1);
    });
}

/// Save/world lifecycle against the real core (contract §4, docs/worlds.md):
/// list shape, locked gating, duplicate/backup/restore/delete round trips,
/// and the WORLD_EXISTS / BACKUP_NOT_FOUND error codes the GUI surfaces.
#[test]
fn worlds_lifecycle_round_trip() {
    runtime().block_on(async {
        let fixture = FixtureRoot::new("worlds");
        let game = fixture.0.join("inst").join(".minecraft");
        let alpha = game.join("saves").join("Alpha");
        std::fs::create_dir_all(alpha.join("region")).unwrap();
        std::fs::write(alpha.join("region").join("r.0.0.mca"), [0u8; 128]).unwrap();
        let directory = game.to_str().unwrap().to_owned();

        let session = open().await;
        let call = |method: &str, params: serde_json::Value| {
            let session = &session;
            let method = method.to_owned();
            async move { session.request(&method, params, |_| {}).await }
        };

        // A world without level.dat still lists, with null metadata.
        let result = call(
            "worlds.list",
            json!({"directory": directory, "minecraft_version": "1.21.4"}),
        )
        .await
        .unwrap();
        let worlds = result["worlds"].as_array().unwrap();
        assert_eq!(worlds.len(), 1, "unexpected worlds.list: {result}");
        assert_eq!(worlds[0]["name"], "Alpha");
        assert_eq!(worlds[0]["level_name"], serde_json::Value::Null);
        assert_eq!(worlds[0]["locked"], false);
        assert_eq!(worlds[0]["version_relation"], "unknown");
        assert!(worlds[0]["size_bytes"].as_u64().unwrap() >= 128);

        // A stale session.lock (no flock held, e.g. crash leftover) is
        // tolerated: the world reports locked:false and mutations proceed
        // (contract §4: only a flock held by a running game locks a world).
        std::fs::write(alpha.join("session.lock"), b"lock").unwrap();
        let result = call("worlds.list", json!({"directory": directory}))
            .await
            .unwrap();
        assert_eq!(result["worlds"][0]["locked"], false);

        // Duplicate returns the new world entry; session.lock is excluded.
        let result = call(
            "worlds.duplicate",
            json!({"directory": directory, "world": "Alpha", "new_name": "Beta"}),
        )
        .await
        .unwrap();
        assert_eq!(result["world"]["name"], "Beta");
        assert!(!game
            .join("saves")
            .join("Beta")
            .join("session.lock")
            .exists());
        std::fs::remove_file(alpha.join("session.lock")).unwrap();

        // Backup lands in <game dir>/backups/ and lists newest first.
        let result = call(
            "worlds.backup",
            json!({"directory": directory, "world": "Alpha"}),
        )
        .await
        .unwrap();
        let backup = result["backup"].as_str().unwrap().to_owned();
        assert!(
            backup.starts_with("Alpha-"),
            "unexpected backup name: {backup}"
        );
        let result = call("worlds.backups", json!({"directory": directory}))
            .await
            .unwrap();
        let backups = result["backups"].as_array().unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0]["file"], backup);
        assert_eq!(backups[0]["world"], "Alpha");

        // Restore refuses an existing target, succeeds under a fresh name.
        let err = call(
            "worlds.restore",
            json!({"directory": directory, "backup": backup}),
        )
        .await
        .unwrap_err();
        match err {
            SessionError::Rpc { code, .. } => assert_eq!(code, "WORLD_EXISTS"),
            other => panic!("expected Rpc error, got {other}"),
        }
        let result = call(
            "worlds.restore",
            json!({"directory": directory, "backup": backup, "name": "Gamma"}),
        )
        .await
        .unwrap();
        assert_eq!(result["world"]["name"], "Gamma");

        // Deleting a backup twice reports BACKUP_NOT_FOUND.
        let result = call(
            "worlds.backups.delete",
            json!({"directory": directory, "backup": backup}),
        )
        .await
        .unwrap();
        assert_eq!(result["deleted"], backup);
        let err = call(
            "worlds.backups.delete",
            json!({"directory": directory, "backup": backup}),
        )
        .await
        .unwrap_err();
        match err {
            SessionError::Rpc { code, .. } => assert_eq!(code, "BACKUP_NOT_FOUND"),
            other => panic!("expected Rpc error, got {other}"),
        }

        // Delete returns the removed name; the list reflects every mutation.
        let result = call(
            "worlds.delete",
            json!({"directory": directory, "world": "Beta"}),
        )
        .await
        .unwrap();
        assert_eq!(result["deleted"], "Beta");
        let result = call("worlds.list", json!({"directory": directory}))
            .await
            .unwrap();
        let names: Vec<&str> = result["worlds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["Alpha", "Gamma"]);
    });
}

/// Account metadata is local synthetic data: no OAuth calls, credentials or
/// keychain access. Exercise the actual Core envelope rather than a permissive
/// mock, including the exact malformed request previously sent after login.
#[test]
fn account_metadata_requires_account_envelope_and_round_trips() {
    runtime().block_on(async {
        let root = FixtureRoot::new("account-wire-contract");
        let transport = LocalProcessTransport::spawn(&core_path(), &["rpc"], Some(&root.0))
            .await
            .expect("spawn isolated account metadata core");
        let session = Session::establish(Box::new(transport)).await.unwrap();
        let account = json!({
            "id": "0123456789abcdef0123456789abcdef",
            "player_name": "SyntheticPlayer",
            "client_id": "00000000-0000-0000-0000-000000000001"
        });
        let error = session
            .request("account.microsoft.save", account.clone(), |_| {})
            .await
            .unwrap_err();
        assert!(matches!(error, SessionError::Rpc { ref code, ref message }
            if code == "INVALID_PARAMS" && message == "Account metadata parameters are invalid"));
        let empty = session
            .request("account.microsoft.list", json!({}), |_| {})
            .await
            .unwrap();
        assert_eq!(empty["accounts"], json!([]));
        let saved = session
            .request(
                "account.microsoft.save",
                json!({"account": account}),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(saved["stage"], "save");
        let expected = json!({
            "schema_version": 1,
            "id": "0123456789abcdef0123456789abcdef",
            "player_name": "SyntheticPlayer",
            "client_id": "00000000-0000-0000-0000-000000000001",
            "xuid": null
        });
        assert_eq!(saved["account"], expected);
        let loaded = session
            .request(
                "account.microsoft.get",
                json!({"id": account["id"]}),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(loaded, json!({"stage": "account_get", "account": expected}));
        let listed = session
            .request("account.microsoft.list", json!({}), |_| {})
            .await
            .unwrap();
        assert_eq!(
            listed,
            json!({"stage": "account_list", "accounts": [expected]})
        );
        let deleted = session
            .request(
                "account.microsoft.delete",
                json!({"id": account["id"]}),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(
            deleted,
            json!({"stage": "account_delete", "id": account["id"], "deleted": true})
        );
        let empty = session
            .request("account.microsoft.list", json!({}), |_| {})
            .await
            .unwrap();
        assert_eq!(empty["accounts"], json!([]));
        session.close().await;
    });
}

#[test]
fn bounded_modpack_preview_matches_real_core_import_metadata_without_network() {
    use std::io::Write;
    runtime().block_on(async {
        let fixture = FixtureRoot::new("modpack-preview-contract");
        let path = fixture.0.join("synthetic.mrpack");
        let manifest = json!({
            "formatVersion": 1, "game": "minecraft", "name": "Synthetic Preview Pack",
            "versionId": "fixture-v1", "files": [],
            "dependencies": { "minecraft": "1.20.1", "fabric-loader": "0.15.0" }
        });
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("modrinth.index.json", options).unwrap();
        archive
            .write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        archive
            .start_file("overrides/config/synthetic.txt", options)
            .unwrap();
        archive.write_all(b"synthetic local override").unwrap();
        archive.finish().unwrap();
        let archive_before = std::fs::read(&path).unwrap();
        let preview = jmcl_lib::modpack_preview::preview(path.to_str().unwrap()).unwrap();
        assert_eq!(preview.provider, "modrinth");
        assert_eq!(preview.files_declared, 0);
        let session = open().await;
        // Empty content references: no downloads, account, keychain, or game launch.
        let imported = session.request("modpack.install", json!({
            "directory": fixture.0.join("instances"), "store_directory": fixture.0.join("store"),
            "id": "preview-contract", "file": path,
        }), |_| {}).await.unwrap();
        // Core builds the instance display name from manifest name + pack version.
        assert_eq!(
            imported["name"],
            format!("{} {}", preview.name, preview.version.as_deref().unwrap())
        );
        assert_eq!(imported["version_id"], preview.minecraft_version);
        let loader = preview.loader.unwrap();
        assert_eq!(
            imported["loader"],
            json!({"name": loader.kind, "version": loader.version})
        );
        assert_eq!(imported["files_installed"], 0);
        assert_eq!(imported["files_skipped"], 0);
        assert_eq!(imported["overrides_written"], 1);
        assert_eq!(
            std::fs::read(
                fixture
                    .0
                    .join("instances/preview-contract/.minecraft/config/synthetic.txt")
            )
            .unwrap(),
            b"synthetic local override"
        );
        assert_eq!(std::fs::read(&path).unwrap(), archive_before);
        session.close().await;
    });
}
