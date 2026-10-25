import type {
  AccountProfile,
  ContentKind,
  ContentEntry,
  InstanceManifest,
  ManagedJavaRuntime,
  WorldBackupEntry,
  WorldEntry,
} from "./types";
import {
  createEmptyServerStatusCache,
  type ServerStatusCacheV1,
} from "./serverStatusCache";
import {
  createServerMockState,
  dispatchServerMockRequest,
  replaceServerMockLog,
  rotateServerMockLog,
  type ServerMockEventHandler,
  type ServerMockScenario,
  type ServerMockState,
} from "./serverMock";
import { instanceMutationKeyFromGameDirectory } from "./instanceCoordinator";
import { isMockTransport } from "./transportMode";
import type { EndpointConfigV1 } from "./endpoints";
import { endpointMockConfig, resetEndpointMock, writeEndpointMockConfig } from "./endpointMock";

type MockEventHandler = (event: {
  kind: "event" | "diagnostic";
  data: Record<string, unknown> | string;
}) => void;
type MockContentEntry = {
  file: string;
  source: {
    project_id?: string;
    version_id?: string;
    slug?: string;
    provider: string;
  };
  enabled: boolean;
  [field: string]: unknown;
};
export type MockScenario = ServerMockScenario;

export interface MockFixture {
  instances: InstanceManifest[];
  instanceRoots: Record<string, InstanceManifest[]>;
  contents: Record<
    string,
    Record<ContentKind, { entries: MockContentEntry[]; unmanaged: string[] }>
  >;
  worlds: Record<string, WorldEntry[]>;
  datapacks: Record<string, Record<string, { entries: ContentEntry[]; unmanaged: string[] }>>;
  datapackArchives: Record<string, string[]>;
  backups: Record<string, WorldBackupEntry[]>;
  accounts: AccountProfile[];
  runtimes: ManagedJavaRuntime[];
  credentials: Map<string, string>;
}

const delay = (ms = 18) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const b64 = (value: string) => btoa(value);

function defaultInstances(): InstanceManifest[] {
  return [
    {
      id: "vanilla-1214",
      name: "Vanilla 1.21.4",
      version_id: "1.21.4",
      fabric_loader: null,
      neoforge_version: null,
      forge_version: null,
      source: "official",
      installed: true,
    },
    {
      id: "fabric-sodium",
      name: "Fabric · Sodium",
      version_id: "1.21.1",
      fabric_loader: "0.16.10",
      neoforge_version: null,
      forge_version: null,
      source: "bmclapi",
      installed: true,
    },
    {
      id: "neoforge-lab",
      name: "NeoForge Lab",
      version_id: "1.21.1",
      fabric_loader: null,
      neoforge_version: "21.1.173",
      forge_version: null,
      source: "official",
      installed: false,
    },
    {
      id: "forge-legacy",
      name: "Forge Legacy",
      version_id: "1.20.1",
      fabric_loader: null,
      neoforge_version: null,
      forge_version: "47.3.0",
      source: "official",
      installed: true,
    },
    {
      id: "broken-worlds",
      name: "Worlds · fixture states",
      version_id: "1.20.4",
      fabric_loader: null,
      neoforge_version: null,
      forge_version: null,
      source: "official",
      installed: true,
    },
  ];
}

function defaultContents(): MockFixture["contents"] {
  return {
    "vanilla-1214": {
      mods: {
        entries: [
          {
            kind: "mods",
            file: "mods/sodium-fabric.jar",
            sha1: "a".repeat(40),
            size: 1234567,
            source: {
              provider: "modrinth",
              project_id: "AANobbMI",
              version_id: "mock-sodium",
              slug: "Sodium",
            },
            enabled: true,
            as_dependency: false,
          },
        ],
        unmanaged: [],
      },
      resourcepacks: { entries: [], unmanaged: ["resourcepacks/old-pack.zip"] },
      shaderpacks: {
        entries: [
          {
            kind: "shaderpacks",
            file: "shaderpacks/Complementary.zip",
            sha1: "b".repeat(40),
            size: 543210,
            source: { provider: "manual", slug: "Complementary" },
            enabled: false,
            as_dependency: false,
          },
        ],
        unmanaged: [],
      },
    },
  };
}

