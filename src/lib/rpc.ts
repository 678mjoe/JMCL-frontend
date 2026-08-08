/**
 * Typed client for the Tauri → jmcl-core RPC bridge.
 *
 * The Rust side owns process/session management (`core_open`, `core_close`,
 * `core_request`); this module is the GUI's single contract surface.
 * Protocol v1 is synchronous per session — requests on one CoreSession
 * queue internally; open extra sessions for concurrent operations on
 * *different* instance directories (contract §1).
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AccountProfile,
  AuthSession,
  ContentKind,
  ContentListResult,
  CoreIdentity,
  DeviceBeginResult,
  DevicePollResult,
  InstallPrepareResult,
  InstanceManifest,
  JavaDetectResult,
  JavaPolicy,
  JavaProvider,
  JavaRuntimeListResult,
  JavaSelectResult,
  LoaderFields,
  LoaderName,
  MinecraftExchangeResult,
  ModpackInstallResult,
  RefreshExchangeResult,
  SessionInfo,
  Source,
  VersionListResult,
  VersionResolveResult,
  WorldBackupEntry,
  WorldEntry,
} from "./types";

export interface CoreEvent {
  event: string;
  id?: string;
}
export interface LooseCoreEvent extends CoreEvent {
  [field: string]: unknown;
}

interface InstallEventBase {
  id?: string;
  source: Source;
}

export type InstallEvent =
  | (InstallEventBase & {
      event: "started";
      started: {
        stage: "download";
        version_id: string;
        files_total: number;
        bytes_total: number;
      };
    })
  | (InstallEventBase & {
      event: "file";
      file: {
        path: string;
        status: string;
        placement: string;
        size: number;
        attempts: number;
      };
    })
  | (InstallEventBase & {
      event: "retry";
      retry: {
        path: string;
        attempt: number;
        max_attempts: number;
        error: string;
      };
    })
  | (InstallEventBase & {
      event: "progress";
      progress: {
        files_completed: number;
        files_total: number;
        bytes_verified: number;
        bytes_total: number;
        bytes_processed: number;
        bytes_transferred: number;
      };
    })
  | (InstallEventBase & {
      event: "processor_started";
      processor_started: {
        stage: "processor";
        index: number;
        total: number;
        name: string;
      };
    });

/** Non-terminal items streamed from the Rust session layer during a request. */
export type SessionEvent<E extends CoreEvent = LooseCoreEvent> =
  | {
      kind: "event";
      /** Core progress/lifecycle event, forwarded verbatim. */
      data: E;
    }
  | { kind: "diagnostic"; data: string };

/** Failure shape serialized by the Rust session layer. */
export class RpcError extends Error {
  /** "rpc" = core rejected (stable contract code); "transport" = session-level. */
  readonly kind: "rpc" | "transport";
  /** Stable contract code when kind === "rpc" (contract §7). */
  readonly code?: string;

  constructor(raw: { kind?: string; code?: string; message?: string }) {
    super(raw.message ?? "unknown RPC failure");
    this.name = "RpcError";
    this.kind = raw.kind === "rpc" ? "rpc" : "transport";
    this.code = raw.code;
  }
}

function normalizeError(e: unknown): unknown {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return new RpcError(e as { kind?: string; code?: string; message?: string });
  }
  return e;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw normalizeError(e);
  }
}

export type EventHandler<E extends CoreEvent = LooseCoreEvent> = (
  event: SessionEvent<E>,
) => void;

/**
 * One synchronous RPC session with a core endpoint.
 *
 * Requests queue internally (protocol v1). For concurrency, open additional
 * sessions — operations on different instance directories are independent,
 * but never mutate the same instance directory from two sessions at once.
 */
export class CoreSession {
  private constructor(
    readonly id: number,
    readonly core: CoreIdentity,
  ) {}

  /**
   * Spawn `jmcl-core rpc` and run the protocol handshake.
   * @param binaryPath explicit core path; otherwise JMCL_CORE env or
   * auto-detection next to/above the app executable.
   */
  static async open(binaryPath?: string): Promise<CoreSession> {
    const info = await call<SessionInfo>("core_open", {
      binaryPath: binaryPath ?? null,
    });
    return new CoreSession(info.session_id, info.core);
  }

  /** Half-close the session; an in-flight request finishes first. */
  async close(): Promise<void> {
    await call("core_close", { sessionId: this.id });
  }

