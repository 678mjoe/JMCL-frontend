//! Bounded, read-only manifest inspection. This is NOT full Core validation,
//! download planning, or an assurance that the selected archive can install.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_ARCHIVE: u64 = 512 * 1024 * 1024; // matches Core's archive input ceiling
const MAX_DIRECTORY: u64 = 8 * 1024 * 1024;
const MAX_MANIFEST: u64 = 4 * 1024 * 1024; // deliberately smaller preview budget
const MAX_ENTRIES: u16 = 65_534; // ZIP64 is not supported by this preview
const MAX_FILES: usize = 4096;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PreviewError {
    pub code: &'static str,
}
type Result<T> = std::result::Result<T, PreviewError>;
fn err(code: &'static str) -> PreviewError {
    PreviewError { code }
}
fn invalid() -> PreviewError {
    err("MODPACK_PREVIEW_INVALID")
}
fn limit() -> PreviewError {
    err("MODPACK_PREVIEW_LIMIT")
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Loader {
    pub kind: &'static str,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ModpackPreview {
    pub provider: &'static str,
    pub name: String,
    pub version: Option<String>,
    pub minecraft_version: String,
    pub loader: Option<Loader>,
    /// Declared manifest references, not override files or total disk usage.
    pub files_declared: usize,
    /// CurseForge's optional references; null for formats without that policy.
    pub files_optional: Option<usize>,
}

pub fn preview(file: &str) -> Result<ModpackPreview> {
    if file.is_empty() {
        return Err(invalid());
    }
    let path = Path::new(file);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let mut input = options
        .open(path)
        .map_err(|_| err("MODPACK_PREVIEW_READ_FAILED"))?;
    let metadata = input
        .metadata()
        .map_err(|_| err("MODPACK_PREVIEW_READ_FAILED"))?;
    if !metadata.is_file() {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(invalid());
        }
    }
    if metadata.len() > MAX_ARCHIVE {
        return Err(limit());
    }
    preview_reader(&mut input, metadata.len())
}

