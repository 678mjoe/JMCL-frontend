/**
 * Shared types mirroring the core contract (gui-handoff.md §2, §4).
 * All additive-tolerant: the core may add fields at any time (§11).
 */

export type Source = "official" | "bmclapi";

/** The loader fields accepted by server.create and stored in server.json. */
export interface ServerLoaderFields {
  fabric_loader: string | null;
  neoforge_version: string | null;
  forge_version: string | null;
}

export type ServerLoaderName = "fabric" | "neoforge" | "forge";

/** Loader selection fields; the core accepts AT MOST ONE per request. */
export interface LoaderFields {
  fabric_loader?: string;
  neoforge_version?: string;
  forge_version?: string;
}

export type LoaderName = "fabric" | "neoforge" | "forge";

export type ContentKind = "mods" | "resourcepacks" | "shaderpacks";

export interface CoreIdentity {
  name: string;
  version: string;
  protocol: number;
}

export interface SessionInfo {
  session_id: number;
  core: CoreIdentity;
}

/** Offline/online launch session, passed as `auth` to launch.* (§4). */
export interface AuthSession {
  player_name: string;
  uuid: string;
  access_token: string;
  client_id?: string;
  xuid?: string;
  user_type?: string;
}

export interface InstanceManifest {
  id: string;
  name: string;
  version_id: string;
  fabric_loader: string | null;
  neoforge_version: string | null;
  forge_version: string | null;
  source: Source;
  /** Core-verified completion marker for this exact version and loader; source is intentionally ignored. */
  installed: boolean;
}

/** Manifest returned by server.create/list/get; mirrors core/server_store.Manifest. */
export interface ServerManifest extends ServerLoaderFields {
  id: string;
  name: string;
  version_id: string;
  source: Source;
  accept_eula: boolean;
  java_path: string | null;
  installed: boolean;
}

export interface ServerManifestResult extends ServerManifest {
  stage: "server.create" | "server.get";
}

export interface ServerListResult {
  stage: "server.list";
  servers: ServerManifest[];
}

export interface ServerStatus {
  stage: "server.status";
  id: string;
  running: boolean;
  stale_state: boolean;
  pid: number | null;
  supervisor_pid: number | null;
  java_path: string | null;
  started_at_ms: number | null;
  uptime_ms: number | null;
}

export interface ServerInstallResult {
  stage: "server.install";
  id: string;
  version_id: string;
  source: Source;
  java: JavaRuntime;
  properties_created: boolean;
  files_total: number;
  files_downloaded: number;
  files_cached: number;
  files_hard_linked: number;
  files_copied: number;
  bytes_verified: number;
  bytes_transferred: number;
}

export interface ServerLifecycleStartResult {
  stage: "server.start" | "server.restart";
  id: string;
  running: true;
  pid: number;
  supervisor_pid: number;
  started_at_ms: number;
  java_path: string;
}

export type ServerStopTermination = "graceful" | "terminated" | "killed";

export interface ServerStopResult {
  stage: "server.stop";
  id: string;
  running: false;
  termination: ServerStopTermination;
  pid: number | null;
}

export interface ServerLogResult {
  stage: "server.logs";
  id: string;
  text: string;
  file_id: number;
  start_cursor: number;
  next_cursor: number;
  eof: boolean;
  reset: boolean;
  truncated: boolean;
}

export type ServerProperties = Record<string, string>;

export interface ServerPropertiesResult {
  stage: "server.properties.get" | "server.properties.set";
  id: string;
  properties: ServerProperties;
}

export interface ServerCommandResult {
  stage: "server.command";
  id: string;
  accepted: true;
  pid: number;
}

export type ServerQueryMode = "basic" | "full";

export interface ServerQueryResult {
  stage: "server.query";
  mode: ServerQueryMode;
  hostname: string;
  game_type: string;
  map: string;
  version: string | null;
  players: number;
  max_players: number;
  host_port: number;
  host_ip: string;
  plugins: string | null;
  player_names: string[];
}

export interface ServerRconResult {
  stage: "server.rcon.command";
  text: string;
  truncated: boolean;
}