  /** Send one request; resolves with the terminal `result`. */
  async request<T = unknown, E extends CoreEvent = LooseCoreEvent>(
    method: string,
    params: Record<string, unknown> = {},
    onEvent?: EventHandler<E>,
    options: { compactEvents?: boolean } = {},
  ): Promise<T> {
    const events = new Channel<SessionEvent<E>>();
    events.onmessage = onEvent ?? (() => {});
    return call<T>("core_request", {
      sessionId: this.id,
      method,
      params,
      events,
      compactEvents: options.compactEvents ?? false,
    });
  }

  // --- handshake / liveness ------------------------------------------------

  ping(): Promise<{ pong: boolean }> {
    return this.request("ping");
  }

  // --- versions & installation ----------------------------------------------

  versionList(opts: { type?: string; limit?: number; source?: Source } = {}) {
    return this.request<VersionListResult>("version.list", { ...opts });
  }

  versionGet(id: string, source?: Source) {
    return this.request<Record<string, unknown>>("version.get", { id, source });
  }

  /**
   * Standalone form of the instance.create validation step: resolves a
   * Minecraft version plus at most one loader online. METADATA_TIMEOUT when
   * the fetch stalls (contract §4).
   */
  versionResolve(id: string, opts: { source?: Source } & LoaderFields = {}) {
    return this.request<VersionResolveResult>("version.resolve", { id, ...opts });
  }

  installPlan(id: string, opts: Partial<{
    source: Source;
    os: string;
    arch: string;
  }> & LoaderFields = {}) {
    return this.request<Record<string, unknown>>("install.plan", { id, ...opts });
  }

  installExecute(
    id: string,
    opts: Partial<{
      directory: string;
      store_directory: string;
      source: Source;
      os: string;
      arch: string;
      workers: number;
      retries: number;
      java_policy: JavaPolicy;
    }> & LoaderFields = {},
    onEvent?: EventHandler<InstallEvent>,
  ) {
    return this.request<Record<string, unknown>, InstallEvent>(
      "install.execute",
      { id, ...opts },
      onEvent,
      { compactEvents: true },
    );
  }

  installPrepare(
    id: string,
    opts: Partial<{ directory: string; source: Source; os: string; arch: string }> &
      LoaderFields = {},
  ) {
    return this.request<InstallPrepareResult>("install.prepare", { id, ...opts });
  }

  // --- java -------------------------------------------------------------------

  javaDetect(paths?: string[]) {
    return this.request<JavaDetectResult>("java.detect", { paths });
  }

  javaSelect(id: string, opts: { source?: Source; arch?: string; paths?: string[] } = {}) {
    return this.request<JavaSelectResult>("java.select", { id, ...opts });
  }

  javaRuntimeList(storeDirectory?: string) {
    return this.request<JavaRuntimeListResult>("java.runtime.list", {
      store_directory: storeDirectory,
    });
  }

  /** Exactly one of component/major (contract §4). Emits install-style progress events. */
  javaRuntimeInstall(
    target: { component: string } | { major: number },
    opts: Partial<{
      provider: JavaProvider;
      platform: string;
      store_directory: string;
      workers: number;
      retries: number;
    }> = {},
    onEvent?: EventHandler,
  ) {
    return this.request<Record<string, unknown>>(
      "java.runtime.install",
      { ...target, ...opts },
      onEvent,
    );
  }

  /** `runtime` is the receipt `name` from javaRuntimeList. */
  javaRuntimeRemove(runtime: string, storeDirectory?: string) {
    return this.request<Record<string, unknown>>("java.runtime.remove", {
      runtime,
      store_directory: storeDirectory,
    });
  }

  // --- launch -----------------------------------------------------------------

  launchPlan(
    id: string,
    nativesDirectory: string,
    auth: AuthSession,
    options: Record<string, unknown> = {},
    java: Partial<{
      java_policy: JavaPolicy;
      java_override: string;
      store_directory: string;
    }> = {},
  ) {
    return this.request<Record<string, unknown>>("launch.plan", {
      id,
      natives_directory: nativesDirectory,
      auth,
      options,
      ...java,
    });
  }

  launchExecute(
    id: string,
    auth: AuthSession,
    options: Record<string, unknown> = {},
    onEvent?: EventHandler,
    java: Partial<{
      java_policy: JavaPolicy;
      java_override: string;
      store_directory: string;
    }> = {},
  ) {
    return this.request<Record<string, unknown>>(
      "launch.execute",
      { id, auth, options, ...java },
      onEvent,
    );
  }

