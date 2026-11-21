//! Windows-specific, fail-closed prerequisites for the general test build.
use std::os::windows::{
    ffi::{OsStrExt, OsStringExt},
    fs::MetadataExt,
    io::AsRawHandle,
};
use std::{
    ffi::OsString,
    fs,
    io::{self, Read, Seek},
    path::{Component, Path, PathBuf, Prefix},
};
use windows_sys::core::GUID;
use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
    Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    },
    System::{
        Com::CoTaskMemFree,
        Registry::{
            RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
            KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        SystemInformation::GetSystemDirectoryW,
    },
    UI::Shell::{
        FOLDERID_LocalAppData, FOLDERID_ProgramFilesX64, FOLDERID_RoamingAppData,
        SHGetKnownFolderPath,
    },
};

pub(crate) const PROFILE: &str = "jmcl-rust-general-win-x64-profile-v1";

fn blocked(reason: &'static str) -> io::Error {
    io::Error::other(reason)
}

fn normalized(path: &Path) -> Option<OsString> {
    let mut iter = path.components();
    let Component::Prefix(prefix) = iter.next()? else {
        return None;
    };
    let (Prefix::Disk(drive) | Prefix::VerbatimDisk(drive)) = prefix.kind() else {
        return None;
    };
    if iter.next() != Some(Component::RootDir) {
        return None;
    }
    let mut result = OsString::from(format!("{}:\\", (drive as char).to_ascii_uppercase()));
    for c in iter {
        let Component::Normal(name) = c else {
            return None;
        };
        let label = name.to_str()?;
        if label.is_empty()
            || label.ends_with(['.', ' '])
            || label.chars().any(|ch| ch == ':' || ch == '\0')
        {
            return None;
        }
        if !result.to_string_lossy().ends_with('\\') {
            result.push("\\");
        }
        result.push(name);
    }
    Some(result)
}

pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    match (normalized(a), normalized(b)) {
        (Some(a), Some(b)) => a
            .to_str()
            .zip(b.to_str())
            .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b)),
        _ => false,
    }
}

pub(crate) fn ordinary(path: &Path, is_file: bool) -> bool {
    if normalized(path).is_none() {
        return false;
    }
    if !path.ancestors().enumerate().all(|(i, p)| {
        p.symlink_metadata().is_ok_and(|m| {
            m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
                && if i == 0 && is_file {
                    m.is_file()
                } else {
                    m.is_dir()
                }
        })
    }) {
        return false;
    }
    path.canonicalize()
        .is_ok_and(|canonical| same_path(&canonical, path))
}

pub(crate) fn single_link(file: &fs::File) -> bool {
    let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
    // The handle remains open for the API call and on success the full struct is initialized.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) };
    ok != 0 && unsafe { info.assume_init() }.nNumberOfLinks == 1
}

fn known_folder(id: &GUID) -> io::Result<PathBuf> {
    let mut raw: *mut u16 = std::ptr::null_mut();
    // Read the current process user's known folder rather than trusting inherited environment paths.
    let hr = unsafe { SHGetKnownFolderPath(id, 0, std::ptr::null_mut(), &mut raw) };
    if hr < 0 || raw.is_null() {
        return Err(blocked("Windows known folder unavailable"));
    }
    let result = (|| {
        for i in 0..32768 {
            if unsafe { *raw.add(i) } == 0 {
                let slice = unsafe { std::slice::from_raw_parts(raw, i) };
                let path = PathBuf::from(OsString::from_wide(slice));
                return ordinary(&path, false)
                    .then_some(path)
                    .ok_or_else(|| blocked("Unsafe Windows known folder"));
            }
        }
        Err(blocked("Windows known folder path is too long"))
    })();
    unsafe { CoTaskMemFree(raw.cast()) };
    result
}

pub(crate) fn system_directory() -> io::Result<PathBuf> {
    let mut buffer = vec![0_u16; 32768];
    let count = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if count == 0 || count >= buffer.len() {
        return Err(blocked("Windows system folder unavailable"));
    }
    let path = PathBuf::from(OsString::from_wide(&buffer[..count]));
    ordinary(&path, false)
        .then_some(path)
        .ok_or_else(|| blocked("Unsafe Windows system folder"))
}

fn reject_webview_overrides() -> io::Result<()> {
    // Do not hide or change policy. Unknown/denied policy state fails closed.
    if std::env::vars_os().any(|(name, _)| {
        name.to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
    }) {
        return Err(blocked(
            "WebView2 environment overrides are unsupported for this isolated test",
        ));
    }
    let key: Vec<u16> = std::ffi::OsStr::new(r"SOFTWARE\Policies\Microsoft\Edge\WebView2")
        .encode_wide()
        .chain(Some(0))
        .collect();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            let mut out: HKEY = std::ptr::null_mut();
            let status = unsafe { RegOpenKeyExW(hive, key.as_ptr(), 0, KEY_READ | view, &mut out) };
            match status {
                ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => (),
                ERROR_SUCCESS => {
                    unsafe { RegCloseKey(out) };
                    return Err(blocked("WebView2 policy is present; test startup stopped to avoid sharing a profile"));
                }
                _ => return Err(blocked("WebView2 policy could not be verified")),
            }
        }
    }
    Ok(())
}

