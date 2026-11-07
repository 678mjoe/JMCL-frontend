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

fn request(
    window: &tauri::WebviewWindow<MockRuntime>,
    id: u64,
    method: &str,
) -> Result<Value, Value> {
    invoke(
        window,
        "core_request",
        json!({
            "sessionId": id, "method": method, "params": {},
            "events": "__CHANNEL__:7", "compactEvents": false, "curseforge": false
        }),
    )
}

#[test]
#[ignore = "real process acceptance: use scripts/test-tauri-rust-core.py"]
fn actual_invoke_rust_core_lifecycle() {
    assert_eq!(
        std::env::var("JMCL_TAURI_CONTRACT_BOUNDED").as_deref(),
        Ok("1")
    );
    let binary = std::path::PathBuf::from(
        std::env::var_os("JMCL_TAURI_CONTRACT_CORE").expect("explicit RustCore required"),
    );
    assert!(binary.is_absolute() && binary.is_file());
    let root = tempfile::Builder::new()
        .prefix("jmcl-tauri-command-")
        .tempdir()
        .unwrap();
    let app = mock_builder()
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
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        // Preserve the original remote-origin rejection as a negative control.
        // It must remain denied, without opening a session or weakening ACLs.
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
        assert!(tauri::async_runtime::block_on(pool.get(1)).is_none());
        println!("\nTAURI_REMOTE_ORIGIN_REJECTED pool_empty=true");
        let mut ids = Vec::new();
        for _ in 0..2 {
            let opened = invoke(
                &window,
                "core_open",
                json!({"binaryPath": binary.to_str().unwrap()}),
            )
            .unwrap();
            assert_eq!(opened["core"]["protocol"], 1);
            assert_eq!(opened["core"]["name"], "jmcl-core");
            assert_eq!(opened["core"]["version"], "0.1.0-dev");
            let id = opened["session_id"].as_u64().unwrap();
            assert!(id > 0 && !ids.contains(&id));
            ids.push(id);
        }
        assert_eq!(
            tauri::async_runtime::block_on(pool.endpoint_session_ids("local")),
            ids
        );
        for id in &ids {
            assert_eq!(
                request(&window, *id, "ping").unwrap(),
                json!({"pong": true})
            );
            let error = request(&window, *id, "__jmcl_contract_unknown_method__").unwrap_err();
            assert_eq!(error["kind"], "rpc");
            assert_eq!(error["code"], "METHOD_NOT_FOUND");
            assert_eq!(
                request(&window, *id, "ping").unwrap(),
                json!({"pong": true})
            );
        }
        assert_eq!(
            invoke(&window, "core_close", json!({"sessionId": ids[0]})).unwrap(),
            Value::Null
        );
        assert!(tauri::async_runtime::block_on(pool.get(ids[0])).is_none());
        assert_eq!(
            request(&window, ids[0], "ping").unwrap_err()["code"],
            "SESSION_CLOSED"
        );
        assert_eq!(
            tauri::async_runtime::block_on(pool.endpoint_session_ids("local")),
            vec![ids[1]]
        );
        assert_eq!(
            request(&window, ids[1], "ping").unwrap(),
            json!({"pong": true})
        );
        invoke(&window, "core_close", json!({"sessionId": ids[1]})).unwrap();
        invoke(&window, "core_close", json!({"sessionId": ids[1]})).unwrap();
        assert!(tauri::async_runtime::block_on(pool.get(ids[1])).is_none());
        assert!(tauri::async_runtime::block_on(pool.endpoint_session_ids("local")).is_empty());
    }));
    // Always reap sessions on assertion failure as well as success. The runner
    // owns a process group deadline for hung invoke or cleanup paths.
    tauri::async_runtime::block_on(pool.clear());
    drop(pool);
    drop(window);
    drop(app);
    root.close().unwrap();
    if let Err(error) = outcome {
        resume_unwind(error);
    }
    println!("\nTAURI_RUST_CORE_CONTRACT_OK sessions=2 dispatch=actual runtime=mock ui=false");
}
