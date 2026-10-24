import { describe, expect, test } from "bun:test";
import { CoreSession, type RequestOptions } from "./rpc";
import { instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";

describe("client world datapack wire contract (Core 97b65186)", () => {
  test("exact world params and canonical file selectors, no server id/loader", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
      calls.push({ method, params }); return {} as T;
    });
    const directory = "/instances/demo/.minecraft", world = "A World";
    await session.datapacksList(directory, world);
    await session.datapacksInstall(directory, world, "1.21.4", "terralith", { version_id: "v1", with_dependencies: true });
    await session.datapacksSetVersion(directory, world, "1.21.4", "terralith", "v2", { workers: 2 });
    await session.datapacksEnable(directory, world, { file: "datapacks/manual.zip" });
    await session.datapacksDisable(directory, world, { project: "terralith" });
    await session.datapacksRemove(directory, world, { file: "datapacks/manual.zip" });
    await session.datapacksAdopt(directory, world, "/store");
    expect(calls).toEqual([
      { method: "datapacks.list", params: { directory, world } },
      { method: "datapacks.install", params: { directory, world, minecraft_version: "1.21.4", project: "terralith", version_id: "v1", with_dependencies: true } },
      { method: "datapacks.set-version", params: { directory, world, minecraft_version: "1.21.4", project: "terralith", version_id: "v2", workers: 2 } },
      { method: "datapacks.enable", params: { directory, world, file: "datapacks/manual.zip" } },
      { method: "datapacks.disable", params: { directory, world, project: "terralith" } },
      { method: "datapacks.remove", params: { directory, world, file: "datapacks/manual.zip" } },
      { method: "datapacks.adopt", params: { directory, world, store_directory: "/store" } },
    ]);
  });
  test("writes conflict with same instance launch across sessions, but reads and another instance work", async () => {
    const release = instanceCoordinator.tryAcquire(instanceMutationKey("/instances", "demo"), "launch");
    const calls: string[] = [];
    const session = CoreSession.createForTesting(async <T>(method: string) => { calls.push(method); return {} as T; });
    try {
      await expect(session.datapacksEnable("/instances/demo/.minecraft", "World", { file: "datapacks/a.zip" })).rejects.toThrow("busy");
      await session.datapacksList("/instances/demo/.minecraft", "World");
      await session.datapacksAdopt("/instances/other/.minecraft", "World");
      expect(calls).toEqual(["datapacks.list", "datapacks.adopt"]);
    } finally { release(); }
  });
});

test("modpack archive uses root/id/file and permits one outer multi-stage lease", async () => {
  const calls: unknown[] = [];
  const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>, _event?: unknown, options?: RequestOptions) => {
    calls.push({ method, params, options }); return {} as T;
  });
  const release = instanceCoordinator.tryAcquire(instanceMutationKey("/instances", "pack"), "install");
  try {
    await expect(session.modpackInstall("/instances", "pack", "/picked/pack.mrpack")).rejects.toThrow("busy");
    await session.modpackInstall("/instances", "pack", "/picked/pack.mrpack", { store_directory: "/store" }, undefined, { coordinate: false });
    expect(calls).toEqual([{ method: "modpack.install", params: { directory: "/instances", id: "pack", file: "/picked/pack.mrpack", store_directory: "/store" }, options: { instanceId: "/instances/pack", mutation: "install", coordinate: false } }]);
  } finally { release(); }
});