function defaultWorlds(): MockFixture["worlds"] {
  return {
    "vanilla-1214": [
      {
        name: "Survival",
        level_name: "Survival",
        version_name: "1.21.4",
        version_id: 3955,
        game_mode: "survival",
        hardcore: false,
        cheats: false,
        difficulty: 2,
        last_played_ms: 1760000000000,
        size_bytes: 245760,
        has_icon: true,
        locked: false,
        version_relation: "same",
      },
      {
        name: "Locked Server World",
        level_name: "Locked Server World",
        version_name: "1.21.1",
        version_id: 3950,
        game_mode: "survival",
        hardcore: false,
        cheats: true,
        difficulty: 1,
        last_played_ms: 1750000000000,
        size_bytes: 1048576,
        has_icon: false,
        locked: true,
        version_relation: "different",
      },
    ],
    "broken-worlds": [
      {
        name: "CorruptSave",
        level_name: null,
        version_name: null,
        version_id: null,
        game_mode: null,
        hardcore: null,
        cheats: null,
        difficulty: null,
        last_played_ms: null,
        size_bytes: 4096,
        has_icon: false,
        locked: false,
        version_relation: "unknown",
      },
    ],
  };
}

function defaultFixture(): MockFixture {
  return {
    instances: defaultInstances(),
    instanceRoots: {},
    contents: defaultContents(),
    worlds: defaultWorlds(),
    datapacks: {},
    datapackArchives: {},
    backups: {
      "vanilla-1214": [
        {
          file: "Survival-20260920-120000.zip",
          world: "Survival",
          created_ms: 1760000000000,
          size_bytes: 200000,
        },
      ],
    },
    accounts: [
      {
        id: "mock-player-uuid",
        player_name: "MockSteve",
        client_id: "mock-client-id",
        xuid: "123456789",
      },
    ],
    runtimes: [
      {
        name: "zulu-21-arm64",
        provider: "zulu",
        id: "zulu-21",
        platform: "linux-arm64",
        major_version: 21,
        java_home: "/mock/java/21",
        executable: "/mock/java/21/bin/java",
        version: "21.0.7",
        vendor: "Azul",
      },
    ],
    credentials: new Map(),
  };
}

function readScenario(): MockScenario {
  const globals = globalThis as typeof globalThis & { location?: Location };
  const query = globals.location?.search
    ? new URLSearchParams(globals.location.search).get("jmclMockScenario")
    : null;
  const configured = query ?? import.meta.env?.VITE_JMCL_MOCK_SCENARIO;
  return configured === "empty" || configured === "errors"
    ? configured
    : "default";
}

export function createMockFixture(scenario: MockScenario): MockFixture {
  const nextFixture = defaultFixture();
  if (scenario === "empty") {
    nextFixture.instances = [];
    nextFixture.contents = {};
    nextFixture.worlds = {};
    nextFixture.backups = {};
    nextFixture.accounts = [];
    nextFixture.runtimes = [];
  }
  nextFixture.credentials.clear();
  return nextFixture;
}

export function initializeMockFixture(
  scenario: MockScenario = readScenario(),
): { scenario: MockScenario; fixture: MockFixture } {
  return { scenario, fixture: createMockFixture(scenario) };
}

const initialState = initializeMockFixture();
let activeScenario: MockScenario = initialState.scenario;
let fixture: MockFixture = initialState.fixture;
let serverMockState: ServerMockState = createServerMockState(activeScenario);
let mockServerStatusCache = createEmptyServerStatusCache();

export function resetMockFixture(
  scenario: MockScenario = readScenario(),
): void {
  const nextState = initializeMockFixture(scenario);
  activeScenario = nextState.scenario;
  fixture = nextState.fixture;
  serverMockState = createServerMockState(activeScenario);
  mockServerStatusCache = createEmptyServerStatusCache();
  resetEndpointMock(scenario);
}

export function mockScenario(): MockScenario {
  return activeScenario;
}

function instanceId(directory: string): string {
  const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) === ".minecraft"
    ? (parts.at(-2) ?? "")
    : (parts.at(-1) ?? "");
}

function entryFor(id: string, kind: ContentKind) {
  const byKind =
    fixture.contents[id] ??
    (fixture.contents[id] = {
      mods: { entries: [], unmanaged: [] },
      resourcepacks: { entries: [], unmanaged: [] },
      shaderpacks: { entries: [], unmanaged: [] },
    });
  return byKind[kind];
}

function datapacksFor(scope: string, world: string, instance: string) {
  const byWorld = fixture.datapacks[scope] ??= {};
  return byWorld[world] ??= instance === "vanilla-1214" && world === "Survival"
    ? { entries: [{ kind: "datapack", file: "datapacks/terralith.zip", sha1: "d".repeat(40), size: 8192,
      source: { provider: "modrinth", project_id: "terralith", slug: "terralith", version_id: "mock-v1" },
      enabled: true, as_dependency: false }], unmanaged: ["datapacks/local-pack.zip"] }
    : { entries: [], unmanaged: [] };
}