  // --- instances ----------------------------------------------------------------

  instanceCreate(
    directory: string,
    id: string,
    versionId: string,
    opts: { name?: string; source?: Source; validate?: boolean } & LoaderFields = {},
  ) {
    return this.request<InstanceManifest>("instance.create", {
      directory,
      id,
      version_id: versionId,
      ...opts,
    });
  }

  instanceList(directory: string) {
    return this.request<{ instances: InstanceManifest[] }>("instance.list", { directory });
  }

  instanceGet(directory: string, id: string) {
    return this.request<InstanceManifest>("instance.get", { directory, id });
  }

  instanceDelete(directory: string, id: string) {
    return this.request<unknown>("instance.delete", { directory, id });
  }

  // --- content (mods / resourcepacks / shaderpacks) -----------------------------

  contentList(kind: ContentKind, directory: string) {
    return this.request<ContentListResult>(`${kind}.list`, { directory });
  }

  contentInstall(
    kind: ContentKind,
    directory: string,
    minecraftVersion: string,
    project: string,
    opts: Partial<{
      version_id: string;
      provider: "modrinth" | "curseforge";
      api_key: string;
      with_dependencies: boolean;
      store_directory: string;
      workers: number;
      retries: number;
      /** Required for mods only. */
      loader: LoaderName;
    }> = {},
    onEvent?: EventHandler,
  ) {
    return this.request<Record<string, unknown>>(
      `${kind}.install`,
      { directory, minecraft_version: minecraftVersion, project, ...opts },
      onEvent,
    );
  }

  contentSetVersion(
    kind: ContentKind,
    directory: string,
    minecraftVersion: string,
    project: string,
    versionId: string,
    opts: Partial<{
      loader: LoaderName;
      api_key: string;
      store_directory: string;
      workers: number;
      retries: number;
    }> = {},
    onEvent?: EventHandler,
  ) {
    return this.request<Record<string, unknown>>(
      `${kind}.set-version`,
      {
        directory,
        minecraft_version: minecraftVersion,
        project,
        version_id: versionId,
        ...opts,
      },
      onEvent,
    );
  }

  /** Exactly one of project/file (contract §4). Idempotent. */
  contentEnable(kind: ContentKind, directory: string, target: { project: string } | { file: string }) {
    return this.request<{ changed: boolean; entry: unknown }>(`${kind}.enable`, {
      directory,
      ...target,
    });
  }

  contentDisable(kind: ContentKind, directory: string, target: { project: string } | { file: string }) {
    return this.request<{ changed: boolean; entry: unknown }>(`${kind}.disable`, {
      directory,
      ...target,
    });
  }

  contentRemove(kind: ContentKind, directory: string, target: { project: string } | { file: string }) {
    return this.request<unknown>(`${kind}.remove`, { directory, ...target });
  }

  contentAdopt(kind: ContentKind, directory: string, storeDirectory?: string) {
    return this.request<Record<string, unknown>>(`${kind}.adopt`, {
      directory,
      store_directory: storeDirectory,
    });
  }

  // --- worlds (saves; same game `directory` as content methods, contract §4) ----
  // Worlds are mutable instance-private state; mutations are crash-safe staging
  // operations and refuse worlds whose session.lock flock is held by a running
  // game (WORLD_LOCKED); stale lock files are tolerated. All are single
  // request/result calls with no progress events.

  worldsList(directory: string, minecraftVersion?: string) {
    return this.request<{ worlds: WorldEntry[] }>("worlds.list", {
      directory,
      minecraft_version: minecraftVersion,
    });
  }

  /** `icon_png_base64` is null when the world has no icon (capped at 64 KiB). */
  worldsGet(directory: string, world: string, minecraftVersion?: string) {
    return this.request<{ world: WorldEntry; icon_png_base64: string | null }>(
      "worlds.get",
      { directory, world, minecraft_version: minecraftVersion },
    );
  }

  /** Renames the directory AND rewrites LevelName inside level.dat atomically. */
  worldsRename(directory: string, world: string, newName: string) {
    return this.request<{ world: WorldEntry }>("worlds.rename", {
      directory,
      world,
      new_name: newName,
    });
  }