/** Server worlds use the same serialized metadata shape, but have server-specific identity. */
export interface ServerWorldEntry {
  name: string;
  level_name: string | null;
  version_name: string | null;
  version_id: number | null;
  game_mode: string | null;
  hardcore: boolean | null;
  cheats: boolean | null;
  difficulty: number | null;
  last_played_ms: number | null;
  size_bytes: number;
  has_icon: boolean;
  locked: boolean;
  version_relation: "same" | "different" | "unknown";
}

export interface ServerWorldListResult {
  stage: "server.worlds.list";
  id: string;
  worlds: ServerWorldEntry[];
}

export interface ServerWorldGetResult {
  stage: "server.worlds.get";
  id: string;
  world: ServerWorldEntry;
  icon_png_base64: string | null;
}

export interface ServerBackupEntry {
  file: string;
  world: string | null;
  created_ms: number;
  size_bytes: number;
}

export interface ServerBackupListResult {
  stage: "server.worlds.backups";
  id: string;
  backups: ServerBackupEntry[];
}

export interface ServerWorldRenameResult {
  stage: "server.worlds.rename";
  renamed: { old_name: string; new_name: string };
}

export interface ServerWorldDeleteResult {
  stage: "server.worlds.delete";
  deleted: string;
}

export interface ServerWorldBackupResult {
  stage: "server.worlds.backup";
  backup: string;
}

export interface ServerWorldRestoreResult {
  stage: "server.worlds.restore";
  restored: string;
}

export interface ServerWorldBackupDeleteResult {
  stage: "server.worlds.backups.delete";
  deleted: string;
}

export interface ServerContentSource {
  provider: "modrinth" | "curseforge" | "manual";
  project_id?: string;
  version_id?: string;
  slug?: string;
}

export interface ServerContentEntry {
  kind: "mod" | "datapack";
  file: string;
  sha1: string;
  size: number;
  source: ServerContentSource;
  enabled: boolean;
  as_dependency: boolean;
}

export interface ServerModEntry extends Omit<ServerContentEntry, "kind"> {
  kind: "mod";
}

export interface ServerDatapackEntry extends Omit<ServerContentEntry, "kind"> {
  kind: "datapack";
}

export interface ServerContentListResult {
  stage: "server.mods.list" | "server.datapacks.list";
  id: string;
  entries: ServerContentEntry[];
  unmanaged: string[];
}

export interface ServerContentInstallResult {
  stage: "server.mods.install" | "server.datapacks.install";
  id: string;
  installed: ServerInstalledContent[];
  skipped: number;
}

export interface ServerInstalledContent {
  file: string;
  sha1: string;
  size: number;
  slug: string | null;
  as_dependency: boolean;
}

export interface ServerContentSetVersionResult {
  stage: "server.mods.set-version" | "server.datapacks.set-version";
  id: string;
  changed: boolean;
  file: string;
  sha1: string;
  size: number;
  old_version_id: string;
  new_version_id: string;
}

export interface ServerContentToggleResult {
  stage:
    | "server.mods.enable"
    | "server.mods.disable"
    | "server.datapacks.enable"
    | "server.datapacks.disable";
  id: string;
  changed: boolean;
  entry: ServerContentEntry | null;
}

export interface ServerContentRemoveResult {
  stage: "server.mods.remove" | "server.datapacks.remove";
  id: string;
  removed: ServerContentEntry;
}

export interface ServerContentAdoptResult {
  stage: "server.mods.adopt" | "server.datapacks.adopt";
  id: string;
  adopted: ServerInstalledContent[];
}