function archivedDatapacks(store: { entries: ContentEntry[]; unmanaged: string[] }): string[] {
  return [...store.unmanaged, ...store.entries.map((entry) => entry.enabled ? entry.file : `${entry.file}.disabled`)];
}

function installedDatapack(entry: ContentEntry) {
  return { file: entry.file, sha1: entry.sha1, size: entry.size, slug: entry.source.slug ?? null, as_dependency: entry.as_dependency };
}

function worldEntry(name: string): WorldEntry {
  return {
    name,
    level_name: name,
    version_name: "1.21.4",
    version_id: 3955,
    game_mode: "survival",
    hardcore: false,
    cheats: false,
    difficulty: 2,
    last_played_ms: Date.now(),
    size_bytes: 8192,
    has_icon: false,
    locked: false,
    version_relation: "same",
  };
}

function emit(
  handler: MockEventHandler | undefined,
  data: Record<string, unknown>,
): void {
  handler?.({ kind: "event", data });
}

function scenarioError(): never {
  throw {
    kind: "rpc",
    code: "MOCK_SCENARIO_ERROR",
    message: "Mock errors scenario: deterministic list failure",
  };
}

function rpcFailure(code: string, message: string): never {
  throw { kind: "rpc", code, message };
}

function requireWorld(instance: string, name: string): WorldEntry {
  const world = (fixture.worlds[instance] ?? []).find((item) => item.name === name);
  if (!world) rpcFailure("WORLD_NOT_FOUND", "Mock world not found");
  return world;
}

function requireMutableWorld(instance: string, name: string): WorldEntry {
  const world = requireWorld(instance, name);
  if (world.locked) rpcFailure("WORLD_LOCKED", "Mock world is locked by a running game");
  return world;
}

function replaceWorld(instance: string, name: string, replace: boolean): WorldEntry {
  const list = fixture.worlds[instance] ?? (fixture.worlds[instance] = []);
  const index = list.findIndex((world) => world.name === name);
  if (index >= 0) {
    if (list[index].locked)
      rpcFailure("WORLD_LOCKED", "Mock world is locked by a running game");
    if (!replace) rpcFailure("WORLD_EXISTS", "Mock world already exists");
    list.splice(index, 1);
  }
  const world = worldEntry(name);
  list.push(world);
  return world;
}

