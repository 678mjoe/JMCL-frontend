import { describe, expect, test } from "bun:test";
import { CoreSession } from "./rpc";
import type { MockFixture } from "./mockTransport";
import type {
  ServerManifestResult,
  ServerProperties,
  ServerQueryMode,
  ServerWorldBackupResult,
  ServerWorldRenameResult,
} from "./types";

type CapturedRequest = { method: string; params: Record<string, unknown> };

function captureSession(calls: CapturedRequest[]) {
  return CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return {} as T;
  });
}

describe("server RPC wire shapes", () => {
  test("constructs manifest, lifecycle, logs, command, remote, and properties requests", async () => {
    const calls: CapturedRequest[] = [];
    const session = captureSession(calls);

    await session.serverCreate("/srv/servers", "demo", "1.21.4", {
      name: "Demo",
      fabric_loader: "0.16.10",
      source: "bmclapi",
      accept_eula: true,
      java_path: "/usr/lib/jvm/java-21/bin/java",
    });
    await session.serverInstall("/srv/servers", "demo", {
      accept_eula: true,
      store_directory: "/srv/store",
      workers: 4,
      retries: 1,
      java_paths: ["/usr/bin/java"],
    });
    await session.serverStart("/srv/servers", "demo", { java_paths: ["/usr/bin/java"] });
    await session.serverStop("/srv/servers", "demo", 5000);
    await session.serverRestart("/srv/servers", "demo", { java_paths: ["/usr/bin/java"], grace_ms: 7000 });
    await session.serverStatus("/srv/servers", "demo");
    await session.serverLogs("/srv/servers", "demo", { cursor: 33, file_id: 123, max_bytes: 4096 });
    await session.serverCommand("/srv/servers", "demo", "say hello");
    await session.serverRconCommand("/srv/servers", "demo", "transient-password", "list", 262144);
    await session.serverQuery("/srv/servers", "demo", "basic");
    await session.serverPropertiesGet("/srv/servers", "demo");
    await session.serverPropertiesSet("/srv/servers", "demo", {
      "motd": "Demo",
      "max-players": "20",
      "enable-rcon": "true",
    });

    expect(calls).toEqual([
      {
        method: "server.create",
        params: {
          directory: "/srv/servers",
          id: "demo",
          version_id: "1.21.4",
          name: "Demo",
          fabric_loader: "0.16.10",
          source: "bmclapi",
          accept_eula: true,
          java_path: "/usr/lib/jvm/java-21/bin/java",
        },
      },
      {
        method: "server.install",
        params: {
          directory: "/srv/servers",
          id: "demo",
          accept_eula: true,
          store_directory: "/srv/store",
          workers: 4,
          retries: 1,
          java_paths: ["/usr/bin/java"],
        },
      },
      { method: "server.start", params: { directory: "/srv/servers", id: "demo", java_paths: ["/usr/bin/java"] } },
      { method: "server.stop", params: { directory: "/srv/servers", id: "demo", grace_ms: 5000 } },
      { method: "server.restart", params: { directory: "/srv/servers", id: "demo", java_paths: ["/usr/bin/java"], grace_ms: 7000 } },
      { method: "server.status", params: { directory: "/srv/servers", id: "demo" } },
      { method: "server.logs", params: { directory: "/srv/servers", id: "demo", cursor: 33, file_id: 123, max_bytes: 4096 } },
      { method: "server.command", params: { directory: "/srv/servers", id: "demo", command: "say hello" } },
      { method: "server.rcon.command", params: { directory: "/srv/servers", id: "demo", password: "transient-password", command: "list", max_bytes: 262144 } },
      { method: "server.query", params: { directory: "/srv/servers", id: "demo", mode: "basic" } },
      { method: "server.properties.get", params: { directory: "/srv/servers", id: "demo" } },
      { method: "server.properties.set", params: { directory: "/srv/servers", id: "demo", properties: { motd: "Demo", "max-players": "20", "enable-rcon": "true" } } },
    ]);
    expect(Object.keys(calls[0].params)).not.toContain("undefined");
  });

  test("keeps server world requests at the server-root boundary", async () => {
    const calls: CapturedRequest[] = [];
    const session = captureSession(calls);

    await session.serverWorldsList("/srv/servers", "demo");
    await session.serverWorldsGet("/srv/servers", "demo", "world", "1.21.4");
    await session.serverWorldsRename("/srv/servers", "demo", "world", "survival");
    await session.serverWorldsDelete("/srv/servers", "demo", "survival");
    await session.serverWorldsBackup("/srv/servers", "demo", { world: "survival", label: "before-update" });
    await session.serverWorldsBackups("/srv/servers", "demo");
    await session.serverWorldsRestore("/srv/servers", "demo", "survival-20260920.zip", true);
    await session.serverWorldsBackupsDelete("/srv/servers", "demo", "old.zip");

    expect(calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "server.worlds.list", params: { directory: "/srv/servers", id: "demo" } },
      { method: "server.worlds.get", params: { directory: "/srv/servers", id: "demo", world: "world", minecraft_version: "1.21.4" } },
      { method: "server.worlds.rename", params: { directory: "/srv/servers", id: "demo", world: "world", new_name: "survival" } },
      { method: "server.worlds.delete", params: { directory: "/srv/servers", id: "demo", world: "survival" } },
      { method: "server.worlds.backup", params: { directory: "/srv/servers", id: "demo", world: "survival", label: "before-update" } },
      { method: "server.worlds.backups", params: { directory: "/srv/servers", id: "demo" } },
      { method: "server.worlds.restore", params: { directory: "/srv/servers", id: "demo", backup: "survival-20260920.zip", replace: true } },
      { method: "server.worlds.backups.delete", params: { directory: "/srv/servers", id: "demo", backup: "old.zip" } },
    ]);
  });

  test("uses server content selectors and never sends client version or loader", async () => {
    const calls: CapturedRequest[] = [];
    const session = captureSession(calls);

    await session.serverList("/srv/servers");
    await session.serverGet("/srv/servers", "demo");
    await session.serverDelete("/srv/servers", "demo");
    await session.serverModsList("/srv/servers", "demo");
    await session.serverModsInstall("/srv/servers", "demo", "sodium", {
      provider: "modrinth",
      version_id: "mod-version",
      with_dependencies: false,
      store_directory: "/srv/store",
      workers: 3,
      retries: 2,
    });
    await session.serverModsSetVersion("/srv/servers", "demo", "sodium", "new-version", { workers: 2 });
    await session.serverModsEnable("/srv/servers", "demo", { project: "sodium" });
    await session.serverModsDisable("/srv/servers", "demo", { file: "mods/local.jar" });
    await session.serverModsRemove("/srv/servers", "demo", { project: "sodium" });
    await session.serverModsAdopt("/srv/servers", "demo", "/srv/store");
    await session.serverDatapacksList("/srv/servers", "demo");
    await session.serverDatapacksInstall("/srv/servers", "demo", "terralith", { provider: "curseforge", api_key: "cf-key" });
    await session.serverDatapacksSetVersion("/srv/servers", "demo", "terralith", "pack-version");
    await session.serverDatapacksEnable("/srv/servers", "demo", { project: "terralith" });
    await session.serverDatapacksDisable("/srv/servers", "demo", { file: "datapacks/local.zip" });
    await session.serverDatapacksRemove("/srv/servers", "demo", { project: "terralith" });
    await session.serverDatapacksAdopt("/srv/servers", "demo");

    expect(calls.map((call) => call.method)).toEqual([
      "server.list",
      "server.get",
      "server.delete",
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
    ]);
    for (const call of calls.slice(3)) {
      expect(call.params).not.toHaveProperty("minecraft_version");
      expect(call.params).not.toHaveProperty("loader");
    }
    expect(calls[11].params).toEqual({
      directory: "/srv/servers",
      id: "demo",
      project: "terralith",
      provider: "curseforge",
      api_key: "cf-key",
    });
  });
});