/** Stable errors emitted by the documented server.* protocol surface. Messages are display-only. */
export type ServerErrorCode =
  | "INVALID_PARAMS"
  | "UNSUPPORTED_PLATFORM"
  | "ENVIRONMENT_UNAVAILABLE"
  | "SERVERS_ROOT_ERROR"
  | "SERVER_ROOT_ERROR"
  | "STORE_ROOT_ERROR"
  | "VERSION_RESOLUTION_FAILED"
  | "SERVER_NOT_FOUND"
  | "SERVER_EXISTS"
  | "SERVER_CREATE_FAILED"
  | "SERVER_LIST_FAILED"
  | "SERVER_LOAD_FAILED"
  | "SERVER_DELETE_FAILED"
  | "SERVER_NOT_INSTALLED"
  | "SERVER_ALREADY_RUNNING"
  | "SERVER_NOT_RUNNING"
  | "SERVER_STATUS_FAILED"
  | "SERVER_STATE_ERROR"
  | "EULA_NOT_ACCEPTED"
  | "SERVER_LOADER_UNSUPPORTED"
  | "SERVER_LOADER_REQUIRED"
  | "SERVER_PLAN_FAILED"
  | "SERVER_DOWNLOAD_UNAVAILABLE"
  | "SERVER_INSTALL_FAILED"
  | "SERVER_CONFIGURATION_FAILED"
  | "SERVER_START_FAILED"
  | "SERVER_STOP_FAILED"
  | "SERVER_RESTART_FAILED"
  | "SERVER_COMMAND_FAILED"
  | "JAVA_NOT_FOUND"
  | "JAVA_INCOMPATIBLE"
  | "SERVER_PROPERTIES_NOT_FOUND"
  | "SERVER_PROPERTIES_INVALID"
  | "SERVER_PROPERTIES_READ_FAILED"
  | "SERVER_PROPERTIES_WRITE_FAILED"
  | "SERVER_LOGS_NOT_FOUND"
  | "SERVER_LOGS_FAILED"
  | "SERVER_RCON_DISABLED"
  | "SERVER_QUERY_DISABLED"
  | "SERVER_RCON_AUTH_FAILED"
  | "SERVER_RCON_UNAVAILABLE"
  | "SERVER_QUERY_UNAVAILABLE"
  | "SERVER_RCON_PROTOCOL_ERROR"
  | "SERVER_QUERY_PROTOCOL_ERROR"
  | "SERVER_REMOTE_FAILED"
  | "CONTENT_NOT_FOUND"
  | "NO_COMPATIBLE_VERSION"
  | "INCOMPATIBLE_VERSION"
  | "VERSION_PROJECT_MISMATCH"
  | "CONTENT_CONFLICT"
  | "CONTENT_KIND_MISMATCH"
  | "UNSUPPORTED_PROJECT_TYPE"
  | "DOWNLOAD_UNAVAILABLE"
  | "HTTP_STATUS_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "CONTENT_LIST_FAILED"
  | "SERVER_CONTENT_INSTALL_FAILED"
  | "SERVER_CONTENT_SET_VERSION_FAILED"
  | "SERVER_CONTENT_TOGGLE_FAILED"
  | "SERVER_CONTENT_REMOVE_FAILED"
  | "SERVER_CONTENT_ADOPT_FAILED"
  | "SERVER_DATAPACKS_INSTALL_FAILED"
  | "SERVER_DATAPACKS_SET_VERSION_FAILED"
  | "SERVER_DATAPACKS_TOGGLE_FAILED"
  | "SERVER_DATAPACKS_REMOVE_FAILED"
  | "SERVER_DATAPACKS_ADOPT_FAILED"
  | "WORLD_NOT_FOUND"
  | "WORLD_EXISTS"
  | "WORLD_LOCKED"
  | "WORLD_INVALID_LEVEL_DATA"
  | "WORLD_ICON_TOO_LARGE"
  | "WORLD_ARCHIVE_TOO_LARGE"
  | "WORLD_ARCHIVE_INVALID"
  | "WORLD_LIST_FAILED"
  | "WORLD_GET_FAILED"
  | "WORLD_RENAME_FAILED"
  | "WORLD_COPY_FAILED"
  | "WORLD_DELETE_FAILED"
  | "WORLD_EXPORT_FAILED"
  | "WORLD_IMPORT_FAILED"
  | "WORLD_BACKUP_FAILED"
  | "WORLD_RESTORE_FAILED"
  | "BACKUP_NOT_FOUND";