pub(crate) fn check_roaming_root(root: &Path) -> io::Result<()> {
    let expected = known_folder(&FOLDERID_RoamingAppData)?.join(crate::general_preview::IDENTIFIER);
    if !same_path(root, &expected) {
        return Err(blocked("Unexpected Windows preview Roaming data root"));
    }
    match root.symlink_metadata() {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(_) if ordinary(root, false) => Ok(()),
        Ok(_) => Err(blocked("Unsafe Windows preview Roaming data root")),
    }
}

pub(crate) fn profile_path(expected_local_data: &Path) -> io::Result<PathBuf> {
    reject_webview_overrides()?;
    let local_data = known_folder(&FOLDERID_LocalAppData)?;
    let root = local_data.join(crate::general_preview::IDENTIFIER);
    if !same_path(&root, expected_local_data) {
        return Err(blocked("Unexpected Windows preview local data root"));
    }
    for path in [&root, &root.join(PROFILE)] {
        match path.symlink_metadata() {
            Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(path)?,
            Err(e) => return Err(e),
            Ok(_) => (),
        }
        if !ordinary(path, false) {
            return Err(blocked("Unsafe Windows preview WebView data path"));
        }
    }
    Ok(root.join(PROFILE))
}

const JDK_VENDORS: &[&str] = &[
    "Microsoft",
    "Java",
    "Eclipse Adoptium",
    "Amazon Corretto",
    "BellSoft",
    "Azul Systems",
    "Semeru",
    "OpenLogic",
];

fn jdk_root() -> io::Result<PathBuf> {
    known_folder(&FOLDERID_ProgramFilesX64)
}

fn native_java_exe(path: &Path) -> io::Result<bool> {
    let mut input = fs::File::open(path)?;
    let mut start = [0u8; 64];
    input.read_exact(&mut start)?;
    if &start[..2] != b"MZ" {
        return Ok(false);
    }
    let offset = u32::from_le_bytes(start[60..64].try_into().expect("fixed header"));
    if !(64..=1048576).contains(&offset) {
        return Ok(false);
    }
    input.seek(io::SeekFrom::Start(u64::from(offset)))?;
    let mut pe = [0; 26];
    input.read_exact(&mut pe)?;
    Ok(&pe[..6] == b"PE\0\0\x64\x86" && &pe[24..26] == b"\x0b\x02")
}

pub(crate) fn approved_java(path: &Path) -> bool {
    if !ordinary(path, true)
        || path
            .file_name()
            .and_then(|p| p.to_str())
            .is_none_or(|p| !p.eq_ignore_ascii_case("java.exe"))
    {
        return false;
    }
    let Ok(root) = jdk_root() else {
        return false;
    };
    let Some(jdk) = path
        .parent()
        .filter(|b| b.file_name().is_some_and(|x| x == "bin"))
        .and_then(Path::parent)
    else {
        return false;
    };
    // Accept only a direct installed JDK under a recognized Program Files vendor directory.
    jdk.parent()
        .is_some_and(|p| JDK_VENDORS.iter().any(|v| same_path(p, &root.join(v))))
        && native_java_exe(path).unwrap_or(false)
}

pub(crate) fn discover_java() -> Vec<String> {
    let Ok(root) = jdk_root() else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for vendor in JDK_VENDORS {
        let dir = root.join(vendor);
        if !ordinary(&dir, false) {
            continue;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.take(32).filter_map(Result::ok) {
                let executable = entry.path().join("bin").join("java.exe");
                if approved_java(&executable) {
                    if let Some(path) = executable.to_str() {
                        result.push(path.to_owned());
                    }
                }
            }
        }
    }
    result.sort();
    result.dedup();
    result.truncate(16);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_comparison_rejects_network_devices_and_aliases() {
        assert!(same_path(
            Path::new(r"C:\Users\Preview\AppData"),
            Path::new(r"\\?\c:\users\preview\appdata")
        ));
        for path in [
            r"C:Users\Test",
            r"C:\Users\..\Windows",
            r"\\machine\share\Test",
            r"\\.\C:\Test",
            r"C:\Users\Test.",
            r"C:\Users\Test:alt",
        ] {
            assert!(!same_path(Path::new(path), Path::new(path)), "{path}");
        }
    }
}
