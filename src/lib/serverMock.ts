import type {
  JavaRuntime,
  ServerBackupEntry,
  ServerContentAdoptResult,
  ServerContentEntry,
  ServerContentInstallResult,
  ServerContentSetVersionResult,
  ServerContentToggleResult,
  ServerErrorCode,
  ServerInstallResult,
  ServerLifecycleStartResult,
  ServerLogResult,
  ServerManifest,
  ServerProperties,
  ServerStatus,
  ServerWorldEntry,
} from "./types";

export type ServerMockScenario = "default" | "empty" | "errors";

export type ServerMockEventHandler = (event: {
  kind: "event" | "diagnostic";
  data: Record<string, unknown> | string;
}) => void;

interface ServerMockLog {
  file_id: number;
  bytes: Uint8Array;
}

export interface ServerMockServer {
  directory: string;
  manifest: ServerManifest;
  running: boolean;
  pid: number | null;
  supervisor_pid: number | null;
  java_path: string | null;
  started_at_ms: number | null;
  stale_status_once: boolean;
  properties: ServerProperties | null;
  /** Deliberately stores only whether a password exists, never its value. */
  rcon_password_configured: boolean;
  log: ServerMockLog | null;
  worlds: ServerWorldEntry[];
  backups: ServerBackupEntry[];
  /** Private mock payload metadata; not serialized in ServerBackupEntry results. */
  backup_world_sets: Record<string, string[]>;
  mods: { entries: ServerContentEntry[]; unmanaged: string[] };
  datapacks: { entries: ServerContentEntry[]; unmanaged: string[] };
}

export interface ServerMockState {
  servers: Record<string, ServerMockServer>;
  next_pid: number;
  next_file_id: number;
  next_started_at_ms: number;
  next_backup_number: number;
  clock_ms: number;
}

export const SERVER_MOCK_METHODS = [
  "server.create",
  "server.list",
  "server.get",
  "server.delete",
  "server.install",
  "server.start",
  "server.stop",
  "server.restart",
  "server.status",
  "server.logs",
  "server.command",
  "server.rcon.command",
  "server.query",
  "server.properties.get",
  "server.properties.set",
  "server.worlds.list",
  "server.worlds.get",
  "server.worlds.rename",
  "server.worlds.delete",
  "server.worlds.backup",
  "server.worlds.backups",
  "server.worlds.restore",
  "server.worlds.backups.delete",
  "server.mods.list",
  "server.mods.install",
  "server.mods.set-version",
  "server.mods.enable",
  "server.mods.disable",
  "server.mods.remove",
  "server.mods.adopt",
  "server.datapacks.list",
  "server.datapacks.install",
  "server.datapacks.set-version",
  "server.datapacks.enable",
  "server.datapacks.disable",
  "server.datapacks.remove",
  "server.datapacks.adopt",
] as const;

const BASE_TIME = 1_789_740_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const copy = <T>(value: T): T => structuredClone(value);
const keyOf = (directory: string, id: string) => `${directory}\0${id}`;
const reservedServerStems = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

function failure(code: ServerErrorCode | "METHOD_NOT_FOUND", message: string): never {
  throw { kind: "rpc", code, message };
}

function requiredText(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0) {
    failure("INVALID_PARAMS", `${name} is required`);
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateUtf8Text(
  value: unknown,
  name: string,
  minBytes: number,
  maxBytes: number,
  forbidden: string,
): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) {
    failure("INVALID_PARAMS", `${name} must be a well-formed string`);
  }
  const byteLength = encoder.encode(value).length;
  if (byteLength < minBytes || byteLength > maxBytes) {
    failure("INVALID_PARAMS", `${name} must be ${minBytes}..${maxBytes} UTF-8 bytes`);
  }
  if ([...forbidden].some((character) => value.includes(character))) {
    failure("INVALID_PARAMS", `${name} contains a forbidden character`);
  }
  return value;
}

function validateServerId(value: unknown): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) {
    failure("INVALID_PARAMS", "id must be a valid server id");
  }
  const bytes = encoder.encode(value);
  if (bytes.length < 1 || bytes.length > 64) {
    failure("INVALID_PARAMS", "id must be 1..64 UTF-8 bytes");
  }
  const isLowerAsciiAlphaNumeric = (byte: number) =>
    (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39);
  if (!isLowerAsciiAlphaNumeric(bytes[0])) {
    failure("INVALID_PARAMS", "id must start with a lowercase ASCII letter or digit");
  }
  for (const byte of bytes.slice(1)) {
    if (!isLowerAsciiAlphaNumeric(byte) && byte !== 0x2e && byte !== 0x5f && byte !== 0x2d) {
      failure("INVALID_PARAMS", "id contains an invalid character");
    }
  }
  if (bytes.at(-1) === 0x2e) failure("INVALID_PARAMS", "id may not end with a dot");
  const stem = value.split(".", 1)[0];
  if (reservedServerStems.has(stem)) failure("INVALID_PARAMS", "id uses a reserved stem");
  return value;
}

function optionalText(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    failure("INVALID_PARAMS", `${name} must be a non-empty string when supplied`);
  }
  return value;
}

function optionalStringArray(params: Record<string, unknown>, name: string): string[] | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    failure("INVALID_PARAMS", `${name} must be an array of non-empty strings when supplied`);
  }
  return value;
}

function optionalIntegerRange(
  params: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    failure("INVALID_PARAMS", `${name} must be an integer in the range ${min}..${max}`);
  }
  return value;
}