export type ServerErrorCategory =
  | "validation"
  | "platform"
  | "filesystem"
  | "lifecycle"
  | "installation"
  | "java"
  | "properties"
  | "logs"
  | "remote"
  | "content"
  | "worlds";

export function serverErrorCategory(code: ServerErrorCode): ServerErrorCategory {
  if (code === "INVALID_PARAMS") return "validation";
  if (code === "UNSUPPORTED_PLATFORM") return "platform";
  if (
    code === "ENVIRONMENT_UNAVAILABLE" ||
    code === "SERVERS_ROOT_ERROR" ||
    code === "SERVER_ROOT_ERROR" ||
    code === "STORE_ROOT_ERROR"
  ) return "filesystem";
  if (code === "JAVA_NOT_FOUND" || code === "JAVA_INCOMPATIBLE") return "java";
  if (
    code === "EULA_NOT_ACCEPTED" ||
    code === "SERVER_NOT_INSTALLED" ||
    code === "SERVER_LOADER_UNSUPPORTED" ||
    code === "SERVER_LOADER_REQUIRED" ||
    code === "VERSION_RESOLUTION_FAILED" ||
    code === "SERVER_PLAN_FAILED" ||
    code === "SERVER_DOWNLOAD_UNAVAILABLE" ||
    code === "SERVER_INSTALL_FAILED" ||
    code === "SERVER_CONFIGURATION_FAILED"
  ) return "installation";
  if (code.startsWith("SERVER_PROPERTIES_")) return "properties";
  if (code.startsWith("SERVER_LOGS_")) return "logs";
  if (
    code.startsWith("SERVER_RCON_") ||
    code.startsWith("SERVER_QUERY_") ||
    code === "SERVER_REMOTE_FAILED"
  ) return "remote";
  if (
    code.startsWith("CONTENT_") ||
    code.startsWith("SERVER_CONTENT_") ||
    code.startsWith("SERVER_DATAPACKS_") ||
    code === "NO_COMPATIBLE_VERSION" ||
    code === "INCOMPATIBLE_VERSION" ||
    code === "VERSION_PROJECT_MISMATCH" ||
    code === "UNSUPPORTED_PROJECT_TYPE" ||
    code === "DOWNLOAD_UNAVAILABLE" ||
    code === "HTTP_STATUS_ERROR" ||
    code === "RESPONSE_TOO_LARGE"
  ) return "content";
  if (code.startsWith("WORLD_") || code === "BACKUP_NOT_FOUND") return "worlds";
  return "lifecycle";
}

export interface ContentSource {
  provider: "modrinth" | "curseforge" | "manual";
  project_id?: string;
  version_id?: string;
  slug?: string;
}

export interface ContentEntry {
  kind: string;
  /** Canonical path; disabled entries live on disk as `<file>.disabled`. */
  file: string;
  sha1: string;
  size: number;
  source: ContentSource;
  enabled: boolean;
  as_dependency: boolean;
}

export interface ContentListResult {
  entries: ContentEntry[];
  unmanaged: string[];
}

/**
 * One save directory under `<game dir>/saves/` (contract §4, docs/worlds.md).
 * All level.dat metadata fields are null for missing/corrupt level.dat.
 */
export interface WorldEntry {
  /** Directory name; also the world identity for every worlds.* call. */
  name: string;
  level_name: string | null;
  version_name: string | null;
  version_id: number | null;
  game_mode: string | null;
  hardcore: boolean | null;
  cheats: boolean | null;
  difficulty: number | null;
  last_played_ms: number | null;
  size_bytes: number;
  has_icon: boolean;
  /** session.lock flock held by a running game; mutations are refused (WORLD_LOCKED). Stale lock files report false. */
  locked: boolean;
  /** Advisory comparison against the requested minecraft_version; the core never blocks on it. */
  version_relation: "same" | "different" | "unknown";
}

/** One timestamped zip under `<game dir>/backups/` (contract §4). */
export interface WorldBackupEntry {
  file: string;
  /** Parsed from the file name; null for foreign zips. */
  world: string | null;
  created_ms: number;
  size_bytes: number;
}