export async function mockRequest<T>(
  method: string,
  params: Record<string, unknown>,
  handler?: MockEventHandler,
): Promise<T> {
  await delay();
  if (
    activeScenario === "errors" &&
    (method === "core.version" || method === "instance.list")
  )
    scenarioError();

  if (method.startsWith("server.")) {
    return dispatchServerMockRequest<T>(
      serverMockState,
      method,
      params,
      handler as ServerMockEventHandler | undefined,
    );
  }

  const id = typeof params.id === "string" ? params.id : "";
  const directory = String(params.directory ?? "");
  const instance = instanceId(directory);
  const worldScope = instanceMutationKeyFromGameDirectory(directory);
  const rootScope = method.startsWith("install.") || method.startsWith("launch.")
    ? worldScope.slice(0, worldScope.lastIndexOf("/")) : worldScope;
  const instances = fixture.instanceRoots[rootScope] ??= structuredClone(fixture.instances);
  if (method.startsWith("worlds.") || method.startsWith("datapacks.")) {
    fixture.worlds[worldScope] ??= structuredClone(fixture.worlds[instance] ?? []);
    fixture.backups[worldScope] ??= structuredClone(fixture.backups[instance] ?? []);
  }
  if (method === "core.version")
    return { name: "jmcl-core", version: "0.1.0-mock", protocol: 1 } as T;
  if (method === "ping") return { pong: true } as T;
  if (method === "version.list")
    return {
      latest: { release: "1.21.4", snapshot: "25w38a" },
      versions: ["1.21.4", "1.21.1", "1.20.4", "1.20.1", "bad-version"].map(
        (version) => ({ id: version, type: "release" }),
      ),
    } as T;
  if (method === "version.resolve") {
    if (id === "bad-version")
      throw {
        kind: "rpc",
        code: "METADATA_TIMEOUT",
        message: "Mock metadata timeout",
      };
    return {
      kind: params.fabric_loader
        ? "fabric"
        : params.neoforge_version
          ? "neoforge"
          : params.forge_version
            ? "forge"
            : "vanilla",
      id,
      java_major_version: 21,
    } as T;
  }
  if (method === "instance.list")
    return {
      instances: structuredClone(instances).sort((a, b) => a.id.localeCompare(b.id)),
    } as T;
  if (method === "instance.get") {
    const found = instances.find((item) => item.id === id);
    if (!found)
      throw {
        kind: "rpc",
        code: "INSTANCE_NOT_FOUND",
        message: "Mock instance not found",
      };
    return structuredClone(found) as T;
  }
  if (method === "instance.create") {
    if (instances.some((item) => item.id === id))
      throw {
        kind: "rpc",
        code: "INSTANCE_EXISTS",
        message: "Mock instance already exists",
      };
    const created: InstanceManifest = {
      id,
      name: String(params.name ?? id),
      version_id: String(params.version_id),
      fabric_loader:
        typeof params.fabric_loader === "string" ? params.fabric_loader : null,
      neoforge_version:
        typeof params.neoforge_version === "string"
          ? params.neoforge_version
          : null,
      forge_version:
        typeof params.forge_version === "string" ? params.forge_version : null,
      source: params.source === "bmclapi" ? "bmclapi" : "official",
      installed: false,
    };
    instances.push(created);
    return structuredClone(created) as T;
  }
  if (method === "instance.delete") {
    const index = instances.findIndex((item) => item.id === id);
    if (index < 0)
      throw {
        kind: "rpc",
        code: "INSTANCE_NOT_FOUND",
        message: "Mock instance not found",
      };
    instances.splice(index, 1);
    delete fixture.contents[id];
    const deletedScope = instanceMutationKeyFromGameDirectory(`${directory}/${id}/.minecraft`);
    fixture.worlds[deletedScope] = [];
    fixture.backups[deletedScope] = [];
    delete fixture.datapacks[deletedScope];
    return null as T;
  }
  if (method === "install.execute") {
    emit(handler, {
      event: "started",
      source: "official",
      started: {
        stage: "download",
        version_id: id,
        files_total: 4,
        bytes_total: 4000,
      },
    });
    emit(handler, {
      event: "progress",
      source: "official",
      progress: {
        files_completed: 2,
        files_total: 4,
        bytes_processed: 2200,
        bytes_verified: 2000,
        bytes_transferred: 2200,
        bytes_total: 4000,
      },
    });
    const manifest = instances.find((item) => item.id === instance);
    if (manifest) manifest.installed = true;
    return { files_installed: 4, files_skipped: 0 } as T;
  }
  if (method === "install.prepare")
    return { native_directory: `${String(params.directory)}/natives` } as T;
  if (method === "modpack.install") {
    if (!directory || !id || id.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id) || !params.file)
      rpcFailure("INVALID_PARAMS", "Mock modpack requires directory, valid id and file");
    if (instances.some((item) => item.id === id))
      rpcFailure("INSTANCE_EXISTS", "Mock instance already exists");
    const file = String(params.file);
    // Explicit synthetic archive names only: no filesystem or download work.
    if (/curseforge|manifest/i.test(file) && params.__curseforge_authorized !== true)
      rpcFailure("INVALID_PARAMS", "CurseForge import requires synthetic credential presence");
    if (!/\.(mrpack|zip)$/i.test(file))
      rpcFailure("UNKNOWN_MODPACK_FORMAT", "Mock archive is not a recognized modpack");
    if (/unsafe/i.test(file)) rpcFailure("UNSAFE_MODPACK", "Mock archive contains unsafe paths");
    if (/missing/i.test(file)) rpcFailure("MODPACK_NOT_FOUND", "Mock archive not found");
    const loader = /fabric/i.test(file) ? { name: "fabric" as const, version: "0.16.10" } : null;
    const created: InstanceManifest = {
      id, name: `${file.toLowerCase().endsWith(".zip") ? "Synthetic CurseForge Pack" : "Synthetic Modrinth Pack"} 1.0.0`, version_id: "1.21.4", fabric_loader: loader?.version ?? null,
      neoforge_version: null, forge_version: null, source: "official", installed: false,
    };
    instances.push(created);
    emit(handler, { event: "started", source: "official", started: { stage: "download", version_id: created.version_id, files_total: 4, bytes_total: 4000 } });
    emit(handler, { event: "progress", source: "official", progress: { files_completed: 4, files_total: 4, bytes_processed: 4000, bytes_verified: 4000, bytes_transferred: 4000, bytes_total: 4000 } });
    return {
      stage: "modpack.install", id, name: created.name, version_id: created.version_id,
      loader, files_installed: 4, files_skipped: 0, overrides_written: 1,
    } as T;
  }
  if (method === "launch.plan") {
    if (!id || !directory || typeof params.natives_directory !== "string" || !params.natives_directory) rpcFailure("INVALID_PARAMS", "Missing launch plan paths");
    // Deliberately synthetic: never echo authentication or arbitrary input argv.
    return { version_id: id, required_java: 21, runtime: { executable: "/mock/java" },
      java_source: "local", forced: !!params.java_override,
      launch: { java_executable: "/mock/java", working_directory: directory,
        redacted_argv: ["/mock/java", "<mock launch plan>", "<redacted>"], sensitive_argv_indices: [2] } } as T;
  }
  if (method === "launch.execute") {
    handler?.({
      kind: "diagnostic",
      data: "[mock core] launch session connected",
    });
    // launch forwards managed-runtime installer events in the same direct
    // stage/progress wire shape as java.runtime.install.
    emit(handler, { event: "stage", stage: "download" });
    emit(handler, {
      event: "progress",
      progress: {
        files_completed: 1,
        files_total: 2,
        bytes_processed: 1024,
        bytes_total: 2048,
      },
    });
    emit(handler, {
      event: "started",
      started: { pid: 4242, argv: ["java", "-jar", "minecraft"] },
    });
    emit(handler, {
      event: "stdout",
      stdout: {
        sequence: 1,
        encoding: "base64",
        end: "more",
        data: b64("[mock] starting\n"),
      },
    });
    emit(handler, {
      event: "stderr",
      stderr: {
        sequence: 2,
        encoding: "base64",
        end: "more",
        data: b64("[mock] warning"),
      },
    });
    emit(handler, {
      event: "stdout",
      stdout: {
        sequence: 3,
        encoding: "base64",
        end: "newline",
        data: b64("[mock] ready\n"),
      },
    });
    return {
      process: {
        termination: "exited",
        exit_code: 0,
        signal: null,
        duration_ms: 250,
        max_rss_bytes: 1000000,
      },
    } as T;
  }
  if (
    /^(mods|resourcepacks|shaderpacks)\.(list|enable|disable|remove|adopt|install|set-version)$/.test(
      method,
    )
  ) {
    const kind = method.split(".")[0] as ContentKind;
    const operation = method.split(".")[1];
    const store = entryFor(instance, kind);
    if (operation === "list")
      return { entries: store.entries, unmanaged: store.unmanaged } as T;
    if (operation === "enable" || operation === "disable") {
      const target = String(params.project ?? params.file);
      const item = store.entries.find(
        (entry) => entry.file === target || entry.source?.project_id === target,
      );
      if (item) item.enabled = operation === "enable";
      return { changed: Boolean(item), entry: item ?? null } as T;
    }
    if (operation === "remove") {
      const target = String(params.project ?? params.file);
      store.entries = store.entries.filter(
        (entry) => entry.file !== target && entry.source?.project_id !== target,
      );
      return null as T;
    }
    if (operation === "adopt") {
      store.unmanaged = [];
      return { adopted: true } as T;
    }
    const project = String(params.project ?? "mock-project");
    const file = `${kind}/${project}.jar`;
    const existing = store.entries.find(
      (entry) => entry.source?.project_id === project,
    );
    if (existing)
      existing.source.version_id = String(params.version_id ?? "mock-version");
    else
      store.entries.push({
        kind,
        file,
        sha1: "c".repeat(40),
        size: 650000,
        source: {
          provider: params.provider === "curseforge" ? "curseforge" : "modrinth",
          project_id: project,
          version_id: String(params.version_id ?? "mock-version"),
          slug: project,
        },
        enabled: true,
        as_dependency: false,
      });
    return { installed: true } as T;
  }
  if (method.startsWith("datapacks.")) {
    const operation = method.slice("datapacks.".length);
    const world = String(params.world ?? "");
    if (!directory || !world || /[\\/\0]/.test(world) || world === "." || world === "..")
      rpcFailure("INVALID_PARAMS", "Mock datapacks require a valid directory and world");
    requireWorld(worldScope, world);
    if (operation !== "list") requireMutableWorld(worldScope, world);
    const store = datapacksFor(worldScope, world, instance);
    const base = { stage: method, world };
    if (operation === "list") return structuredClone({ ...base, ...store }) as T;
    if (operation === "adopt") {
      const adopted: ReturnType<typeof installedDatapack>[] = [];
      for (const file of store.unmanaged.filter((name) => /\.zip(?:\.disabled)?$/i.test(name))) {
        const entry: ContentEntry = { kind: "datapack", file: file.replace(/\.disabled$/, ""), sha1: "e".repeat(40), size: 4096,
          source: { provider: "manual" }, enabled: !file.endsWith(".disabled"), as_dependency: false };
        store.entries.push(entry);
        adopted.push(installedDatapack(entry));
      }
      store.unmanaged = store.unmanaged.filter((name) => !/\.zip(?:\.disabled)?$/i.test(name));
      return { ...base, adopted } as T;
    }
    if (["enable", "disable", "remove"].includes(operation)) {
      if ((typeof params.project === "string") === (typeof params.file === "string"))
        rpcFailure("INVALID_PARAMS", "Exactly one selector is required");
      const entry = store.entries.find((item) => params.file !== undefined ? item.file === params.file : item.source.project_id === params.project || item.source.slug === params.project);
      if (!entry) rpcFailure("CONTENT_NOT_FOUND", "No matching registered datapack");
      if (operation === "remove") {
        store.entries = store.entries.filter((item) => item !== entry);
        return structuredClone({ ...base, removed: entry }) as T;
      }
      const enabled = operation === "enable";
      const changed = entry.enabled !== enabled;
      entry.enabled = enabled;
      return structuredClone({ ...base, changed, entry }) as T;
    }
    if (operation !== "install" && operation !== "set-version") rpcFailure("METHOD_NOT_FOUND", "Unknown datapack method");
    if (!params.minecraft_version || !params.project || params.loader != null ||
        (operation === "set-version" && !params.version_id))
      rpcFailure("INVALID_PARAMS", "Datapack version operations require Minecraft version and project, without loader");
    if ((params.provider === "curseforge" && params.__curseforge_authorized !== true) || params.api_key != null)
      rpcFailure("INVALID_PARAMS", "CurseForge credentials are unavailable in this mock");
    const project = String(params.project);
    if (!/^[a-zA-Z0-9_-]+$/.test(project)) rpcFailure("INVALID_PARAMS", "Invalid project identifier");
    if (params.version_id === "incompatible") rpcFailure("INCOMPATIBLE_VERSION", "Synthetic incompatible version");
    const existing = store.entries.find((entry) => entry.source.project_id === project || entry.source.slug === project);
    if (operation === "set-version" && !existing) rpcFailure("CONTENT_NOT_FOUND", "No registered datapack project");
    const version = String(params.version_id ?? "mock-v2");
    const oldVersion = existing?.source.version_id ?? "";
    if (existing) {
      existing.source.version_id = version;
      if (operation === "set-version") return { ...base, changed: oldVersion !== version, file: existing.file, sha1: existing.sha1,
        size: existing.size, old_version_id: oldVersion, new_version_id: version } as T;
      return { ...base, installed: [], skipped: 1 } as T;
    }
    const entry: ContentEntry = { kind: "datapack", file: `datapacks/${project}.zip`, sha1: "f".repeat(40), size: 8192,
      source: { provider: params.provider === "curseforge" ? "curseforge" : "modrinth", project_id: project, slug: project, version_id: version }, enabled: true, as_dependency: false };
    store.entries.push(entry);
    emit(handler, { event: "progress", source: "official", progress: { files_completed: 1, files_total: 1, bytes_processed: 8192, bytes_verified: 8192, bytes_transferred: 8192, bytes_total: 8192 } });
    return { ...base, installed: [installedDatapack(entry)], skipped: 0 } as T;
  }
  if (method === "worlds.list")
    return { worlds: fixture.worlds[worldScope] ?? [] } as T;
  if (method === "worlds.get") {
    const found = requireWorld(worldScope, String(params.world));
    return {
      world: found,
      icon_png_base64: found?.has_icon ? "" : null,
    } as T;
  }
  if (method === "worlds.backups")
    return { backups: fixture.backups[worldScope] ?? [] } as T;
  if (method === "worlds.rename") {
    const old = requireMutableWorld(worldScope, String(params.world));
    const name = String(params.new_name);
    if (
      name !== old.name &&
      (fixture.worlds[worldScope] ?? []).some((world) => world.name === name)
    )
      rpcFailure("WORLD_EXISTS", "Mock world already exists");
    const packs = datapacksFor(worldScope, old.name, instance);
    const oldName = old.name;
    fixture.datapacks[worldScope][name] = packs;
    if (oldName !== name) delete fixture.datapacks[worldScope][oldName];
    old.name = name;
    old.level_name = name;
    return { world: old } as T;
  }
  if (method === "worlds.duplicate") {
    requireMutableWorld(worldScope, String(params.world));
    const source = datapacksFor(worldScope, String(params.world), instance);
    const world = replaceWorld(worldScope, String(params.new_name), false);
    fixture.datapacks[worldScope][world.name] = structuredClone(source);
    return { world } as T;
  }
  if (method === "worlds.import") {
    const world = replaceWorld(worldScope, String(params.name ?? "Imported World"), params.replace === true);
    (fixture.datapacks[worldScope] ??= {})[world.name] = {
      entries: [], unmanaged: [...(fixture.datapackArchives[String(params.file)] ?? [])],
    };
    return { world } as T;
  }
  if (method === "worlds.restore") {
    const backup = (fixture.backups[worldScope] ?? []).find(
      (item) => item.file === params.backup,
    );
    if (!backup) rpcFailure("BACKUP_NOT_FOUND", "Mock backup not found");
    const world = replaceWorld(worldScope, String(params.name ?? backup.world), params.replace === true);
    (fixture.datapacks[worldScope] ??= {})[world.name] = {
      entries: [], unmanaged: [...(fixture.datapackArchives[`${worldScope}/${backup.file}`] ?? [])],
    };
    return { world } as T;
  }
  if (method === "worlds.delete") {
    const world = requireMutableWorld(worldScope, String(params.world));
    fixture.worlds[worldScope] = (fixture.worlds[worldScope] ?? []).filter(
      (item) => item !== world,
    );
    delete fixture.datapacks[worldScope]?.[String(params.world)];
    return { deleted: String(params.world) } as T;
  }
  if (method === "worlds.export") {
    requireMutableWorld(worldScope, String(params.world));
    fixture.datapackArchives[String(params.file)] = archivedDatapacks(datapacksFor(worldScope, String(params.world), instance));
    return { file: String(params.file), size_bytes: 8192, files: 3 } as T;
  }
  if (method === "worlds.backup") {
    requireMutableWorld(worldScope, String(params.world));
    const file = `${String(params.world)}-mock.zip`;
    fixture.datapackArchives[`${worldScope}/${file}`] = archivedDatapacks(datapacksFor(worldScope, String(params.world), instance));
    (fixture.backups[worldScope] ??= []).unshift({
      file,
      world: String(params.world),
      created_ms: Date.now(),
      size_bytes: 8192,
    });
    return { backup: file } as T;
  }
  if (method === "worlds.backups.delete") {
    const existing = (fixture.backups[worldScope] ?? []).some(
      (backup) => backup.file === params.backup,
    );
    if (!existing) rpcFailure("BACKUP_NOT_FOUND", "Mock backup not found");
    fixture.backups[worldScope] = (fixture.backups[worldScope] ?? []).filter(
      (backup) => backup.file !== params.backup,
    );
    delete fixture.datapackArchives[`${worldScope}/${String(params.backup)}`];
    return { deleted: String(params.backup) } as T;
  }
  if (method === "java.detect")
    return {
      runtimes: [
        {
          executable: "/usr/lib/jvm/java-21/bin/java",
          major_version: 21,
          version: "21.0.8",
          vendor: "Mock OpenJDK",
          architecture: "arm64",
        },
      ],
      probe_failures: [],
    } as T;
  if (method === "java.runtime.list")
    return { runtimes: [...fixture.runtimes] } as T;
  if (method === "java.runtime.install") {
    const major = typeof params.major === "number" ? params.major : 21;
    const name = `mock-java-${String(params.major ?? params.component ?? "custom")}`;
    const runtime: ManagedJavaRuntime = {
      name,
      provider: "zulu",
      id: String(params.component ?? `zulu-${major}`),
      platform: String(params.platform ?? "linux-arm64"),
      major_version: major,
      java_home: `/mock/java/${major}`,
      executable: `/mock/java/${major}/bin/java`,
      version: `${major}.0.0`,
      vendor: "Mock Azul",
    };
    fixture.runtimes = fixture.runtimes.filter((item) => item.name !== name);
    fixture.runtimes.push(runtime);
    return runtime as T;
  }
  if (method === "java.runtime.remove") {
    const runtime = String(params.runtime);
    const before = fixture.runtimes.length;
    fixture.runtimes = fixture.runtimes.filter((item) => item.name !== runtime);
    return {
      removed: runtime,
      changed: before !== fixture.runtimes.length,
    } as T;
  }
  if (method === "account.microsoft.list")
    return { stage: "account_list", accounts: [...fixture.accounts] } as T;
  if (method === "account.microsoft.get") {
    const account = fixture.accounts.find((item) => item.id === id);
    if (!account)
      throw {
        kind: "rpc",
        code: "ACCOUNT_NOT_FOUND",
        message: "Mock account not found",
      };
    return { stage: "account_get", account: { ...account } } as T;
  }
  if (method === "account.microsoft.save") {
    const value = params.account;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !["id", "player_name", "client_id"].every(key => typeof (value as Record<string, unknown>)[key] === "string"))
      throw { kind: "rpc", code: "INVALID_PARAMS", message: "Account metadata parameters are invalid" };
    const input = value as AccountProfile;
    const account: AccountProfile = { schema_version: input.schema_version ?? 1, id: input.id, player_name: input.player_name, client_id: input.client_id, xuid: input.xuid ?? null };
    const index = fixture.accounts.findIndex((item) => item.id === account.id);
    if (index < 0) fixture.accounts.push({ ...account });
    else fixture.accounts[index] = { ...account };
    return { stage: "save", account: { ...account } } as T;
  }
  if (method === "account.microsoft.delete") {
    fixture.accounts = fixture.accounts.filter((account) => account.id !== id);
    return { stage: "account_delete", id, deleted: true } as T;
  }
  if (method === "auth.microsoft.device.begin")
    return {
      device_code: "mock-private-device-code",
      user_code: "MOCK-123",
      verification_uri:
        "https://login.microsoftonline.com/common/oauth2/deviceauth",
      expires_in: 30,
      interval: 0,
    } as T;
  if (method === "auth.microsoft.device.poll")
    return {
      state: "authenticated",
      credential: {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
      },
    } as T;
  if (method === "auth.minecraft.exchange")
    return {
      session: {
        player_name: "MockSteve",
        uuid: "mock-player-uuid",
        access_token: "mock-access-token",
        xuid: "123456789",
      },
    } as T;
  if (method === "auth.minecraft.refresh_exchange")
    return {
      state: "authenticated",
      refresh_token: "mock-refresh-token-rotated",
      session: {
        player_name: "MockSteve",
        uuid: "mock-player-uuid",
        access_token: "mock-access-token",
        xuid: "123456789",
      },
    } as T;
  if (method === "store.gc") {
    const dryRun = params.dry_run === undefined ? true : params.dry_run, age = params.min_age_seconds === undefined ? 86400 : params.min_age_seconds;
    const store = params.store_directory === undefined ? "/mock/store" : params.store_directory;
    if (typeof store !== "string" || !store.trim() || typeof dryRun !== "boolean" || typeof age !== "number" || !Number.isSafeInteger(age) || age < 0) rpcFailure("INVALID_PARAMS", "Invalid synthetic GC parameters");
    return { dry_run: dryRun, min_age_seconds: age, summary: {
      objects_scanned: 8, objects_eligible: 2, objects_deleted: dryRun ? 0 : 2,
      bytes_eligible: 2048, bytes_deleted: dryRun ? 0 : 2048,
      objects_linked: 3, objects_young: 1, objects_ignored: 1, objects_busy: 1, errors: 0,
    } } as T;
  }
  throw {
    kind: "rpc",
    code: "METHOD_NOT_FOUND",
    message: `Mock method not implemented: ${method}`,
  };
}