function optionalBoolean(params: Record<string, unknown>, name: string): boolean | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") failure("INVALID_PARAMS", `${name} must be a boolean when supplied`);
  return value;
}

function optionalProvider(params: Record<string, unknown>): "modrinth" | "curseforge" | undefined {
  const value = params.provider;
  if (value === undefined) return undefined;
  if (value !== "modrinth" && value !== "curseforge") {
    failure("INVALID_PARAMS", "provider must be modrinth or curseforge when supplied");
  }
  return value;
}

function validateServerIdentity(params: Record<string, unknown>): { directory: string; id: string } {
  return { directory: requiredText(params, "directory"), id: validateServerId(params.id) };
}

function makeWorld(name: string, lastPlayed = 1_760_000_000_000): ServerWorldEntry {
  return {
    name,
    level_name: name,
    version_name: "1.21.4",
    version_id: 3955,
    game_mode: "survival",
    hardcore: false,
    cheats: false,
    difficulty: 2,
    last_played_ms: lastPlayed,
    size_bytes: 245760,
    has_icon: false,
    locked: false,
    version_relation: "same",
  };
}

function makeContent(
  kind: "mod" | "datapack",
  project: string,
  file: string,
  version = "mock-version",
): ServerContentEntry {
  return {
    kind,
    file,
    sha1: kind === "mod" ? "m".repeat(40) : "d".repeat(40),
    size: kind === "mod" ? 650000 : 128000,
    source: {
      provider: "modrinth",
      project_id: project,
      version_id: version,
      slug: project,
    },
    enabled: true,
    as_dependency: false,
  };
}

function makeServer(
  directory: string,
  id: string,
  options: Partial<ServerMockServer> & {
    version_id?: string;
    name?: string;
    fabric_loader?: string | null;
    neoforge_version?: string | null;
    forge_version?: string | null;
    installed?: boolean;
    accept_eula?: boolean;
  } = {},
): ServerMockServer {
  const installed = options.installed ?? false;
  const properties = options.properties === undefined
    ? installed
      ? {
          "level-name": "world",
          motd: "A Mock Minecraft Server",
          "max-players": "20",
          "enable-rcon": "false",
          "enable-query": "false",
          "server-port": "25565",
        }
      : null
    : options.properties;
  return {
    directory,
    manifest: {
      id,
      name: options.name ?? id,
      version_id: options.version_id ?? "1.21.4",
      fabric_loader: options.fabric_loader ?? null,
      neoforge_version: options.neoforge_version ?? null,
      forge_version: options.forge_version ?? null,
      source: options.manifest?.source ?? "official",
      accept_eula: options.accept_eula ?? false,
      java_path: options.manifest?.java_path ?? null,
      installed,
    },
    running: options.running ?? false,
    pid: options.pid ?? null,
    supervisor_pid: options.supervisor_pid ?? null,
    java_path: options.java_path ?? null,
    started_at_ms: options.started_at_ms ?? null,
    stale_status_once: options.stale_status_once ?? false,
    properties,
    rcon_password_configured: options.rcon_password_configured ?? false,
    log: options.log ?? null,
    worlds: options.worlds ?? [],
    backups: options.backups ?? [],
    backup_world_sets: options.backup_world_sets ?? {},
    mods: options.mods ?? { entries: [], unmanaged: [] },
    datapacks: options.datapacks ?? { entries: [], unmanaged: [] },
  };
}

function defaultState(directory: string): ServerMockState {
  const state: ServerMockState = {
    servers: {},
    next_pid: 4400,
    next_file_id: 9000,
    next_started_at_ms: BASE_TIME + 3_600_000,
    next_backup_number: 2,
    clock_ms: BASE_TIME + 3_660_000,
  };

  const fabric = makeServer(directory, "fabric-lab", {
    name: "Fabric Lab",
    version_id: "1.21.1",
    fabric_loader: "0.16.10",
  });
  const vanilla = makeServer(directory, "vanilla-server", {
    name: "Vanilla Server",
    accept_eula: true,
    installed: true,
    worlds: [makeWorld("world")],
    mods: {
      entries: [{
        ...makeContent("mod", "manual", "mods/manual.jar"),
        source: { provider: "manual", slug: "manual" },
      }],
      unmanaged: ["mods/unmanaged.jar"],
    },
  });
  const survival = makeServer(directory, "survival", {
    name: "Survival",
    accept_eula: true,
    installed: true,
    fabric_loader: "0.16.10",
    worlds: [makeWorld("world"), makeWorld("world_nether"), makeWorld("world_the_end")],
    backups: [{
      file: "world-20260920-120000.zip",
      world: "world",
      created_ms: 1_760_000_000_000,
      size_bytes: 2_000_000,
    }],
    backup_world_sets: {
      "world-20260920-120000.zip": ["world", "world_nether", "world_the_end"],
    },
    mods: {
      entries: [{
        ...makeContent("mod", "sodium-project-id", "mods/sodium.jar", "sodium-v1"),
        source: {
          provider: "modrinth",
          project_id: "sodium-project-id",
          version_id: "sodium-v1",
          slug: "sodium",
        },
      }],
      unmanaged: ["mods/manual.jar"],
    },
    datapacks: {
      entries: [makeContent("datapack", "terralith", "datapacks/terralith.zip", "terra-v1")],
      unmanaged: ["datapacks/local.zip"],
    },
  });
  const running = makeServer(directory, "running-demo", {
    name: "Running Demo",
    accept_eula: true,
    installed: true,
    running: true,
    pid: 4301,
    supervisor_pid: 4300,
    java_path: "/mock/java/21/bin/java",
    started_at_ms: BASE_TIME,
    log: { file_id: 9001, bytes: encoder.encode("[Server thread/INFO]: Done\n") },
    worlds: [makeWorld("world", 1_760_000_100_000)],
  });
  const stale = makeServer(directory, "stale-demo", {
    name: "Stale Demo",
    accept_eula: true,
    installed: true,
    stale_status_once: true,
    worlds: [makeWorld("world", 1_760_000_200_000)],
  });
  const incompatible = makeServer(directory, "java-incompatible", {
    name: "Java Incompatible",
    version_id: "1.21.4",
  });

  for (const server of [fabric, incompatible, running, stale, survival, vanilla]) {
    state.servers[keyOf(directory, server.manifest.id)] = server;
  }
  return state;
}

