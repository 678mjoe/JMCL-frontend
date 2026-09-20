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