// Validate the central-directory budget before the ZIP library allocates its
// entry map. Multi-disk, prepended/self-extracting, ZIP64 and ambiguous manifests
// are intentionally unsupported rather than silently guessed.
fn directory_budget(input: &mut (impl Read + Seek), length: u64) -> Result<usize> {
    if length < 22 {
        return Err(invalid());
    }
    if length > MAX_ARCHIVE {
        return Err(limit());
    }
    let tail_len = length.min(65_557) as usize;
    input
        .seek(SeekFrom::End(-(tail_len as i64)))
        .map_err(|_| invalid())?;
    let mut tail = vec![0; tail_len];
    input.read_exact(&mut tail).map_err(|_| invalid())?;
    let offset = (0..=tail_len - 22)
        .rev()
        .find(|&i| {
            tail[i..i + 4] == *b"PK\x05\x06"
                && i + 22 + u16::from_le_bytes([tail[i + 20], tail[i + 21]]) as usize == tail_len
        })
        .ok_or_else(invalid)?;
    let u16at = |i| u16::from_le_bytes([tail[offset + i], tail[offset + i + 1]]);
    let u32at = |i| u32::from_le_bytes(tail[offset + i..offset + i + 4].try_into().unwrap());
    let count = u16at(10);
    if u16at(4) != 0
        || u16at(6) != 0
        || u16at(8) != count
        || count > MAX_ENTRIES
        || u32at(12) == u32::MAX
        || u32at(16) == u32::MAX
    {
        return Err(err("MODPACK_PREVIEW_UNSUPPORTED"));
    }
    let directory_size = u32at(12) as u64;
    let directory_start = u32at(16) as u64;
    if directory_size > MAX_DIRECTORY {
        return Err(limit());
    }
    if directory_start + directory_size != length - tail_len as u64 + offset as u64 {
        return Err(invalid());
    }
    // Scan raw directory records so duplicate names cannot be hidden by a ZIP
    // library's name-index map. Only manifest names are retained.
    input
        .seek(SeekFrom::Start(directory_start))
        .map_err(|_| invalid())?;
    let mut directory = vec![0; directory_size as usize];
    input.read_exact(&mut directory).map_err(|_| invalid())?;
    let mut at = 0usize;
    let mut manifests = 0usize;
    for _ in 0..count {
        let header = directory.get(at..at + 46).ok_or_else(invalid)?;
        if header[..4] != *b"PK\x01\x02" {
            return Err(invalid());
        }
        let size = |i| u16::from_le_bytes([header[i], header[i + 1]]) as usize;
        let name_len = size(28);
        let total = 46usize
            .checked_add(name_len)
            .and_then(|n| n.checked_add(size(30)))
            .and_then(|n| n.checked_add(size(32)))
            .ok_or_else(invalid)?;
        let name = directory
            .get(at + 46..at + 46 + name_len)
            .ok_or_else(invalid)?;
        if name == b"modrinth.index.json" || name == b"manifest.json" {
            manifests += 1;
            if size(8) & 1 != 0 || ![0, 8].contains(&size(10)) {
                return Err(err("MODPACK_PREVIEW_UNSUPPORTED"));
            }
            let mode = u32::from_le_bytes(header[38..42].try_into().unwrap()) >> 16;
            if mode & 0o170000 != 0 && mode & 0o170000 != 0o100000 {
                return Err(invalid());
            }
        }
        at = at.checked_add(total).ok_or_else(invalid)?;
        if at > directory.len() {
            return Err(invalid());
        }
    }
    if at != directory.len() {
        return Err(invalid());
    }
    match manifests {
        0 => Err(err("MODPACK_PREVIEW_UNKNOWN_FORMAT")),
        1 => Ok(count as usize),
        _ => Err(err("MODPACK_PREVIEW_AMBIGUOUS")),
    }
}

fn preview_reader(input: &mut (impl Read + Seek), length: u64) -> Result<ModpackPreview> {
    let count = directory_budget(input, length)?;
    input.seek(SeekFrom::Start(0)).map_err(|_| invalid())?;
    let mut archive = zip::ZipArchive::new(input).map_err(|_| invalid())?;
    if archive.len() != count {
        return Err(invalid());
    }
    let name = if archive.index_for_name("modrinth.index.json").is_some() {
        "modrinth.index.json"
    } else {
        "manifest.json"
    };
    let mut entry = archive.by_name(name).map_err(|_| invalid())?;
    if entry.encrypted()
        || !matches!(
            entry.compression(),
            zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
        )
    {
        return Err(err("MODPACK_PREVIEW_UNSUPPORTED"));
    }
    if entry
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
    {
        return Err(invalid());
    }
    if entry.size() > MAX_MANIFEST {
        return Err(limit());
    }
    let mut bytes = Vec::new();
    entry
        .by_ref()
        .take(MAX_MANIFEST + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err(limit());
    }
    if name == "modrinth.index.json" {
        parse_modrinth(&bytes)
    } else {
        parse_curseforge(&bytes)
    }
}