export function createServerMockState(
  scenario: ServerMockScenario = "default",
  directory = "/mock/jmcl/servers",
): ServerMockState {
  if (scenario === "empty") {
    return {
      servers: {},
      next_pid: 4400,
      next_file_id: 9000,
      next_started_at_ms: BASE_TIME + 3_600_000,
      next_backup_number: 1,
      clock_ms: BASE_TIME,
    };
  }
  return defaultState(directory);
}

function serverFor(
  state: ServerMockState,
  params: Record<string, unknown>,
): ServerMockServer {
  const { directory, id } = validateServerIdentity(params);
  const server = state.servers[keyOf(directory, id)];
  if (!server) failure("SERVER_NOT_FOUND", "No mock server matches the given id");
  return server;
}

function stopped(server: ServerMockServer): void {
  if (server.running) failure("SERVER_ALREADY_RUNNING", "Stop the mock server before changing it");
}

function installed(server: ServerMockServer): void {
  if (!server.manifest.installed) failure("SERVER_NOT_INSTALLED", "The mock server is not installed");
}

function manifestResult(stage: "server.create" | "server.get", server: ServerMockServer) {
  return { stage, ...copy(server.manifest) };
}

function serverList(state: ServerMockState, params: Record<string, unknown>) {
  const directory = requiredText(params, "directory");
  return {
    stage: "server.list" as const,
    servers: Object.values(state.servers)
      .filter((server) => server.directory === directory)
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
      .map((server) => copy(server.manifest)),
  };
}

function serverCreate(state: ServerMockState, params: Record<string, unknown>) {
  const directory = requiredText(params, "directory");
  const id = validateServerId(params.id);
  const version = requiredText(params, "version_id");
  if (state.servers[keyOf(directory, id)]) failure("SERVER_EXISTS", "A mock server with this id already exists");
  const name = optionalText(params, "name");
  const source = params.source === undefined ? "official" : params.source;
  if (source !== "official" && source !== "bmclapi") failure("INVALID_PARAMS", "source is invalid");
  if (params.accept_eula !== undefined && typeof params.accept_eula !== "boolean") {
    failure("INVALID_PARAMS", "accept_eula must be a boolean when supplied");
  }
  const loaderKeys = ["fabric_loader", "neoforge_version", "forge_version"]
    .filter((key) => params[key] !== undefined);
  for (const key of loaderKeys) optionalText(params, key);
  if (loaderKeys.length > 1) failure("INVALID_PARAMS", "server.create accepts one loader field");
  const server = makeServer(directory, id, {
    name: name ?? id,
    version_id: version,
    fabric_loader: params.fabric_loader === undefined ? null : params.fabric_loader as string,
    neoforge_version: params.neoforge_version === undefined ? null : params.neoforge_version as string,
    forge_version: params.forge_version === undefined ? null : params.forge_version as string,
    accept_eula: params.accept_eula === true,
    manifest: {
      source,
      java_path: params.java_path === undefined ? null : optionalText(params, "java_path") ?? null,
    } as ServerManifest,
  });
  state.servers[keyOf(directory, id)] = server;
  return manifestResult("server.create", server);
}

function javaRuntime(server: ServerMockServer): JavaRuntime {
  return {
    executable: server.manifest.java_path ?? "/mock/java/21/bin/java",
    major_version: 21,
    version: "21.0.7",
    vendor: "Mock Azul",
    architecture: "arm64",
  };
}

function emit(handler: ServerMockEventHandler | undefined, data: Record<string, unknown>): void {
  handler?.({ kind: "event", data });
}

function serverInstall(
  state: ServerMockState,
  params: Record<string, unknown>,
  handler?: ServerMockEventHandler,
): ServerInstallResult {
  if (params.accept_eula !== true && typeof params.accept_eula !== "boolean") {
    failure("INVALID_PARAMS", "accept_eula must be a boolean");
  }
  optionalText(params, "store_directory");
  optionalIntegerRange(params, "workers", 1, 32);
  optionalIntegerRange(params, "retries", 0, 5);
  optionalStringArray(params, "java_paths");
  const server = serverFor(state, params);
  if (params.accept_eula !== true) failure("EULA_NOT_ACCEPTED", "The Mojang EULA must be accepted explicitly");
  if (server.running) failure("SERVER_ALREADY_RUNNING", "Stop the mock server before installing");
  if (server.manifest.id === "java-incompatible") failure("JAVA_INCOMPATIBLE", "No mock Java runtime matches the server requirement");
  const source = server.manifest.source;
  emit(handler, {
    event: "started",
    source,
    started: { stage: "download", version_id: server.manifest.version_id, files_total: 4, bytes_total: 4000 },
  });
  emit(handler, {
    event: "progress",
    source,
    progress: {
      files_completed: 4,
      files_total: 4,
      bytes_verified: 4000,
      bytes_total: 4000,
      bytes_processed: 4000,
      bytes_transferred: 4000,
    },
  });
  server.manifest.accept_eula = true;
  server.manifest.installed = true;
  const propertiesCreated = server.properties === null;
  server.properties ??= {
    "level-name": "world",
    motd: "A Mock Minecraft Server",
    "max-players": "20",
    "enable-rcon": "false",
    "enable-query": "false",
    "server-port": "25565",
  };
  return {
    stage: "server.install",
    id: server.manifest.id,
    version_id: server.manifest.version_id,
    source,
    java: javaRuntime(server),
    properties_created: propertiesCreated,
    files_total: 4,
    files_downloaded: 4,
    files_cached: 0,
    files_hard_linked: 0,
    files_copied: 0,
    bytes_verified: 4000,
    bytes_transferred: 4000,
  };
}

