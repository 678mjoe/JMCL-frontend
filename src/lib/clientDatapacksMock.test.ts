import { beforeEach, expect, test } from "bun:test";
import { mockRequest, resetMockFixture } from "./mockTransport";
import type { ContentEntry } from "./types";

const directory = "/mock/jmcl/instances/vanilla-1214/.minecraft";
const world = "Survival";
const list = (dir = directory, name = world) => mockRequest<{ entries: ContentEntry[]; unmanaged: string[] }>("datapacks.list", { directory: dir, world: name });
const request = (op: string, extra = {}) => mockRequest<any>(`datapacks.${op}`, { directory, world, ...extra });
beforeEach(() => resetMockFixture("default"));

test("world datapack fixtures mutate canonical relative selectors, versions and adoption", async () => {
  const initial = await list();
  expect(initial.entries[0].file).toBe("datapacks/terralith.zip");
  await expect(request("disable", { file: "terralith.zip" })).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
  expect(await request("disable", { file: "datapacks/terralith.zip" })).toMatchObject({ changed: true, entry: { enabled: false } });
  expect(await request("disable", { file: "datapacks/terralith.zip" })).toMatchObject({ changed: false });
  expect(initial.entries[0].enabled).toBe(true); // RPC snapshots cannot mutate fixture state.
  expect(await request("enable", { project: "terralith" })).toMatchObject({ changed: true });
  expect(await request("set-version", { project: "terralith", minecraft_version: "1.21.4", version_id: "mock-v3" })).toMatchObject({ changed: true, old_version_id: "mock-v1", new_version_id: "mock-v3" });
  expect(await request("set-version", { project: "terralith", minecraft_version: "1.21.4", version_id: "mock-v3" })).toMatchObject({ changed: false });
  expect(await request("adopt")).toMatchObject({ adopted: [{ file: "datapacks/local-pack.zip" }] });
  expect((await list()).entries.find(e => e.file.endsWith("local-pack.zip"))?.source.provider).toBe("manual");
  await request("remove", { file: "datapacks/local-pack.zip" });
  expect((await list()).entries).toHaveLength(1);
});

test("requires world and exact version-operation shape; locks only mutation", async () => {
  await expect(request("list", { world: "" })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  await expect(request("list", { world: "missing" })).rejects.toMatchObject({ code: "WORLD_NOT_FOUND" });
  expect(await request("list", { world: "Locked Server World" })).toMatchObject({ entries: [] });
  await expect(request("adopt", { world: "Locked Server World" })).rejects.toMatchObject({ code: "WORLD_LOCKED" });
  await expect(request("install", { project: "new" })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  await expect(request("install", { project: "new", minecraft_version: "1.21.4", loader: "fabric" })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  await expect(request("enable", { project: "terralith", file: "datapacks/terralith.zip" })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  await expect(request("set-version", { project: "terralith", minecraft_version: "1.21.4", version_id: "incompatible" })).rejects.toMatchObject({ code: "INCOMPATIBLE_VERSION" });
});

test("different game roots and worlds do not share mutable datapack or world state", async () => {
  await request("install", { project: "extra", minecraft_version: "1.21.4" });
  const other = "/other/root/vanilla-1214/.minecraft";
  expect((await list(other)).entries).toHaveLength(1);
  await mockRequest("worlds.duplicate", { directory, world, new_name: "Copy" });
  await mockRequest("datapacks.remove", { directory, world: "Copy", project: "extra" });
  expect((await list()).entries).toHaveLength(2);
  await mockRequest("worlds.rename", { directory, world: "Copy", new_name: "Renamed" });
  expect((await list(directory, "Renamed")).entries).toHaveLength(1);
  await expect(list(directory, "Copy")).rejects.toMatchObject({ code: "WORLD_NOT_FOUND" });
  expect((await list(other)).entries).toHaveLength(1);
  await mockRequest("worlds.delete", { directory, world: "Renamed" });
  await expect(list(directory, "Renamed")).rejects.toMatchObject({ code: "WORLD_NOT_FOUND" });
});

test("backup/restore and export/import strip registry then support adopt", async () => {
  const backup = await mockRequest<{ backup: string }>("worlds.backup", { directory, world });
  await request("install", { project: "after-backup", minecraft_version: "1.21.4" });
  await request("remove", { project: "terralith" });
  await mockRequest("worlds.restore", { directory, backup: backup.backup, name: "Restored", replace: false });
  const restored = await list(directory, "Restored");
  expect(restored.entries).toEqual([]);
  expect(restored.unmanaged).toContain("datapacks/terralith.zip");
  expect(restored.unmanaged).not.toContain("datapacks/after-backup.zip");
  await mockRequest("datapacks.adopt", { directory, world: "Restored" });
  expect((await list(directory, "Restored")).entries.every(e => e.source.provider === "manual")).toBe(true);
  await mockRequest("worlds.export", { directory, world, file: "/mock/export.zip" });
  await mockRequest("worlds.import", { directory, name: "Imported", file: "/mock/export.zip" });
  expect((await list(directory, "Imported")).unmanaged).toContain("datapacks/after-backup.zip");
});
