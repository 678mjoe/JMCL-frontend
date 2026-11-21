#[allow(dead_code)]
#[path = "src/update_config.rs"]
mod update_config;
fn main() {
    for name in update_config::ENV_NAMES {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-env-changed=VITE_JMCL_RUST_GUI_TEST");
    let preview = std::env::var_os("CARGO_FEATURE_EXPERIMENTAL_GUI_PREVIEW").is_some();
    let web_preview = std::env::var("VITE_JMCL_RUST_GUI_TEST").as_deref() == Ok("1");
    assert_eq!(preview, web_preview, "native and WebView preview flags must agree");
    if preview {
        assert!(
            update_config::ENV_NAMES.iter().all(|name| std::env::var_os(name).is_none()),
            "Rust GUI test must not inherit updater inputs"
        );
    }
    let values = update_config::ENV_NAMES.map(|name| std::env::var(name).ok());
    update_config::parse(values.each_ref().map(|value| value.as_deref()))
        .unwrap_or_else(|error| panic!("Invalid JMCL updater build configuration: {error}"));
    tauri_build::build()
}