function startResult(state: ServerMockState, server: ServerMockServer, stage: "server.start" | "server.restart"): ServerLifecycleStartResult {
  installed(server);
  if (server.running) failure("SERVER_ALREADY_RUNNING", "The mock server is already running");
  const pid = state.next_pid++;
  const supervisorPid = state.next_pid++;
  const startedAt = state.next_started_at_ms;
  state.next_started_at_ms += 60_000;
  state.clock_ms = startedAt + 60_000;
  server.running = true;
  server.pid = pid;
  server.supervisor_pid = supervisorPid;
  server.java_path = server.manifest.java_path ?? "/mock/java/21/bin/java";
  server.started_at_ms = startedAt;
  if (!server.log) {
    server.log = { file_id: state.next_file_id++, bytes: encoder.encode("[Server thread/INFO]: Done\n") };
  } else {
    appendLog(server, "[Mock] server started\n");
  }
  return {
    stage,
    id: server.manifest.id,
    running: true,
    pid,
    supervisor_pid: supervisorPid,
    started_at_ms: startedAt,
    java_path: server.java_path,
  };
}

function appendLog(server: ServerMockServer, text: string): void {
  if (!server.log) return;
  const addition = encoder.encode(text);
  const bytes = new Uint8Array(server.log.bytes.length + addition.length);
  bytes.set(server.log.bytes);
  bytes.set(addition, server.log.bytes.length);
  server.log.bytes = bytes;
}

function serverStart(state: ServerMockState, params: Record<string, unknown>) {
  optionalStringArray(params, "java_paths");
  return startResult(state, serverFor(state, params), "server.start");
}

function serverStop(state: ServerMockState, params: Record<string, unknown>) {
  optionalIntegerRange(params, "grace_ms", 0, 120000);
  const server = serverFor(state, params);
  if (!server.running) failure("SERVER_NOT_RUNNING", "The mock server is not running");
  const pid = server.pid;
  server.running = false;
  server.pid = null;
  server.supervisor_pid = null;
  server.java_path = null;
  server.started_at_ms = null;
  if (server.log) appendLog(server, "[Mock] server stopped\n");
  return { stage: "server.stop" as const, id: server.manifest.id, running: false as const, termination: "graceful" as const, pid };
}

function serverRestart(state: ServerMockState, params: Record<string, unknown>) {
  optionalStringArray(params, "java_paths");
  optionalIntegerRange(params, "grace_ms", 0, 120000);
  const server = serverFor(state, params);
  if (!server.running) failure("SERVER_NOT_RUNNING", "The mock server is not running");
  if (server.log) appendLog(server, "[Mock] server restarting\n");
  server.running = false;
  server.pid = null;
  server.supervisor_pid = null;
  server.java_path = null;
  server.started_at_ms = null;
  return startResult(state, server, "server.restart");
}

function serverStatus(state: ServerMockState, params: Record<string, unknown>): ServerStatus {
  const server = serverFor(state, params);
  const stale = server.stale_status_once;
  if (stale) server.stale_status_once = false;
  const running = stale ? false : server.running;
  return {
    stage: "server.status",
    id: server.manifest.id,
    running,
    stale_state: stale,
    pid: running ? server.pid : null,
    supervisor_pid: running ? server.supervisor_pid : null,
    java_path: running ? server.java_path : null,
    started_at_ms: running ? server.started_at_ms : null,
    uptime_ms: running && server.started_at_ms !== null ? state.clock_ms - server.started_at_ms : null,
  };
}

function validMaxBytes(params: Record<string, unknown>): number {
  const value = params.max_bytes === undefined ? 65536 : params.max_bytes;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 1_048_576) {
    failure("INVALID_PARAMS", "max_bytes is out of range");
  }
  return value;
}

function validRconMaxBytes(params: Record<string, unknown>): number {
  const value = params.max_bytes === undefined ? 262144 : params.max_bytes;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 262144) {
    failure("INVALID_PARAMS", "max_bytes is out of range");
  }
  return value;
}

function validUtf8End(bytes: Uint8Array, start: number, limit: number): number {
  let end = Math.min(bytes.length, start + limit);
  while (end >= start) {
    try {
      decoder.decode(bytes.subarray(start, end));
      return end;
    } catch {
      end -= 1;
    }
  }
  return start;
}

function tailStart(bytes: Uint8Array, maxBytes: number): number {
  let start = Math.max(0, bytes.length - maxBytes);
  while (start < bytes.length) {
    try {
      decoder.decode(bytes.subarray(start));
      return start;
    } catch {
      start += 1;
    }
  }
  return bytes.length;
}