fn text(value: &str, max: usize) -> Result<()> {
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn version(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_+".contains(&b))
    {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn pack_version(value: &Option<String>) -> Result<()> {
    if let Some(v) = value {
        text(v, 256)?;
    }
    Ok(())
}
fn select_loader(selected: &mut Option<Loader>, kind: &'static str, value: &str) -> Result<()> {
    version(value)?;
    let loader = Loader {
        kind,
        version: value.into(),
    };
    if selected.as_ref().is_some_and(|old| old != &loader) {
        return Err(err("MODPACK_PREVIEW_LOADER_CONFLICT"));
    }
    *selected = Some(loader);
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Modrinth {
    format_version: u32,
    game: String,
    name: String,
    version_id: Option<String>,
    files: Vec<Value>,
    dependencies: Dependencies,
}
#[derive(Deserialize)]
struct Dependencies {
    minecraft: String,
    #[serde(rename = "fabric-loader")]
    fabric: Option<String>,
    #[serde(rename = "quilt-loader")]
    quilt: Option<String>,
    forge: Option<String>,
    neoforge: Option<String>,
}
fn parse_modrinth(bytes: &[u8]) -> Result<ModpackPreview> {
    let manifest: Modrinth = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if manifest.format_version != 1 || manifest.game != "minecraft" {
        return Err(err("MODPACK_PREVIEW_UNSUPPORTED"));
    }
    text(&manifest.name, 256)?;
    pack_version(&manifest.version_id)?;
    version(&manifest.dependencies.minecraft)?;
    if manifest.files.len() > MAX_FILES {
        return Err(limit());
    }
    if manifest.dependencies.quilt.is_some() {
        return Err(err("MODPACK_PREVIEW_UNSUPPORTED_LOADER"));
    }
    let mut loader = None;
    for (kind, value) in [
        ("fabric", manifest.dependencies.fabric),
        ("forge", manifest.dependencies.forge),
        ("neoforge", manifest.dependencies.neoforge),
    ] {
        if let Some(value) = value {
            if loader.is_some() {
                return Err(err("MODPACK_PREVIEW_LOADER_CONFLICT"));
            }
            select_loader(&mut loader, kind, &value)?;
        }
    }
    Ok(ModpackPreview {
        provider: "modrinth",
        name: manifest.name,
        version: manifest.version_id,
        minecraft_version: manifest.dependencies.minecraft,
        loader,
        files_declared: manifest.files.len(),
        files_optional: None,
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForge {
    manifest_type: String,
    manifest_version: u32,
    name: String,
    version: Option<String>,
    files: Vec<CurseFile>,
    minecraft: Minecraft,
}
#[derive(Deserialize)]
struct CurseFile {
    #[serde(rename = "projectID")]
    project_id: u32,
    #[serde(rename = "fileID")]
    file_id: u32,
    #[serde(default = "yes")]
    required: bool,
}
fn yes() -> bool {
    true
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Minecraft {
    version: String,
    #[serde(default)]
    mod_loaders: Vec<CurseLoader>,
}
#[derive(Deserialize)]
struct CurseLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}
fn parse_curseforge(bytes: &[u8]) -> Result<ModpackPreview> {
    let manifest: CurseForge = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if manifest.manifest_version != 1 || manifest.manifest_type != "minecraftModpack" {
        return Err(err("MODPACK_PREVIEW_UNSUPPORTED"));
    }
    text(&manifest.name, 256)?;
    pack_version(&manifest.version)?;
    version(&manifest.minecraft.version)?;
    if manifest.files.len() > MAX_FILES || manifest.minecraft.mod_loaders.len() > 4 {
        return Err(limit());
    }
    if manifest
        .files
        .iter()
        .any(|f| f.project_id == 0 || f.file_id == 0)
    {
        return Err(invalid());
    }
    let mut loader = None;
    for candidate in manifest.minecraft.mod_loaders {
        let (kind, value) = candidate.id.split_once('-').ok_or_else(invalid)?;
        let kind = match kind {
            "fabric" => "fabric",
            "forge" => "forge",
            "neoforge" => "neoforge",
            _ => return Err(err("MODPACK_PREVIEW_UNSUPPORTED_LOADER")),
        };
        select_loader(&mut loader, kind, value)?;
        if candidate.primary {
            break;
        } // matches Core's first-primary selection
    }
    Ok(ModpackPreview {
        provider: "curseforge",
        name: manifest.name,
        version: manifest.version,
        minecraft_version: manifest.minecraft.version,
        loader,
        files_declared: manifest.files.len(),
        files_optional: Some(manifest.files.iter().filter(|f| !f.required).count()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    const MR: &str = r#"{"formatVersion":1,"game":"minecraft","name":"Test Pack","versionId":"v1","files":[],"dependencies":{"minecraft":"1.20.1","fabric-loader":"0.15.0"}}"#;
    const CF: &str = r#"{"manifestType":"minecraftModpack","manifestVersion":1,"name":"CF Pack","minecraft":{"version":"1.20.1","modLoaders":[{"id":"forge-47.2.0","primary":true}]},"files":[{"projectID":1,"fileID":2},{"projectID":2,"fileID":3,"required":false}]}"#;
    fn archive(entries: &[(&str, &[u8])], compressed: bool) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            let options =
                zip::write::SimpleFileOptions::default().compression_method(if compressed {
                    zip::CompressionMethod::Deflated
                } else {
                    zip::CompressionMethod::Stored
                });
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn inspect(bytes: Vec<u8>) -> Result<ModpackPreview> {
        let len = bytes.len() as u64;
        preview_reader(&mut Cursor::new(bytes), len)
    }
    #[test]
    fn stored_and_deflated_manifest_metadata() {
        for compressed in [false, true] {
            let preview = inspect(archive(
                &[("modrinth.index.json", MR.as_bytes())],
                compressed,
            ))
            .unwrap();
            assert_eq!(preview.provider, "modrinth");
            assert_eq!(preview.name, "Test Pack");
            assert_eq!(preview.minecraft_version, "1.20.1");
            assert_eq!(
                preview.loader.unwrap(),
                Loader {
                    kind: "fabric",
                    version: "0.15.0".into()
                }
            );
            assert_eq!(preview.files_optional, None);
            let preview =
                inspect(archive(&[("manifest.json", CF.as_bytes())], compressed)).unwrap();
            assert_eq!(preview.provider, "curseforge");
            assert_eq!(preview.version, None);
            assert_eq!(preview.files_declared, 2);
            assert_eq!(preview.files_optional, Some(1));
        }
    }
    #[test]
    fn rejects_ambiguous_or_missing_manifest_without_guessing_extension() {
        assert_eq!(
            inspect(archive(
                &[
                    ("modrinth.index.json", MR.as_bytes()),
                    ("manifest.json", CF.as_bytes())
                ],
                false
            ))
            .unwrap_err()
            .code,
            "MODPACK_PREVIEW_AMBIGUOUS"
        );
        assert_eq!(
            inspect(archive(&[("nested/manifest.json", CF.as_bytes())], false))
                .unwrap_err()
                .code,
            "MODPACK_PREVIEW_UNKNOWN_FORMAT"
        );
        assert!(inspect(b"not an archive".to_vec()).is_err());
    }
    #[test]
    fn duplicate_central_names_are_rejected_before_name_map_collapse() {
        let mut data = archive(
            &[
                ("manifest.json", CF.as_bytes()),
                ("manifesz.json", CF.as_bytes()),
            ],
            false,
        );
        for i in 0..data.len() - 13 {
            if &data[i..i + 13] == b"manifesz.json" {
                data[i + 7] = b't';
            }
        }
        assert_eq!(inspect(data).unwrap_err().code, "MODPACK_PREVIEW_AMBIGUOUS");
    }
    #[test]
    fn budget_exhaustion_is_not_an_invalid_format_claim() {
        let data = archive(
            &[("manifest.json", &vec![b' '; MAX_MANIFEST as usize + 1])],
            true,
        );
        assert_eq!(inspect(data).unwrap_err().code, "MODPACK_PREVIEW_LIMIT");
        let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
        let eocd = data.len() - 22;
        data[eocd + 12..eocd + 16].copy_from_slice(&((MAX_DIRECTORY + 1) as u32).to_le_bytes());
        assert_eq!(inspect(data).unwrap_err().code, "MODPACK_PREVIEW_LIMIT");
        let data = archive(&[("manifest.json", CF.as_bytes())], false);
        let mut cursor = Cursor::new(data);
        assert_eq!(
            directory_budget(&mut cursor, MAX_ARCHIVE + 1)
                .unwrap_err()
                .code,
            "MODPACK_PREVIEW_LIMIT"
        );
    }
    #[test]
    fn invalid_manifest_fields_and_unsupported_loader_are_not_guessed() {
        for text in [
            MR.replace("\"formatVersion\":1", "\"formatVersion\":2"),
            MR.replace("fabric-loader", "quilt-loader"),
            MR.replace("1.20.1", "../../escape"),
            MR.replace("Test Pack", "Test\\u0000Pack"),
            MR.replace(
                "\"name\":\"Test Pack\"",
                "\"name\":\"Test Pack\",\"name\":\"Another\"",
            ),
        ] {
            assert!(inspect(archive(&[("modrinth.index.json", text.as_bytes())], false)).is_err());
        }
        let conflict = MR.replace(
            "\"fabric-loader\":\"0.15.0\"",
            "\"fabric-loader\":\"0.15.0\",\"forge\":\"47.2.0\"",
        );
        assert_eq!(
            inspect(archive(
                &[("modrinth.index.json", conflict.as_bytes())],
                false
            ))
            .unwrap_err()
            .code,
            "MODPACK_PREVIEW_LOADER_CONFLICT"
        );
    }
    #[test]
    fn corrupt_or_truncated_zip_is_rejected() {
        let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
        let start = data
            .windows(CF.len())
            .position(|w| w == CF.as_bytes())
            .unwrap();
        data[start] = b'[';
        assert!(inspect(data).is_err());
        let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
        data.truncate(data.len() - 5);
        assert!(inspect(data).is_err());
    }
    #[test]
    fn rejects_encrypted_unsupported_compression_and_manifest_symlink() {
        for (field, value, code) in [
            (8, 1, "MODPACK_PREVIEW_UNSUPPORTED"),
            (10, 99, "MODPACK_PREVIEW_UNSUPPORTED"),
        ] {
            let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
            let at = data.windows(4).position(|s| s == b"PK\x01\x02").unwrap();
            data[at + field..at + field + 2].copy_from_slice(&(value as u16).to_le_bytes());
            assert_eq!(inspect(data).unwrap_err().code, code);
        }
        let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
        let at = data.windows(4).position(|s| s == b"PK\x01\x02").unwrap();
        data[at + 38..at + 42].copy_from_slice(&(0o120777u32 << 16).to_le_bytes());
        assert_eq!(inspect(data).unwrap_err().code, "MODPACK_PREVIEW_INVALID");
    }
    #[test]
    fn rejects_zip64_and_multidisk_preview() {
        for offset in [4, 6, 10] {
            let mut data = archive(&[("manifest.json", CF.as_bytes())], false);
            let eocd = data.len() - 22;
            data[eocd + offset..eocd + offset + 2].copy_from_slice(&u16::MAX.to_le_bytes());
            assert_eq!(
                inspect(data).unwrap_err().code,
                "MODPACK_PREVIEW_UNSUPPORTED"
            );
        }
    }
    #[test]
    fn preview_does_not_write_or_extract_other_entries() {
        let dir = std::env::temp_dir().join(format!("jmcl-preview-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("synthetic.zip");
        let bytes = archive(
            &[
                ("manifest.json", CF.as_bytes()),
                ("overrides/config/example.txt", b"synthetic"),
            ],
            true,
        );
        std::fs::write(&path, &bytes).unwrap();
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(preview(path.to_str().unwrap()).unwrap().name, "CF Pack");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            before
        );
        assert!(!dir.join("overrides").exists());
        #[cfg(unix)]
        {
            let link = dir.join("alias.zip");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(preview(link.to_str().unwrap()).is_err());
            std::fs::remove_file(link).unwrap();
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