describe("server domain type constraints", () => {
  test("keeps RCON transient and constrains query/properties at compile time", () => {
    const mode: ServerQueryMode = "basic";
    const properties: ServerProperties = { "max-players": "20", hardcore: "false" };
    expect(mode).toBe("basic");
    expect(Object.values(properties).every((value) => typeof value === "string")).toBe(true);
  });

  test("models the serializer's discriminated response shapes", () => {
    const manifest: ServerManifestResult = {
      stage: "server.get",
      id: "demo",
      name: "Demo",
      version_id: "1.21.4",
      fabric_loader: null,
      neoforge_version: null,
      forge_version: null,
      source: "official",
      accept_eula: true,
      java_path: null,
      installed: true,
    };
    const rename: ServerWorldRenameResult = {
      stage: "server.worlds.rename",
      renamed: { old_name: "world", new_name: "survival" },
    };
    const backup: ServerWorldBackupResult = {
      stage: "server.worlds.backup",
      backup: "survival-20260920.zip",
    };

    expect(manifest.stage).toBe("server.get");
    expect(rename.renamed.new_name).toBe("survival");
    expect(backup.backup).toEndWith(".zip");
  });

  // These assertions are intentionally compile-time checks for the public API.
  // @ts-expect-error Query mode is a closed contract union.
  const invalidMode: ServerQueryMode = "players";
  // @ts-expect-error server.properties values must remain strings.
  const invalidProperties: ServerProperties = { "max-players": 20 };
  type MockFixtureMustNotPersistRconPassword = "rcon_password" extends keyof MockFixture ? never : true;
  const fixtureHasNoRconPassword: MockFixtureMustNotPersistRconPassword = true;
  void invalidMode;
  void invalidProperties;
  void fixtureHasNoRconPassword;
});