function isUtf8Boundary(bytes: Uint8Array, cursor: number): boolean {
  try {
    decoder.decode(bytes.subarray(0, cursor));
    decoder.decode(bytes.subarray(cursor));
    return true;
  } catch {
    return false;
  }
}

function readLog(server: ServerMockServer, params: Record<string, unknown>): ServerLogResult {
  if (!server.log) failure("SERVER_LOGS_NOT_FOUND", "No mock server console log exists");
  const maxBytes = validMaxBytes(params);
  const hasCursor = params.cursor !== undefined;
  const hasFileId = params.file_id !== undefined;
  if (hasCursor !== hasFileId) failure("INVALID_PARAMS", "cursor and file_id must be supplied together");
  const log = server.log;
  let start: number;
  let reset = false;
  let truncated = false;
  if (!hasCursor) {
    start = tailStart(log.bytes, maxBytes);
    truncated = start > 0;
  } else if (params.file_id !== log.file_id || typeof params.cursor !== "number" || !Number.isInteger(params.cursor) || params.cursor < 0 || params.cursor > log.bytes.length || !isUtf8Boundary(log.bytes, params.cursor)) {
    reset = true;
    start = tailStart(log.bytes, maxBytes);
    truncated = start > 0;
  } else {
    start = params.cursor;
  }
  const end = validUtf8End(log.bytes, start, maxBytes);
  return {
    stage: "server.logs",
    id: server.manifest.id,
    text: decoder.decode(log.bytes.subarray(start, end)),
    file_id: log.file_id,
    start_cursor: start,
    next_cursor: end,
    eof: end === log.bytes.length,
    reset,
    truncated,
  };
}

export function rotateServerMockLog(
  state: ServerMockState,
  directory: string,
  id: string,
  text = "[Mock] rotated log\n",
): void {
  const identity = validateServerIdentity({ directory, id });
  const server = state.servers[keyOf(identity.directory, identity.id)];
  if (!server) failure("SERVER_NOT_FOUND", "No mock server matches the given id");
  server.log = { file_id: state.next_file_id++, bytes: encoder.encode(text) };
}

/** Test seam for replacing a server log, including with an empty byte stream. */
export function replaceServerMockLog(
  state: ServerMockState,
  directory: string,
  id: string,
  text: string,
): void {
  const identity = validateServerIdentity({ directory, id });
  const server = state.servers[keyOf(identity.directory, identity.id)];
  if (!server) failure("SERVER_NOT_FOUND", "No mock server matches the given id");
  server.log = { file_id: state.next_file_id++, bytes: encoder.encode(text) };
}

function serverCommand(state: ServerMockState, params: Record<string, unknown>) {
  const command = validateUtf8Text(params.command, "command", 1, 4095, "\0\r\n");
  const server = serverFor(state, params);
  if (!server.running) failure("SERVER_NOT_RUNNING", "The mock server is not running");
  appendLog(server, `[Mock console] ${command}\n`);
  return { stage: "server.command" as const, id: server.manifest.id, accepted: true as const, pid: server.pid! };
}

function serverRcon(state: ServerMockState, params: Record<string, unknown>) {
  validateUtf8Text(params.password, "password", 1, 4095, "\0");
  validateUtf8Text(params.command, "command", 1, 4095, "\0");
  validRconMaxBytes(params);
  const server = serverFor(state, params);
  if (!server.running) failure("SERVER_NOT_RUNNING", "The mock server is not running");
  failure("SERVER_RCON_DISABLED", "RCON is disabled for this mock server");
}

function serverQuery(state: ServerMockState, params: Record<string, unknown>) {
  const mode = params.mode === undefined ? "full" : params.mode;
  if (mode !== "basic" && mode !== "full") failure("INVALID_PARAMS", "mode is invalid");
  const server = serverFor(state, params);
  if (!server.running) failure("SERVER_NOT_RUNNING", "The mock server is not running");
  failure("SERVER_QUERY_DISABLED", "Query is disabled for this mock server");
}

function returnedProperties(server: ServerMockServer): ServerProperties {
  if (!server.properties) failure("SERVER_PROPERTIES_NOT_FOUND", "server.properties has not been created");
  const properties = { ...server.properties };
  if (server.rcon_password_configured) properties["rcon.password"] = "<redacted>";
  return properties;
}

function serverPropertiesGet(state: ServerMockState, params: Record<string, unknown>) {
  const server = serverFor(state, params);
  return { stage: "server.properties.get" as const, id: server.manifest.id, properties: returnedProperties(server) };
}

function validatePropertiesMerge(
  current: ServerProperties,
  passwordWasConfigured: boolean,
  input: unknown,
): { next: ServerProperties; passwordConfigured: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) {
    failure("INVALID_PARAMS", "properties must be a non-empty object");
  }
  const next = { ...current };
  let passwordConfigured = passwordWasConfigured;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    validateUtf8Text(key, "property key", 1, 256, "\0\r\n");
    if (typeof value !== "string") failure("INVALID_PARAMS", "server property values must be strings");
    const propertyValue = validateUtf8Text(value, "property value", 0, 65536, "\0");
    if (key === "rcon.password") passwordConfigured = true;
    else next[key] = propertyValue;
  }
  const resultingKeys = new Set(Object.keys(next));
  if (passwordConfigured) resultingKeys.add("rcon.password");
  if (resultingKeys.size > 1024) failure("INVALID_PARAMS", "server properties may contain at most 1024 keys");
  return { next, passwordConfigured };
}

