#[allow(dead_code)]
#[path = "src/update_config.rs"]
mod update_config;
fn main() {
    for name in update_config::ENV_NAMES {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let values = update_config::ENV_NAMES.map(|name| std::env::var(name).ok());
    update_config::parse(values.each_ref().map(|value| value.as_deref()))
        .unwrap_or_else(|error| panic!("Invalid JMCL updater build configuration: {error}"));
    tauri_build::build()
}