export function mockCredentialSet(
  accountId: string,
  refreshToken: string,
): void {
  fixture.credentials.set(accountId, refreshToken);
}
export function mockCredentialGet(accountId: string): string | null {
  return fixture.credentials.get(accountId) ?? null;
}
export function mockCredentialDelete(accountId: string): void {
  fixture.credentials.delete(accountId);
}

/** Test seam for exercising log rotation without inventing a console command. */
export function rotateMockServerLog(
  directory: string,
  id: string,
  text?: string,
): void {
  rotateServerMockLog(serverMockState, directory, id, text);
}

export function replaceMockServerLog(
  directory: string,
  id: string,
  text: string,
): void {
  replaceServerMockLog(serverMockState, directory, id, text);
}

function cloneServerStatusCache(cache: ServerStatusCacheV1): ServerStatusCacheV1 {
  return structuredClone(cache);
}

export function mockServerStatusCacheRead(): ServerStatusCacheV1 {
  return cloneServerStatusCache(mockServerStatusCache);
}

export function mockServerStatusCacheWrite(cache: ServerStatusCacheV1): void {
  mockServerStatusCache = cloneServerStatusCache(cache);
}

/** Mock-only reset hook; real native persistence has no mutable browser state. */
export function resetMockServerStatusCache(): void {
  if (!isMockTransport()) return;
  mockServerStatusCache = createEmptyServerStatusCache();
}

export function mockEndpointConfigRead(): EndpointConfigV1 { return endpointMockConfig(); }

export function mockEndpointConfigWrite(config: EndpointConfigV1): void {
  writeEndpointMockConfig(config);
}

export function resetMockEndpointConfig(): void {
  if (!isMockTransport()) return;
  resetEndpointMock("default");
}

export const mockFixtureSummary = {
  scenarios: ["default", "empty", "errors"] as const,
  accounts: "offline + Microsoft fixture",
  logs: "stdout + stderr + core diagnostics",
};