function serverPropertiesSet(state: ServerMockState, params: Record<string, unknown>) {
  const server = serverFor(state, params);
  if (!server.properties) failure("SERVER_PROPERTIES_NOT_FOUND", "server.properties has not been created");
  const merge = validatePropertiesMerge(server.properties, server.rcon_password_configured, params.properties);
  stopped(server);
  server.properties = merge.next;
  server.rcon_password_configured = merge.passwordConfigured;
  return { stage: "server.properties.set" as const, id: server.manifest.id, properties: returnedProperties(server) };
}

function requireWorld(server: ServerMockServer, name: string): ServerWorldEntry {
  const world = server.worlds.find((item) => item.name === name);
  if (!world) failure("WORLD_NOT_FOUND", "No mock world matches the given name");
  return world;
}

function serverWorldsList(state: ServerMockState, params: Record<string, unknown>) {
  const server = serverFor(state, params);
  optionalText(params, "minecraft_version");
  return { stage: "server.worlds.list" as const, id: server.manifest.id, worlds: copy(server.worlds) };
}

function serverWorldsGet(state: ServerMockState, params: Record<string, unknown>) {
  const name = requiredText(params, "world");
  const server = serverFor(state, params);
  optionalText(params, "minecraft_version");
  const world = requireWorld(server, name);
  return { stage: "server.worlds.get" as const, id: server.manifest.id, world: copy(world), icon_png_base64: null };
}

function requireNewWorld(server: ServerMockServer, name: string): void {
  if (server.worlds.some((world) => world.name === name)) failure("WORLD_EXISTS", "A mock world already has this name");
}

function serverWorldsRename(state: ServerMockState, params: Record<string, unknown>) {
  const oldName = requiredText(params, "world");
  const newName = requiredText(params, "new_name");
  const server = serverFor(state, params);
  stopped(server);
  requireWorld(server, oldName);
  if (oldName === newName) failure("INVALID_PARAMS", "new_name must differ from world");
  requireNewWorld(server, newName);
  const baseName = server.properties?.["level-name"];
  const renamingBase = baseName === oldName;
  const siblingSuffixes = ["_nether", "_the_end"];
  if (renamingBase) {
    for (const suffix of siblingSuffixes) {
      const oldSibling = `${oldName}${suffix}`;
      const newSibling = `${newName}${suffix}`;
      if (server.worlds.some((item) => item.name === oldSibling) && server.worlds.some((item) => item.name === newSibling)) {
        failure("WORLD_EXISTS", "A mock world already has this name");
      }
    }
  }
  for (const item of server.worlds) {
    if (item.name === oldName) {
      item.name = newName;
      item.level_name = newName;
    } else if (renamingBase) {
      for (const suffix of siblingSuffixes) {
        if (item.name === `${oldName}${suffix}`) {
          item.name = `${newName}${suffix}`;
          item.level_name = item.name;
        }
      }
    }
  }
  if (renamingBase && server.properties) server.properties["level-name"] = newName;
  return { stage: "server.worlds.rename" as const, renamed: { old_name: oldName, new_name: newName } };
}

function serverWorldsDelete(state: ServerMockState, params: Record<string, unknown>) {
  const name = requiredText(params, "world");
  const server = serverFor(state, params);
  stopped(server);
  requireWorld(server, name);
  const baseName = server.properties?.["level-name"];
  const deletedNames = baseName === name
    ? new Set([name, `${name}_nether`, `${name}_the_end`])
    : new Set([name]);
  server.worlds = server.worlds.filter((world) => !deletedNames.has(world.name));
  return { stage: "server.worlds.delete" as const, deleted: name };
}

function serverWorldsBackup(state: ServerMockState, params: Record<string, unknown>) {
  const world = params.world === undefined ? null : optionalText(params, "world") ?? null;
  const label = params.label === undefined ? "mock" : optionalText(params, "label");
  if (label !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(label)) {
    failure("INVALID_PARAMS", "label must contain only safe characters and be at most 64 characters");
  }
  const server = serverFor(state, params);
  stopped(server);
  const baseName = server.properties?.["level-name"];
  if (!baseName) failure("SERVER_PROPERTIES_INVALID", "The mock server has no usable level-name");
  if (world) requireWorld(server, world);
  const worldPart = world ?? baseName;
  const file = `${worldPart}-mock-${state.next_backup_number++}-${label || "mock"}.zip`;
  const names = world
    ? [world]
    : [baseName, `${baseName}_nether`, `${baseName}_the_end`].filter((name) => server.worlds.some((item) => item.name === name));
  if (!world && !server.worlds.some((item) => item.name === baseName)) failure("WORLD_NOT_FOUND", "No mock world matches the base level name");
  const backup = { file, world: world ?? baseName, created_ms: state.clock_ms, size_bytes: 8192 };
  server.backups.unshift(backup);
  server.backup_world_sets[file] = names;
  return { stage: "server.worlds.backup" as const, backup: file };
}

function serverWorldsBackups(state: ServerMockState, params: Record<string, unknown>) {
  const server = serverFor(state, params);
  return {
    stage: "server.worlds.backups" as const,
    id: server.manifest.id,
    backups: copy(server.backups).sort((a, b) => b.created_ms - a.created_ms),
  };
}

