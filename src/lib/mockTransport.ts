import type {
  AccountProfile,
  ContentKind,
  InstanceManifest,
  ManagedJavaRuntime,
  WorldBackupEntry,
  WorldEntry,
} from "./types";
import {
  createEmptyServerStatusCache,
  type ServerStatusCacheV1,
} from "./serverStatusCache";
import { isMockTransport } from "./transportMode";

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
export type MockScenario = "default" | "empty" | "errors";

export interface MockFixture {
  instances: InstanceManifest[];
  contents: Record<
    string,
    Record<ContentKind, { entries: MockContentEntry[]; unmanaged: string[] }>
  >;
  worlds: Record<string, WorldEntry[]>;
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
    contents: defaultContents(),
    worlds: defaultWorlds(),
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
let mockServerStatusCache = createEmptyServerStatusCache();

export function resetMockFixture(
  scenario: MockScenario = readScenario(),
): void {
  const nextState = initializeMockFixture(scenario);
  activeScenario = nextState.scenario;
  fixture = nextState.fixture;
  mockServerStatusCache = createEmptyServerStatusCache();
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

  const id = typeof params.id === "string" ? params.id : "";
  const instance = instanceId(String(params.directory ?? ""));
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
      instances: [...fixture.instances].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    } as T;
  if (method === "instance.get") {
    const found = fixture.instances.find((item) => item.id === id);
    if (!found)
      throw {
        kind: "rpc",
        code: "INSTANCE_NOT_FOUND",
        message: "Mock instance not found",
      };
    return found as T;
  }
  if (method === "instance.create") {
    if (fixture.instances.some((item) => item.id === id))
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
    fixture.instances.push(created);
    return created as T;
  }
  if (method === "instance.delete") {
    const index = fixture.instances.findIndex((item) => item.id === id);
    if (index < 0)
      throw {
        kind: "rpc",
        code: "INSTANCE_NOT_FOUND",
        message: "Mock instance not found",
      };
    fixture.instances.splice(index, 1);
    delete fixture.contents[id];
    delete fixture.worlds[id];
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
    const manifest = fixture.instances.find((item) => item.id === instance);
    if (manifest) manifest.installed = true;
    return { files_installed: 4, files_skipped: 0 } as T;
  }
  if (method === "install.prepare")
    return { native_directory: `${String(params.directory)}/natives` } as T;
  if (method === "modpack.install")
    return {
      id: String(params.id),
      name: String(params.id),
      version_id: "1.21.4",
      loader: null,
      files_installed: 4,
      files_skipped: 0,
      overrides_written: 0,
    } as T;
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
          provider: "modrinth",
          project_id: project,
          version_id: String(params.version_id ?? "mock-version"),
          slug: project,
        },
        enabled: true,
        as_dependency: false,
      });
    return { installed: true } as T;
  }
  if (method === "worlds.list")
    return { worlds: fixture.worlds[instance] ?? [] } as T;
  if (method === "worlds.get") {
    const found = requireWorld(instance, String(params.world));
    return {
      world: found,
      icon_png_base64: found?.has_icon ? "" : null,
    } as T;
  }
  if (method === "worlds.backups")
    return { backups: fixture.backups[instance] ?? [] } as T;
  if (method === "worlds.rename") {
    const old = requireMutableWorld(instance, String(params.world));
    const name = String(params.new_name);
    if (
      name !== old.name &&
      (fixture.worlds[instance] ?? []).some((world) => world.name === name)
    )
      rpcFailure("WORLD_EXISTS", "Mock world already exists");
    old.name = name;
    old.level_name = name;
    return { world: old } as T;
  }
  if (method === "worlds.duplicate") {
    requireMutableWorld(instance, String(params.world));
    return {
      world: replaceWorld(instance, String(params.new_name), false),
    } as T;
  }
  if (method === "worlds.import") {
    return {
      world: replaceWorld(
        instance,
        String(params.name ?? "Imported World"),
        params.replace === true,
      ),
    } as T;
  }
  if (method === "worlds.restore") {
    const backup = (fixture.backups[instance] ?? []).find(
      (item) => item.file === params.backup,
    );
    if (!backup) rpcFailure("BACKUP_NOT_FOUND", "Mock backup not found");
    return {
      world: replaceWorld(
        instance,
        String(params.name ?? backup.world),
        params.replace === true,
      ),
    } as T;
  }
  if (method === "worlds.delete") {
    const world = requireMutableWorld(instance, String(params.world));
    fixture.worlds[instance] = (fixture.worlds[instance] ?? []).filter(
      (item) => item !== world,
    );
    return { deleted: String(params.world) } as T;
  }
  if (method === "worlds.export") {
    requireMutableWorld(instance, String(params.world));
    return { file: String(params.file), size_bytes: 8192, files: 3 } as T;
  }
  if (method === "worlds.backup") {
    requireMutableWorld(instance, String(params.world));
    const file = `${String(params.world)}-mock.zip`;
    (fixture.backups[instance] ??= []).unshift({
      file,
      world: String(params.world),
      created_ms: Date.now(),
      size_bytes: 8192,
    });
    return { backup: file } as T;
  }
  if (method === "worlds.backups.delete") {
    const existing = (fixture.backups[instance] ?? []).some(
      (backup) => backup.file === params.backup,
    );
    if (!existing) rpcFailure("BACKUP_NOT_FOUND", "Mock backup not found");
    fixture.backups[instance] = (fixture.backups[instance] ?? []).filter(
      (backup) => backup.file !== params.backup,
    );
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
    return { accounts: [...fixture.accounts] } as T;
  if (method === "account.microsoft.get") {
    const account = fixture.accounts.find((item) => item.id === id);
    if (!account)
      throw {
        kind: "rpc",
        code: "ACCOUNT_NOT_FOUND",
        message: "Mock account not found",
      };
    return account as T;
  }
  if (method === "account.microsoft.save") {
    const account = params as AccountProfile;
    const index = fixture.accounts.findIndex((item) => item.id === account.id);
    if (index < 0) fixture.accounts.push({ ...account });
    else fixture.accounts[index] = { ...account };
    return null as T;
  }
  if (method === "account.microsoft.delete") {
    fixture.accounts = fixture.accounts.filter((account) => account.id !== id);
    return null as T;
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
  if (method === "store.gc") return { removed: 0 } as T;
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

export const mockFixtureSummary = {
  scenarios: ["default", "empty", "errors"] as const,
  accounts: "offline + Microsoft fixture",
  logs: "stdout + stderr + core diagnostics",
};
