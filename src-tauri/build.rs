#[allow(dead_code)]
#[path = "src/update_config.rs"]
mod update_config;
fn main() {
    for name in update_config::ENV_NAMES {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-env-changed=VITE_JMCL_RUST_GUI_TEST");
    println!("cargo:rerun-if-env-changed=VITE_JMCL_MICROSOFT_LOGIN_TEST");
    println!("cargo:rerun-if-env-changed=VITE_JMCL_INTEGRATED_GUI_TEST");
    println!("cargo:rerun-if-env-changed=JMCL_INTEGRATED_QA_JAVA");
    println!("cargo:rerun-if-env-changed=VITE_JMCL_GENERAL_GUI_TEST");
    let general = std::env::var_os("CARGO_FEATURE_EXPERIMENTAL_GENERAL_GUI_TEST").is_some();
    assert_eq!(general, std::env::var("VITE_JMCL_GENERAL_GUI_TEST").as_deref() == Ok("1"),
        "native and WebView general test flags must agree");
    println!("cargo:rerun-if-env-changed=JMCL_GENERAL_WINDOWS_CORE_SHA256");
    let win = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if general && win {
        assert_eq!(std::env::var("CARGO_CFG_TARGET_ARCH").as_deref(), Ok("x86_64"));
        let core_hash = std::env::var("JMCL_GENERAL_WINDOWS_CORE_SHA256")
            .expect("Windows general preview requires freshly compiled/staged Core SHA-256");
        assert!(core_hash.len() == 64 && core_hash.bytes().all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v)));
        println!("cargo:rustc-env=JMCL_GENERAL_WINDOWS_CORE_SHA256={core_hash}");
    }
    let integrated = std::env::var_os("CARGO_FEATURE_EXPERIMENTAL_INTEGRATED_GUI_TEST").is_some();
    assert!(!(general && integrated), "general preview cannot include fixture capability");
    let web_integrated = std::env::var("VITE_JMCL_INTEGRATED_GUI_TEST").as_deref() == Ok("1");
    assert_eq!(integrated, web_integrated, "native and WebView integrated test flags must agree");
    if integrated {
        let java = std::env::var_os("JMCL_INTEGRATED_QA_JAVA").expect("integrated test requires a reviewed local Java path");
        assert!(std::path::Path::new(&java).is_absolute(), "integrated test Java pin must be absolute");
    }
    let microsoft = std::env::var_os("CARGO_FEATURE_EXPERIMENTAL_MICROSOFT_LOGIN_TEST").is_some();
    let web_microsoft = std::env::var("VITE_JMCL_MICROSOFT_LOGIN_TEST").as_deref() == Ok("1");
    assert_eq!(microsoft, web_microsoft, "native and WebView Microsoft test flags must agree");
    if microsoft && !(general && win) {
        assert_eq!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos"));
        assert_eq!(std::env::var("CARGO_CFG_TARGET_ARCH").as_deref(), Ok("aarch64"));
    }
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