function serverWorldsRestore(state: ServerMockState, params: Record<string, unknown>) {
  const file = requiredText(params, "backup");
  optionalBoolean(params, "replace");
  const server = serverFor(state, params);
  stopped(server);
  const backup = server.backups.find((item) => item.file === file);
  if (!backup) failure("BACKUP_NOT_FOUND", "No mock backup matches the given file");
  const names = server.backup_world_sets[file] ?? (backup.world ? [backup.world] : ["world"]);
  if (params.replace !== true && names.some((name) => server.worlds.some((world) => world.name === name))) {
    failure("WORLD_EXISTS", "The restored mock world already exists");
  }
  const archivedNames = new Set(names);
  server.worlds = server.worlds.filter((world) => !archivedNames.has(world.name));
  server.worlds.push(...names.map((name) => makeWorld(name, state.clock_ms)));
  return { stage: "server.worlds.restore" as const, restored: file };
}

function serverWorldsBackupDelete(state: ServerMockState, params: Record<string, unknown>) {
  const file = requiredText(params, "backup");
  const server = serverFor(state, params);
  stopped(server);
  if (!server.backups.some((backup) => backup.file === file)) failure("BACKUP_NOT_FOUND", "No mock backup matches the given file");
  server.backups = server.backups.filter((backup) => backup.file !== file);
  return { stage: "server.worlds.backups.delete" as const, deleted: file };
}

type ContentKind = "mods" | "datapacks";
function contentStore(server: ServerMockServer, kind: ContentKind) {
  return server[kind];
}
function contentKind(kind: ContentKind): "mod" | "datapack" {
  return kind === "mods" ? "mod" : "datapack";
}
function contentList(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind) {
  const server = serverFor(state, params);
  const store = contentStore(server, kind);
  return { stage: `server.${kind}.list` as const, id: server.manifest.id, entries: copy(store.entries), unmanaged: [...store.unmanaged] };
}
function requireContentSelector(params: Record<string, unknown>): void {
  const hasProject = params.project !== undefined;
  const hasFile = params.file !== undefined;
  if (hasProject === hasFile) failure("INVALID_PARAMS", "exactly one of project or file is required");
  if (hasProject) requiredText(params, "project");
  if (hasFile) requiredText(params, "file");
}
function contentMutationServer(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind, requireModLoader = false) {
  const server = serverFor(state, params);
  stopped(server);
  if (requireModLoader && kind === "mods" && !server.manifest.fabric_loader && !server.manifest.neoforge_version && !server.manifest.forge_version) {
    failure("SERVER_LOADER_REQUIRED", "A server loader is required for mock mods");
  }
  if (kind === "datapacks") {
    installed(server);
    if (!server.properties?.["level-name"]) failure("SERVER_PROPERTIES_INVALID", "The mock server has no usable level-name");
  }
  return server;
}
function contentTarget(store: { entries: ServerContentEntry[] }, params: Record<string, unknown>): ServerContentEntry {
  const project = params.project !== undefined ? requiredText(params, "project") : null;
  const file = params.file !== undefined ? requiredText(params, "file") : null;
  if ((project === null) === (file === null)) failure("INVALID_PARAMS", "exactly one of project or file is required");
  const entry = store.entries.find((item) => project !== null
    ? (item.source.provider === "modrinth" || item.source.provider === "curseforge") &&
      (item.source.project_id === project || item.source.slug === project)
    : item.file === file);
  if (!entry) failure("CONTENT_NOT_FOUND", "No mock content entry matches the selector");
  return entry;
}
function contentInstall(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind): ServerContentInstallResult {
  const project = requiredText(params, "project");
  const provider = optionalProvider(params);
  const apiKey = optionalText(params, "api_key");
  optionalText(params, "version_id");
  optionalBoolean(params, "with_dependencies");
  optionalText(params, "store_directory");
  optionalIntegerRange(params, "workers", 1, 32);
  optionalIntegerRange(params, "retries", 0, 5);
  const effectiveProvider = provider ?? "modrinth";
  if (effectiveProvider === "curseforge" && apiKey === undefined) {
    failure("INVALID_PARAMS", "curseforge provider requires a non-empty api_key");
  }
  if (effectiveProvider === "modrinth" && apiKey !== undefined) {
    failure("INVALID_PARAMS", "modrinth provider does not accept api_key");
  }
  const server = contentMutationServer(state, params, kind, true);
  const store = contentStore(server, kind);
  const existing = store.entries.find((item) => item.source.project_id === project);
  const version = typeof params.version_id === "string" ? params.version_id : "mock-version";
  const file = kind === "mods" ? `mods/${project}.jar` : `datapacks/${project}.zip`;
  const entry = existing ?? makeContent(contentKind(kind), project, file, version);
  if (existing) entry.source.version_id = version;
  else store.entries.push(entry);
  return {
    stage: `server.${kind}.install` as const,
    id: server.manifest.id,
    installed: [{ file: entry.file, sha1: entry.sha1, size: entry.size, slug: entry.source.slug ?? null, as_dependency: entry.as_dependency }],
    skipped: 0,
  } as ServerContentInstallResult;
}
function contentSetVersion(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind): ServerContentSetVersionResult {
  const project = requiredText(params, "project");
  const newVersion = requiredText(params, "version_id");
  if (Object.prototype.hasOwnProperty.call(params, "file")) {
    failure("INVALID_PARAMS", "set-version accepts project, not file");
  }
  optionalText(params, "api_key");
  optionalText(params, "store_directory");
  optionalIntegerRange(params, "workers", 1, 32);
  optionalIntegerRange(params, "retries", 0, 5);
  const server = contentMutationServer(state, params, kind);
  const store = contentStore(server, kind);
  const entry = contentTarget(store, { ...params, project });
  const oldVersion = entry.source.version_id ?? "";
  entry.source.version_id = newVersion;
  return {
    stage: `server.${kind}.set-version` as const,
    id: server.manifest.id,
    changed: oldVersion !== newVersion,
    file: entry.file,
    sha1: entry.sha1,
    size: entry.size,
    old_version_id: oldVersion,
    new_version_id: newVersion,
  } as ServerContentSetVersionResult;
}
function contentToggle(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind, enabled: boolean): ServerContentToggleResult {
  requireContentSelector(params);
  const server = contentMutationServer(state, params, kind);
  const entry = contentTarget(contentStore(server, kind), params);
  const changed = entry.enabled !== enabled;
  entry.enabled = enabled;
  return { stage: `server.${kind}.${enabled ? "enable" : "disable"}` as const, id: server.manifest.id, changed, entry: copy(entry) } as ServerContentToggleResult;
}
function contentRemove(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind) {
  requireContentSelector(params);
  const server = contentMutationServer(state, params, kind);
  const store = contentStore(server, kind);
  const entry = contentTarget(store, params);
  store.entries = store.entries.filter((item) => item !== entry);
  return { stage: `server.${kind}.remove` as const, id: server.manifest.id, removed: copy(entry) };
}
function contentAdopt(state: ServerMockState, params: Record<string, unknown>, kind: ContentKind): ServerContentAdoptResult {
  optionalText(params, "store_directory");
  const server = contentMutationServer(state, params, kind);
  const store = contentStore(server, kind);
  const adopted: ServerContentAdoptResult["adopted"] = [];
  for (const file of store.unmanaged) {
    const entry = makeContent(contentKind(kind), file.split("/").at(-1)!.replace(/\.(jar|zip)$/, ""), file);
    entry.source = { provider: "manual", slug: entry.source.slug };
    store.entries.push(entry);
    adopted.push({ file: entry.file, sha1: entry.sha1, size: entry.size, slug: entry.source.slug ?? null, as_dependency: false });
  }
  store.unmanaged = [];
  return { stage: `server.${kind}.adopt` as const, id: server.manifest.id, adopted } as ServerContentAdoptResult;
}

