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
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "jmcl-installed-status-{}",
            std::process::id()
        ));
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
        assert!(result.is_object(), "unexpected java.detect result: {result}");
    });
}

#[test]
fn instance_status_matches_version_and_loader_but_not_source() {
    runtime().block_on(async {
        let fixture = FixtureRoot::new();
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