  /** Plain recursive copy (no links); LevelName is NOT rewritten. */
  worldsDuplicate(directory: string, world: string, newName: string) {
    return this.request<{ world: WorldEntry }>("worlds.duplicate", {
      directory,
      world,
      new_name: newName,
    });
  }

  /** Permanent; the GUI must confirm first — the core never asks. */
  worldsDelete(directory: string, world: string) {
    return this.request<{ deleted: string }>("worlds.delete", { directory, world });
  }

  /** Writes a standard zip to `file`; returns {file, size_bytes, files}. */
  worldsExport(directory: string, world: string, file: string) {
    return this.request<{ file: string; size_bytes: number; files: number }>(
      "worlds.export",
      { directory, world, file },
    );
  }

  /** Extracts a world zip; WORLD_EXISTS unless replace:true (full swap). */
  worldsImport(directory: string, file: string, opts: { name?: string; replace?: boolean } = {}) {
    return this.request<{ world: WorldEntry }>("worlds.import", {
      directory,
      file,
      ...opts,
    });
  }

  /** Timestamped zip into `<game dir>/backups/`; label sanitized to [A-Za-z0-9._-]. */
  worldsBackup(directory: string, world: string, label?: string) {
    return this.request<{ backup: string }>("worlds.backup", {
      directory,
      world,
      label,
    });
  }

  worldsBackups(directory: string) {
    return this.request<{ backups: WorldBackupEntry[] }>("worlds.backups", { directory });
  }

  /** Import from the backups directory; WORLD_EXISTS unless replace:true. */
  worldsRestore(directory: string, backup: string, opts: { name?: string; replace?: boolean } = {}) {
    return this.request<{ world: WorldEntry }>("worlds.restore", {
      directory,
      backup,
      ...opts,
    });
  }

  worldsBackupsDelete(directory: string, backup: string) {
    return this.request<{ deleted: string }>("worlds.backups.delete", {
      directory,
      backup,
    });
  }

  // --- modpacks & store ----------------------------------------------------------

  modpackInstall(
    directory: string,
    id: string,
    file: string,
    opts: Partial<{
      api_key: string;
      store_directory: string;
      workers: number;
      retries: number;
    }> = {},
    onEvent?: EventHandler,
  ) {
    return this.request<ModpackInstallResult>(
      "modpack.install",
      { directory, id, file, ...opts },
      onEvent,
    );
  }

  storeGc(
    opts: Partial<{
      store_directory: string;
      dry_run: boolean;
      min_age_seconds: number;
    }> = {},
  ) {
    return this.request<Record<string, unknown>>("store.gc", { ...opts });
  }

  // --- Microsoft / Minecraft auth (secrets are caller-supplied, contract §5) ------

  authDeviceBegin(clientId: string, locale?: string) {
    return this.request<DeviceBeginResult>("auth.microsoft.device.begin", {
      client_id: clientId,
      locale,
    });
  }

  authDevicePoll(clientId: string, deviceCode: string) {
    return this.request<DevicePollResult>("auth.microsoft.device.poll", {
      client_id: clientId,
      device_code: deviceCode,
    });
  }

  authMinecraftExchange(clientId: string, accessToken: string) {
    return this.request<MinecraftExchangeResult>("auth.minecraft.exchange", {
      client_id: clientId,
      access_token: accessToken,
    });
  }

  /**
   * Refresh + exchange in one step. The rotated `refresh_token` in the
   * result MUST be persisted atomically before the session is used — even
   * when `state` is "exchange_failed" (contract §6).
   */
  authMinecraftRefreshExchange(clientId: string, refreshToken: string) {
    return this.request<RefreshExchangeResult>("auth.minecraft.refresh_exchange", {
      client_id: clientId,
      refresh_token: refreshToken,
    });
  }

  // --- account metadata (no tokens; contract §6) -----------------------------------
  // The account registry lives in the CWD-relative `accounts` directory
  // (contract §6.5: single directory name, no separators); the middleware
  // spawns core with the app-data dir as CWD, so the default resolves there.

  accountSave(profile: AccountProfile) {
    return this.request<unknown>("account.microsoft.save", {
      account: profile,
    });
  }

  accountList() {
    return this.request<{ accounts: AccountProfile[] }>("account.microsoft.list");
  }

  accountGet(id: string) {
    return this.request<AccountProfile>("account.microsoft.get", { id });
  }

  accountDelete(id: string) {
    return this.request<unknown>("account.microsoft.delete", { id });
  }
}
