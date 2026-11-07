//! Actual command macro dispatch with MockRuntime and a real RustCore process.
//! This is NOT a WebView/JS/UI/package test. Run only via the bounded runner.
use super::*;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};

fn invoke_from(
    window: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    body: Value,
    origin: url::Url,
) -> Result<Value, Value> {
    get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: origin,
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

fn invoke(
    window: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    body: Value,
) -> Result<Value, Value> {
    // Read the actual window URL; do not navigate or invent a privileged origin.
    // This lane is Linux-only, whose Tauri app protocol is tauri://localhost.
    let origin = window.url().unwrap();
    assert_eq!(origin.scheme(), "tauri");
    assert_eq!(origin.host_str(), Some("localhost"));
    assert_eq!(origin.port(), None);
    assert_eq!(origin.username(), "");
    assert_eq!(origin.password(), None);
    invoke_from(window, cmd, body, origin)
}

const CHANNEL_ID: u32 = 731;
const PAYLOAD: &[u8] = b"owned tauri channel cached fixture\n";

type Captured = (String, u32, usize, Vec<u8>, bool);

#[test]
#[ignore = "real process acceptance: use scripts/test-tauri-rust-core.py"]
fn actual_invoke_rust_core_channel() {
    assert_eq!(
        std::env::var("JMCL_TAURI_CONTRACT_BOUNDED").as_deref(),
        Ok("1")
    );
    let binary = std::path::PathBuf::from(
        std::env::var_os("JMCL_TAURI_CONTRACT_CORE").expect("explicit RustCore required"),
    );
    let fixture = std::path::PathBuf::from(
        std::env::var_os("JMCL_TAURI_CHANNEL_FIXTURE").expect("owned fixture required"),
    );
    assert!(binary.is_absolute() && binary.is_file());
    assert!(fixture.is_absolute() && fixture.is_dir());
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(fixture.join("manifest.json")).unwrap()).unwrap();
    let digest = manifest["files"][0]["hashes"]["sha1"].as_str().unwrap();
    let cas = fixture
        .join("store/objects/sha1")
        .join(&digest[..2])
        .join(digest);
    assert_eq!(std::fs::read(&cas).unwrap(), PAYLOAD);
    let root = tempfile::Builder::new()
        .prefix("jmcl-tauri-channel-")
        .tempdir()
        .unwrap();
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Captured>::new()));
    let sink = captured.clone();
    let app = mock_builder()
        .channel_interceptor(move |webview, callback, index, body| {
            let (raw, is_json) = match body {
                tauri::ipc::InvokeResponseBody::Json(value) => (value.as_bytes().to_vec(), true),
                tauri::ipc::InvokeResponseBody::Raw(value) => (value.clone(), false),
            };
            // Capture only; parsing/assertions are outside the callback and lock.
            sink.lock().unwrap().push((
                webview.label().to_owned(),
                callback.0,
                index,
                raw,
                is_json,
            ));
            true
        })
        .manage(SessionPool::new(Some(root.path().to_path_buf())))
        .manage(diagnostics::Diagnostics::start(
            root.path().join("diagnostics"),
        ))
        .manage(pack_activation::PackActivationState::default())
        .invoke_handler(tauri::generate_handler![
            core_open,
            core_request,
            core_close
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let pool = app.state::<SessionPool>();
    let outcome =
        catch_unwind(AssertUnwindSafe(|| {
            let remote_error = invoke_from(
                &window,
                "core_open",
                json!({"binaryPath": binary.to_str().unwrap()}),
                "http://tauri.localhost".parse().unwrap(),
            )
            .unwrap_err();
            assert_eq!(
                remote_error,
                json!("core_open not allowed. Plugin not found")
            );
            assert!(tauri::async_runtime::block_on(pool.endpoint_session_ids("local")).is_empty());
            println!("\nTAURI_REMOTE_ORIGIN_REJECTED pool_empty=true");
            let opened = invoke(
                &window,
                "core_open",
                json!({"binaryPath": binary.to_str().unwrap()}),
            )
            .unwrap();
            assert_eq!(opened["core"]["protocol"], 1);
            assert_eq!(opened["core"]["name"], "jmcl-core");
            let id = opened["session_id"].as_u64().unwrap();
            assert!(id > 0);
            assert!(captured.lock().unwrap().is_empty());
            // Real command arg deserialization calls Channel::from_command; this is
            // neither a direct core_request call nor a test-created Channel::new.
            let terminal = invoke(&window, "core_request", json!({
            "sessionId": id, "method": "modpack.install",
            "params": {"directory": fixture.join("instances"), "id": "owned-channel",
                "store_directory": fixture.join("store"), "file": fixture.join("owned.mrpack"),
                "workers": 1, "retries": 0},
            "events": format!("__CHANNEL__:{CHANNEL_ID}"), "compactEvents": false,
            "curseforge": false
        })).unwrap();
            println!("TAURI_CHANNEL_TERMINAL {}", terminal);
            assert_eq!(terminal["stage"], "modpack.install");
            assert_eq!(terminal["id"], "owned-channel");
            assert_eq!(terminal["files_installed"], 1);
            assert_eq!(terminal["files_skipped"], 0);
            assert_eq!(terminal["overrides_written"], 0);
            assert_eq!(terminal["version_id"], "1.20.1");
            assert_eq!(terminal["loader"], Value::Null);
            let messages = captured.lock().unwrap().clone();
            let mut files = 0;
            let mut progress = 0;
            for (expected_index, (label, callback, index, bytes, is_json)) in
                messages.iter().enumerate()
            {
                assert_eq!(label, "main");
                assert_eq!(*callback, CHANNEL_ID);
                assert_eq!(*index, expected_index);
                assert!(*is_json);
                let wire: Value = serde_json::from_slice(bytes).unwrap();
                assert_eq!(wire.as_object().unwrap().len(), 2);
                match wire["kind"].as_str().unwrap() {
                    "diagnostic" => {
                        assert!(wire["data"].is_string());
                    }
                    "event" => {
                        let event = &wire["data"];
                        assert_eq!(event["id"], "req-1");
                        assert_eq!(event["protocol"], 1);
                        assert_eq!(event["source"], "official");
                        match event["event"].as_str().unwrap() {
                            "file" => {
                                files += 1;
                                let file = &event["file"];
                                assert_eq!(file["path"], "mods/owned-fixture.txt");
                                assert_eq!(file["size"], PAYLOAD.len());
                                assert_eq!(file["status"], "cached");
                                assert_eq!(file["attempts"], 0);
                                assert!(matches!(
                                    file["placement"].as_str(),
                                    Some("hard_link" | "copy")
                                ));
                            }
                            "progress" => {
                                progress += 1;
                                let p = &event["progress"];
                                assert_eq!(p["files_total"], 1);
                                assert_eq!(p["files_completed"], 1);
                                for field in ["bytes_verified", "bytes_processed", "bytes_total"] {
                                    assert_eq!(p[field], PAYLOAD.len());
                                }
                                assert_eq!(p["bytes_transferred"], 0);
                            }
                            other => panic!("unexpected stream item: {other}"),
                        }
                    }
                    other => panic!("unexpected SessionEvent kind: {other}"),
                }
            }
            assert_eq!(files, 1);
            assert_eq!(progress, 1);
            let installed =
                fixture.join("instances/owned-channel/.minecraft/mods/owned-fixture.txt");
            assert_eq!(std::fs::read(&installed).unwrap(), PAYLOAD);
            assert_eq!(std::fs::read(&cas).unwrap(), PAYLOAD);
            println!(
                "TAURI_CHANNEL_FILE_BYTES {}",
                json!({"installed": std::fs::read(&installed).unwrap(),
            "cas": std::fs::read(&cas).unwrap()})
            );
            invoke(&window, "core_close", json!({"sessionId": id})).unwrap();
            assert!(tauri::async_runtime::block_on(pool.get(id)).is_none());
            assert!(tauri::async_runtime::block_on(pool.endpoint_session_ids("local")).is_empty());
            // Drop end uses mock eval, not interceptor: it is explicitly unverified.
            assert_eq!(captured.lock().unwrap().len(), messages.len());
        }));
    // Retain every captured outlet byte even if an invoke or assertion failed.
    for (label, callback, index, bytes, is_json) in captured.lock().unwrap().iter() {
        println!(
            "TAURI_CHANNEL_WIRE {}",
            json!({"label": label, "callback": callback,
            "index": index, "json": is_json, "bytes": bytes})
        );
    }
    tauri::async_runtime::block_on(pool.clear());
    drop(pool);
    drop(window);
    drop(app);
    root.close().unwrap();
    if let Err(error) = outcome {
        resume_unwind(error);
    }
    println!("\nTAURI_CHANNEL_EGRESS_OK tests=1 cached=1 dispatch=actual runtime=mock js=false");
}
