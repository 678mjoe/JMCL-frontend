//! Windows handle-relative access. See the activation verification note for the
//! documented NT user-mode APIs and the external-writer compare/rename boundary.
use super::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::mem::{offset_of, size_of};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::ptr::{null, null_mut};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    FileRenameInformation, NtCreateFile, NtSetInformationFile, FILE_CREATE, FILE_OPEN,
    FILE_OPEN_REPARSE_POINT, FILE_RENAME_INFORMATION, FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_NO_MORE_FILES, HANDLE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
};
use windows_sys::Win32::Security::{
    GetKernelObjectSecurity, DACL_SECURITY_INFORMATION, GROUP_SECURITY_INFORMATION,
    OWNER_SECURITY_INFORMATION,
};
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

fn fail() -> SessionError {
    error("PACK_ACTIVATION_PATH")
}

// Disallow Win32 aliases even though NT relative names do not normalize them.
fn leaf(name: &str) -> bool {
    valid_name(name)
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
        && {
            let stem = name
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            !matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
                && !(stem.len() == 4
                    && (stem.starts_with("com") || stem.starts_with("lpt"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        }
}

fn info(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION, SessionError> {
    let mut value = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: live owned file handle and correctly sized writable output.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut value) } == 0 {
        return Err(fail());
    }
    if value.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(fail());
    }
    Ok(value)
}

// A drive letter may be a mapped share or SUBST subtree. Require a genuine local
// volume root, not merely FILE_TYPE_DISK (which also includes network files).
fn local_volume_root(file: &File) -> Result<(), SessionError> {
    let mut buffer = [0u16; 128];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            VOLUME_NAME_GUID | FILE_NAME_NORMALIZED,
        )
    } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(fail());
    }
    let path = String::from_utf16(&buffer[..length]).map_err(|_| fail())?;
    let guid = path
        .strip_prefix(r"\\?\Volume{")
        .and_then(|v| v.strip_suffix(r"}\"))
        .ok_or_else(fail)?;
    if guid.len() != 36
        || !guid.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
    {
        return Err(fail());
    }
    Ok(())
}

// A single component is opened relative to an already-validated handle. No
// ancestor pathname is re-resolved, including if a directory becomes a reparse
// point after opening. Share flags alone do NOT prevent reparse attribute edits.
fn open_nt(
    parent: Option<&File>,
    name: &str,
    create: bool,
    security: *const windows_sys::Win32::Security::SECURITY_DESCRIPTOR,
) -> Result<File, i32> {
    let mut wide: Vec<u16> = name.encode_utf16().collect();
    if wide.len() > 32766 || wide.contains(&0) {
        return Err(0xC0000033u32 as i32);
    }
    let text = UNICODE_STRING {
        Length: (wide.len() * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: wide.as_mut_ptr(),
    };
    let attrs = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.map_or(null_mut(), |p| p.as_raw_handle()),
        ObjectName: &text,
        Attributes: OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: security,
        SecurityQualityOfService: null(),
    };
    let mut handle: HANDLE = null_mut();
    let mut status = IO_STATUS_BLOCK::default();
    // GENERIC_READ includes LIST_DIRECTORY for directories. Deny writes and
    // deletion while inspecting; pre-existing conflicting handles fail closed.
    let access = FILE_GENERIC_READ
        | if create {
            FILE_GENERIC_WRITE | DELETE
        } else {
            0
        };
    // SAFETY: all counted strings/structures remain live during synchronous IO;
    // on success we transfer exactly one owned handle to File.
    let result = unsafe {
        NtCreateFile(
            &mut handle,
            access,
            &attrs,
            &mut status,
            null(),
            FILE_ATTRIBUTE_NORMAL,
            if create { 0 } else { FILE_SHARE_READ },
            if create { FILE_CREATE } else { FILE_OPEN },
            FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            null(),
            0,
        )
    };
    if result < 0 {
        Err(result)
    } else {
        Ok(unsafe { File::from_raw_handle(handle) })
    }
}
fn child(
    parent: &File,
    name: &str,
    directory: bool,
    single_link: bool,
) -> Result<File, SessionError> {
    if !leaf(name) {
        return Err(fail());
    }
    let file = open_nt(Some(parent), name, false, null()).map_err(|_| fail())?;
    let metadata = info(&file)?;
    if (metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        || (!directory && single_link && metadata.nNumberOfLinks != 1)
        || unsafe { GetFileType(file.as_raw_handle()) } != FILE_TYPE_DISK
    {
        return Err(fail());
    }
    Ok(file)
}
fn optional_dir(parent: &File, name: &str) -> Result<Option<File>, SessionError> {
    match open_nt(Some(parent), name, false, null()) {
        // STATUS_OBJECT_NAME_NOT_FOUND only, not access/sharing/reparse failures.
        Err(status) if status == 0xC0000034u32 as i32 => Ok(None),
        Err(_) => Err(fail()),
        Ok(file) => {
            if info(&file)?.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
                return Err(fail());
            }
            Ok(Some(file))
        }
    }
}
fn read_file(file: &mut File) -> Result<Vec<u8>, SessionError> {
    file.seek(SeekFrom::Start(0)).map_err(|_| fail())?;
    let mut bytes = Vec::new();
    file.take(MAX_OPTIONS as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| fail())?;
    if bytes.len() > MAX_OPTIONS {
        return Err(error("PACK_ACTIVATION_FORMAT"));
    }
    Ok(bytes)
}

pub struct InstanceFiles {
    // Keep every ancestor alive; deny-delete sharing blocks relocation of the
    // validated tree while reads and same-directory rename are in progress.
    _ancestors: Vec<File>,
    game: File,
    packs: Option<File>,
    target_name: &'static str,
    shader: bool,
}
impl InstanceFiles {
    pub fn open(root: &str, id: &str) -> Result<Self, SessionError> {
        Self::open_kind(root, id, None)
    }
    pub fn shader(root: &str, id: &str, runtime: ShaderRuntime) -> Result<Self, SessionError> {
        Self::open_kind(root, id, Some(runtime))
    }
    fn open_kind(
        root: &str,
        id: &str,
        runtime: Option<ShaderRuntime>,
    ) -> Result<Self, SessionError> {
        if !valid_instance_id(id) {
            return Err(fail());
        }
        let root = root
            .strip_prefix(r"\\?\")
            .unwrap_or(root)
            .replace('/', "\\");
        let bytes = root.as_bytes();
        if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || &bytes[1..3] != b":\\" {
            return Err(fail());
        }
        let components: Vec<_> = root[3..].split('\\').collect();
        if components.iter().any(|p| !leaf(p)) {
            return Err(fail());
        }
        // Only a local DOS drive root is resolved by name. Every subsequent
        // directory and file is opened by a single leaf relative to its handle.
        let volume = open_nt(None, &format!(r"\??\{}:\", bytes[0] as char), false, null())
            .map_err(|_| fail())?;
        if info(&volume)?.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
            return Err(fail());
        }
        local_volume_root(&volume)?;
        let mut ancestors = vec![volume];
        for part in components.into_iter().chain(std::iter::once(id)) {
            let next = child(ancestors.last().unwrap(), part, true, false)?;
            ancestors.push(next);
        }
        let instance = ancestors.last().unwrap();
        let manifest = read_file(&mut child(instance, "instance.json", false, true)?)?;
        if manifest.len() > 64 * 1024 {
            return Err(fail());
        }
        let manifest: serde_json::Value = serde_json::from_slice(&manifest).map_err(|_| fail())?;
        let version = validate_manifest(&manifest, id)?;
        let parts: Vec<_> = version.split('.').collect();
        if runtime.is_none()
            && (parts.len() < 2
                || parts.len() > 3
                || parts[0] != "1"
                || parts
                    .iter()
                    .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
                || parts[1].parse::<u32>().unwrap_or(0) < 13)
        {
            return Err(error("PACK_ACTIVATION_FORMAT"));
        }
        let mut game = child(instance, ".minecraft", true, false)?;
        let packs = optional_dir(
            &game,
            if runtime.is_some() {
                "shaderpacks"
            } else {
                "resourcepacks"
            },
        )?;
        if runtime.is_some() {
            let config = child(&game, "config", true, false)?;
            ancestors.push(game);
            game = config;
        }
        Ok(Self {
            _ancestors: ancestors,
            game,
            packs,
            target_name: match runtime {
                Some(ShaderRuntime::Iris) => "iris.properties",
                Some(ShaderRuntime::Oculus) => "oculus.properties",
                None => "options.txt",
            },
            shader: runtime.is_some(),
        })
    }
    fn target(&self) -> Result<File, SessionError> {
        match open_nt(Some(&self.game), self.target_name, false, null()) {
            Err(status) if status == 0xC0000034u32 as i32 => Err(error(if self.shader {
                "SHADER_ACTIVATION_CONFIG_MISSING"
            } else {
                "PACK_ACTIVATION_OPTIONS_MISSING"
            })),
            Err(_) => Err(fail()),
            Ok(file) => {
                let metadata = info(&file)?;
                if metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0
                    || metadata.nNumberOfLinks != 1
                    || unsafe { GetFileType(file.as_raw_handle()) } != FILE_TYPE_DISK
                {
                    return Err(fail());
                }
                Ok(file)
            }
        }
    }
    pub fn options(&self) -> Result<Vec<u8>, SessionError> {
        read_file(&mut self.target()?)
    }
    pub fn available(&self) -> Result<Vec<String>, SessionError> {
        let Some(packs) = &self.packs else {
            return Ok(Vec::new());
        };
        let mut names = Vec::new();
        let mut seen = 0usize;
        let mut restart = true;
        // u64 alignment satisfies FILE_ID_BOTH_DIR_INFO; byte offsets and name
        // lengths returned by the OS are checked before every dereference.
        let mut buffer = vec![0u64; 8192];
        loop {
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    packs.as_raw_handle(),
                    if restart {
                        FileIdBothDirectoryRestartInfo
                    } else {
                        FileIdBothDirectoryInfo
                    },
                    buffer.as_mut_ptr().cast(),
                    (buffer.len() * 8) as u32,
                )
            };
            restart = false;
            if ok == 0 {
                if unsafe { GetLastError() } == ERROR_NO_MORE_FILES {
                    break;
                }
                return Err(fail());
            }
            let mut offset = 0usize;
            loop {
                if offset > buffer.len() * 8 - size_of::<FILE_ID_BOTH_DIR_INFO>() || offset % 8 != 0
                {
                    return Err(fail());
                }
                let entry = unsafe {
                    &*buffer
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset)
                        .cast::<FILE_ID_BOTH_DIR_INFO>()
                };
                let length = entry.FileNameLength as usize;
                let start = offset + offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
                let end = start.checked_add(length).ok_or_else(fail)?;
                if length % 2 != 0 || end > buffer.len() * 8 {
                    return Err(fail());
                }
                let wide = unsafe {
                    std::slice::from_raw_parts(
                        buffer.as_ptr().cast::<u8>().add(start).cast::<u16>(),
                        length / 2,
                    )
                };
                seen += 1;
                if seen > 16384 {
                    return Err(error("PACK_ACTIVATION_FORMAT"));
                }
                if let Ok(name) = String::from_utf16(wide) {
                    if leaf(&name)
                        && (!self.shader
                            || (name.is_ascii() && name.trim() == name && name != "(internal)"))
                    {
                        let valid = if name.to_ascii_lowercase().ends_with(".zip") {
                            child(packs, &name, false, false).is_ok()
                        } else {
                            child(packs, &name, true, false)
                                .and_then(|dir| {
                                    child(
                                        &dir,
                                        if self.shader {
                                            "shaders"
                                        } else {
                                            "pack.mcmeta"
                                        },
                                        self.shader,
                                        !self.shader,
                                    )
                                })
                                .is_ok()
                        };
                        if valid {
                            names.push(if self.shader {
                                name
                            } else {
                                format!("file/{name}")
                            });
                        }
                        if names.len() > 4096 {
                            return Err(error("PACK_ACTIVATION_FORMAT"));
                        }
                    }
                }
                if entry.NextEntryOffset == 0 {
                    break;
                }
                let next = entry.NextEntryOffset as usize;
                if next < offset_of!(FILE_ID_BOTH_DIR_INFO, FileName) + length || next % 8 != 0 {
                    return Err(fail());
                }
                offset = offset.checked_add(next).ok_or_else(fail)?;
            }
        }
        names.sort();
        names.dedup();
        Ok(names)
    }
    pub fn replace(
        &self,
        expected: &[u8],
        replacement: &[u8],
        nonce: u64,
    ) -> Result<(), SessionError> {
        if replacement.len() > MAX_OPTIONS {
            return Err(error("PACK_ACTIVATION_FORMAT"));
        }
        let mut original = self.target()?;
        // Do not materialize an encrypted configuration as plaintext staging.
        if info(&original)?.dwFileAttributes & FILE_ATTRIBUTE_ENCRYPTED != 0 {
            return Err(fail());
        }
        if read_file(&mut original)? != expected {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        // Preserve owner/group/DACL on the new file. No privilege elevation, ACL
        // relaxation, or ignore-security-error fallback is allowed.
        let mut security = vec![0u64; 8192];
        let mut needed = 0;
        let requested =
            OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
        if unsafe {
            GetKernelObjectSecurity(
                original.as_raw_handle(),
                requested,
                security.as_mut_ptr().cast(),
                (security.len() * 8) as u32,
                &mut needed,
            )
        } == 0
        {
            return Err(fail());
        }
        let temporary = format!(".jmcl-options-{}-{nonce}.tmp", std::process::id());
        let output = open_nt(Some(&self.game), &temporary, true, security.as_ptr().cast())
            .map_err(|_| fail())?;
        struct Temporary(File, bool);
        impl Drop for Temporary {
            fn drop(&mut self) {
                if !self.1 {
                    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
                    // Delete only the object we created, never a re-resolved path.
                    unsafe {
                        SetFileInformationByHandle(
                            self.0.as_raw_handle(),
                            FileDispositionInfo,
                            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                            size_of::<FILE_DISPOSITION_INFO>() as u32,
                        );
                    }
                }
            }
        }
        let mut output = Temporary(output, false);
        output
            .0
            .write_all(replacement)
            .and_then(|_| output.0.sync_all())
            .map_err(|_| fail())?;
        if info(&original)?.nNumberOfLinks != 1 || read_file(&mut original)? != expected {
            return Err(error("PACK_ACTIVATION_CHANGED"));
        }
        // Classic Windows rename cannot replace an open deny-delete target.
        // Close immediately before committing. Like Unix compare+rename, this
        // detects observed conflicts, NOT an OS CAS against hostile writers.
        drop(original);
        let wide: Vec<u16> = self.target_name.encode_utf16().collect();
        let length = size_of::<FILE_RENAME_INFORMATION>() + wide.len() * 2;
        let mut buffer = vec![0u64; length.div_ceil(8)];
        let rename = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
        let mut status = IO_STATUS_BLOCK::default();
        // SAFETY: aligned, zeroed allocation covers header+UTF-16 name; the fixed
        // leaf plus NULL RootDirectory means rename in the staging handle's own
        // directory, without reopening a destination directory by name.
        let result = unsafe {
            (*rename).Anonymous.ReplaceIfExists = true;
            (*rename).RootDirectory = null_mut();
            (*rename).FileNameLength = (wide.len() * 2) as u32;
            std::ptr::copy_nonoverlapping(
                wide.as_ptr(),
                (*rename).FileName.as_mut_ptr(),
                wide.len(),
            );
            NtSetInformationFile(
                output.0.as_raw_handle(),
                &mut status,
                buffer.as_ptr().cast(),
                length as u32,
                FileRenameInformation,
            )
        };
        if result < 0 {
            return Err(fail());
        }
        output.1 = true;
        Ok(())
    }
}