function serverDelete(state: ServerMockState, params: Record<string, unknown>) {
  const server = serverFor(state, params);
  if (server.running) failure("SERVER_ALREADY_RUNNING", "Stop the mock server before deleting it");
  delete state.servers[keyOf(server.directory, server.manifest.id)];
  return { stage: "server.delete" as const, id: server.manifest.id, deleted: true as const };
}

export function dispatchServerMockRequest<T>(
  state: ServerMockState,
  method: string,
  params: Record<string, unknown>,
  handler?: ServerMockEventHandler,
): T {
  const handlers: Record<string, () => unknown> = {
    "server.create": () => serverCreate(state, params),
    "server.list": () => serverList(state, params),
    "server.get": () => manifestResult("server.get", serverFor(state, params)),
    "server.delete": () => serverDelete(state, params),
    "server.install": () => serverInstall(state, params, handler),
    "server.start": () => serverStart(state, params),
    "server.stop": () => serverStop(state, params),
    "server.restart": () => serverRestart(state, params),
    "server.status": () => serverStatus(state, params),
    "server.logs": () => readLog(serverFor(state, params), params),
    "server.command": () => serverCommand(state, params),
    "server.rcon.command": () => serverRcon(state, params),
    "server.query": () => serverQuery(state, params),
    "server.properties.get": () => serverPropertiesGet(state, params),
    "server.properties.set": () => serverPropertiesSet(state, params),
    "server.worlds.list": () => serverWorldsList(state, params),
    "server.worlds.get": () => serverWorldsGet(state, params),
    "server.worlds.rename": () => serverWorldsRename(state, params),
    "server.worlds.delete": () => serverWorldsDelete(state, params),
    "server.worlds.backup": () => serverWorldsBackup(state, params),
    "server.worlds.backups": () => serverWorldsBackups(state, params),
    "server.worlds.restore": () => serverWorldsRestore(state, params),
    "server.worlds.backups.delete": () => serverWorldsBackupDelete(state, params),
    "server.mods.list": () => contentList(state, params, "mods"),
    "server.mods.install": () => contentInstall(state, params, "mods"),
    "server.mods.set-version": () => contentSetVersion(state, params, "mods"),
    "server.mods.enable": () => contentToggle(state, params, "mods", true),
    "server.mods.disable": () => contentToggle(state, params, "mods", false),
    "server.mods.remove": () => contentRemove(state, params, "mods"),
    "server.mods.adopt": () => contentAdopt(state, params, "mods"),
    "server.datapacks.list": () => contentList(state, params, "datapacks"),
    "server.datapacks.install": () => contentInstall(state, params, "datapacks"),
    "server.datapacks.set-version": () => contentSetVersion(state, params, "datapacks"),
    "server.datapacks.enable": () => contentToggle(state, params, "datapacks", true),
    "server.datapacks.disable": () => contentToggle(state, params, "datapacks", false),
    "server.datapacks.remove": () => contentRemove(state, params, "datapacks"),
    "server.datapacks.adopt": () => contentAdopt(state, params, "datapacks"),
  };
  const request = handlers[method];
  if (!request) failure("METHOD_NOT_FOUND", `Mock server method not implemented: ${method}`);
  return request() as T;
}
