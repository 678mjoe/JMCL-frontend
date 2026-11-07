//! Actual command macro dispatch with MockRuntime and a real RustCore process.
//! This is NOT a WebView/JS/UI/package test. Run only via the bounded runner.
use super::*;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime};

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
    // Actual Linux custom-protocol window URL, never a synthetic IPC origin.
    let origin = window.url().unwrap();
    assert_eq!(origin.as_str(), "tauri://localhost");
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
fn actual_invoke_rust_core_release_context() {
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
    assert!(!tauri::is_dev(), "custom-protocol required");
    assert!(!cfg!(debug_assertions), "release test build required");
    let context = tauri::generate_context!();
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(std::env::var_os("JMCL_TAURI_DIST_MANIFEST").unwrap()).unwrap(),
    )
    .unwrap();
    let index = context
        .assets()
        .get(&"index.html".into())
        .expect("embedded index");
    let html = std::str::from_utf8(&index).unwrap();
    assert!(html.contains("<title>JMCL</title>") && html.contains("id=\"root\""));
    assert!(!html.contains("/src/main.tsx"));
    let dist_root = std::path::PathBuf::from(std::env::var_os("JMCL_TAURI_DIST_ROOT").unwrap());
    assert!(dist_root.is_absolute());
    let mut referenced_bytes = 0;
    let mut scripts = 0;
    let mut styles = 0;
    for reference in manifest["references"].as_array().unwrap() {
        let path = reference.as_str().unwrap();
        assert!(path.starts_with("/assets/") && !path.contains(".."));
        assert!(html.contains(path), "missing embedded reference: {path}");
        let bytes = context
            .assets()
            .get(&path.into())
            .expect("embedded referenced asset");
        assert!(!bytes.is_empty());
        let original = std::fs::read(dist_root.join(path.trim_start_matches('/'))).unwrap();
        assert_eq!(
            bytes.as_ref(),
            original.as_slice(),
            "embedded asset differs: {path}"
        );
        referenced_bytes += bytes.len();
        if path.ends_with(".js") {
            scripts += 1;
        }
        if path.ends_with(".css") {
            styles += 1;
        }
    }
    assert!(scripts > 0 && styles > 0);
    println!(
        "\nTAURI_EMBEDDED_DIST_OK index_bytes={} scripts={} styles={}",
        index.len(),
        scripts,
        styles
    );
    println!(
        "\nTAURI_EMBEDDED_DIST_BYTES_EQUAL references={} bytes={}",
        manifest["references"].as_array().unwrap().len(),
        referenced_bytes
    );
    drop(index);
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
        .build(context)
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    println!(
        "\nTAURI_PRODUCTION_CONTEXT mode=release origin={} release=true custom_protocol=true",
        window.url().unwrap()
    );
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
        assert_eq!(remote_error, json!("Command core_open not allowed by ACL"));
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
    println!("\nTAURI_RELEASE_CONTEXT_OK sessions=2 dispatch=actual runtime=mock js=false");
}