export interface VersionResolveResult {
  /** "vanilla" or the loader kind. */
  kind: string;
  id: string;
  java_major_version?: number;
  [field: string]: unknown;
}

export interface VersionSummary {
  id: string;
  type?: string;
  [field: string]: unknown;
}

export interface VersionListResult {
  latest: Record<string, string>;
  versions: VersionSummary[];
}

/** Probed local Java runtime from java.detect (docs/java.md §Probe). */
export interface JavaRuntime {
  executable: string;
  /** Discovery channel: explicit | java_home | platform | path. */
  source?: string;
  major_version?: number;
  specification_version?: string;
  version?: string;
  runtime_version?: string;
  vendor?: string;
  java_home?: string;
  vm_name?: string;
  os_arch?: string;
  /** Normalized architecture: x86_64 | arm64. */
  architecture?: string;
  data_model?: number;
  [field: string]: unknown;
}

export interface JavaDetectResult {
  runtimes?: JavaRuntime[];
  probe_failures?: unknown[];
  [field: string]: unknown;
}

/** java.select result: exact major + architecture match (docs/java.md §RPC). */
export interface JavaSelectResult {
  version_id: string;
  required_major: number;
  required_arch: string;
  runtime: JavaRuntime;
  probe_failures?: unknown[];
  [field: string]: unknown;
}

export type JavaProvider = "auto" | "mojang" | "zulu";

/** java_policy on launch.plan/launch.execute/install.execute. */
export type JavaPolicy = "auto" | "local" | "managed";

/** Managed runtime receipt entry from java.runtime.list (docs/java.md). */
export interface ManagedJavaRuntime {
  /** Directory name under <store>/runtimes; the `runtime` key for java.runtime.remove. */
  name: string;
  provider: "mojang" | "zulu" | string;
  /** Mojang component name or Zulu major id (e.g. "zulu-8"). */
  id: string;
  platform: string;
  major_version: number;
  java_home: string;
  executable: string;
  version?: string | null;
  vendor?: string | null;
  component?: string | null;
  package_uuid?: string | null;
  source_url?: string;
  files_total?: number;
  bytes_total?: number;
  installed_at_ms?: number;
  [field: string]: unknown;
}

export interface JavaRuntimeListResult {
  runtimes: ManagedJavaRuntime[];
  [field: string]: unknown;
}

export interface InstallPrepareResult {
  native_directory: string;
}

export interface ModpackInstallResult {
  id: string;
  name: string;
  version_id: string;
  loader: { name: string; version: string } | null;
  files_installed: number;
  files_skipped: number;
  overrides_written: number;
}

export interface DeviceBeginResult {
  /** Keep private; never log. */
  device_code: string;
  /** Show to the user. */
  user_code: string;
  verification_uri: string;
  expires_in?: number;
  interval?: number;
  [field: string]: unknown;
}

export interface OAuthCredential {
  access_token: string;
  /** Keep private; persist to the keychain, never log. */
  refresh_token: string;
  [field: string]: unknown;
}

export type DevicePollResult =
  | { state: "authorization_pending" }
  | { state: "slow_down" }
  | {
      state: "authenticated";
      credential: OAuthCredential;
      [field: string]: unknown;
    };

export interface MinecraftExchangeResult {
  session: AuthSession;
  [field: string]: unknown;
}

export type RefreshExchangeResult =
  | {
      state: "authenticated";
      /** Rotated token — persist atomically BEFORE using the session. */
      refresh_token: string;
      session: AuthSession;
      [field: string]: unknown;
    }
  | {
      state: "exchange_failed";
      /** Rotated token — persist even though the exchange failed (§6.4). */
      refresh_token: string;
      exchange_error?: { code?: string; [field: string]: unknown };
      [field: string]: unknown;
    };

export interface AccountProfile {
  id: string;
  player_name: string;
  client_id: string;
  xuid?: string;
  [field: string]: unknown;
}

/** Progress event shapes (§2); forwarded verbatim, unknown fields kept. */
export interface ProgressInfo {
  files_completed: number;
  files_total: number;
  bytes_verified: number;
  bytes_total: number;
  bytes_transferred: number;
}
