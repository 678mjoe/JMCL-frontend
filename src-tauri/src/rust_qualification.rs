//! Narrow headless, synthetic release qualification; never the shipped GUI.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{pool::SessionPool, transport, update_config};

const IDENTIFIER: &str = "page.mjoe.jmcl.rustqualification";
const PRODUCT: &str = "JMCL Rust Qualification";
const BINARY: &str = "jmcl-rust-qualification";
#[cfg(windows)]
const SIDECAR: &str = "jmcl-core.exe";
#[cfg(not(windows))]
const SIDECAR: &str = "jmcl-core";

fn actual_bundled_sidecar(host: &Path, resolved: &Path) -> bool {
    host.parent()
        .map(|directory| directory.join(SIDECAR))
        .is_some_and(|adjacent| {
            adjacent == resolved
                && adjacent
                    .symlink_metadata()
                    .is_ok_and(|metadata| metadata.file_type().is_file())
        })
}

struct Workspace(PathBuf);

impl Workspace {
    fn fresh() -> Result<Self, &'static str> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "cannot determine qualification timestamp")?
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "jmcl-rust-qualification-{}-{now}",
            std::process::id()
        ));
        std::fs::create_dir(&path).map_err(|_| "cannot create fresh qualification directory")?;
        Ok(Self(path))
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        // No recursive deletes; an unexpected synthetic output stays only in runner temp.
        let _ = std::fs::remove_dir(&self.0);
    }
}

async fn smoke(dir: &Path) -> Result<(), &'static str> {
    let pool = SessionPool::new(Some(dir.to_path_buf()));
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        for _ in 0..2 {
            let info = pool.open(None).await.map_err(|_| "session open failed")?;
            if info.core.name != "jmcl-core" || info.core.protocol != 1 {
                return Err("unexpected wire identity");
            }
            pool.close(info.session_id).await;
        }
        Ok(())
    })
    .await
    .map_err(|_| "synthetic qualification timed out");
    pool.clear().await;
    result?
}

fn qualify() -> Result<(), &'static str> {
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let config = context.config();
    if cfg!(debug_assertions)
        || config.identifier != IDENTIFIER
        || config.product_name.as_deref() != Some(PRODUCT)
        || config.main_binary_name.as_deref() != Some(BINARY)
        || !config.app.windows.is_empty()
        || config.bundle.create_updater_artifacts
        || update_config::compiled().is_some()
    {
        return Err("qualification configuration mismatch");
    }
    if std::env::var_os("JMCL_CORE").is_some() {
        return Err("JMCL_CORE override is not permitted");
    }
    let host = std::env::current_exe().map_err(|_| "qualification host unavailable")?;
    if host.file_stem() != Some(OsStr::new(BINARY)) {
        return Err("expected qualification host name");
    }
    let resolved = transport::resolve_core_binary(None).map_err(|_| "sidecar unavailable")?;
    if !actual_bundled_sidecar(&host, &resolved) {
        return Err("no regular adjacent sidecar; fallback refused");
    }
    let workspace = Workspace::fresh()?;
    // No Tauri Builder, window, WebView, plugin, invoke handler or persisted app state.
    tauri::async_runtime::block_on(smoke(&workspace.0))
}

pub fn run() {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(OsStr::new("--synthetic-smoke")) || args.next().is_some() {
        std::process::exit(2);
    }
    if let Err(error) = qualify() {
        eprintln!("Rust qualification failed: {error}");
        std::process::exit(1);
    }
}
