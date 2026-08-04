/**
 * Shared types mirroring the core contract (gui-handoff.md §2, §4).
 * All additive-tolerant: the core may add fields at any time (§11).
 */

export type Source = "official" | "bmclapi";

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

export interface JavaRuntime {
  path: string;
  major_version?: number;
  arch?: string;
  [field: string]: unknown;
}

export interface JavaDetectResult {
  runtimes?: JavaRuntime[];
  failures?: unknown[];
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
