import { describe, expect, test } from "bun:test";
import { ClientDatapackController, type ClientDatapackSession } from "./clientDatapacks";
import { compatibleDatapackVersions, datapackSearchUrl, datapackVersionsUrl } from "./clientDatapackCatalog";
import type { ModrinthVersion } from "./modrinth";
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides: Partial<ClientDatapackSession> = {}) {
  const calls: unknown[][] = []; let closes = 0;
  const session = { close: async () => { closes++; }, worldsGet: async () => ({ world: { name: "World A", locked: false } }), datapacksList: async () => ({ stage: "datapacks.list", world: "World A", entries: [], unmanaged: [] }), ...Object.fromEntries(["Install", "SetVersion", "Enable", "Disable", "Remove", "Adopt"].map(action => [`datapacks${action}`, async (...args: unknown[]) => { calls.push([action, ...args]); return { world: "World A" }; }])), ...overrides } as unknown as ClientDatapackSession;
  return { controller: new ClientDatapackController({ directory: "/instances/a/.minecraft", world: "World A", version: "1.21.4", storeDirectory: "/store", openSession: async () => session }), session, calls, closes: () => closes };
}
describe("client world datapack controller", () => {
  test("preserves game directory + world scope and exact world-relative registry file selectors", async () => {
    const f = fixture(); await f.controller.load(); expect(f.controller.getSnapshot().locked).toBe(false);
    await f.controller.toggle({ file: "datapacks/name.zip" }, false);
    await f.controller.remove({ file: "datapacks/name.zip" });
    await f.controller.adopt();
    expect(f.calls).toEqual([["Disable", "/instances/a/.minecraft", "World A", { file: "datapacks/name.zip" }], ["Remove", "/instances/a/.minecraft", "World A", { file: "datapacks/name.zip" }], ["Adopt", "/instances/a/.minecraft", "World A", "/store"]]);
    expect(f.closes()).toBe(4);
  });
  test("uses Modrinth explicit compatible version and never a loader or server API", async () => {
    const f = fixture(); await f.controller.install("project", "v2"); await f.controller.setVersion("project", "v1");
    expect(f.calls[0]?.slice(0, 6)).toEqual(["Install", "/instances/a/.minecraft", "World A", "1.21.4", "project", { provider: "modrinth", version_id: "v2", with_dependencies: true, workers: 8, retries: 2, store_directory: "/store" }]);
    expect(f.calls[1]?.slice(0, 7)).toEqual(["SetVersion", "/instances/a/.minecraft", "World A", "1.21.4", "project", "v1", { workers: 8, retries: 2, store_directory: "/store" }]);
  });
  test("fresh world lock blocks mutation; a missing/mismatched world is not silently targeted", async () => {
    const f = fixture({ worldsGet: async () => ({ world: { name: "World A", locked: true } }) as never });
    expect(await f.controller.adopt()).toBe(false); expect(f.calls).toHaveLength(0); expect(f.controller.getSnapshot().error).toBe("WORLD_LOCKED");
    const missing = fixture({ worldsGet: async () => { throw { code: "WORLD_NOT_FOUND", message: "sensitive" }; } });
    await missing.controller.adopt(); expect(missing.controller.getSnapshot().error).toBe("WORLD_NOT_FOUND");
    const mismatch = fixture({ datapacksList: async () => ({ stage: "datapacks.list", world: "Other", entries: [], unmanaged: [] }) });
    await mismatch.controller.load(); expect(mismatch.controller.getSnapshot().content).toBeNull(); expect(mismatch.controller.getSnapshot().refreshError).toBe("INVALID_PARAMS");
  });
  test("invalid basename/traversal selectors never reach core", async () => {
    const f = fixture(); for (const file of ["name.zip", "datapacks/../a", "datapacks/a/b.zip", "/datapacks/a.zip"]) expect(await f.controller.remove({ file })).toBe(false);
    expect(f.calls).toHaveLength(0); expect(f.controller.getSnapshot().error).toBe("INVALID_PARAMS");
  });
  test("repeated click is rejected; cancel ignores stale completion and closes once", async () => {
    const wait = deferred<{ world: string }>(); let writes = 0;
    const f = fixture({ datapacksAdopt: async () => { writes++; return await wait.promise as never; } });
    const operation = f.controller.adopt(); await Promise.resolve(); await Promise.resolve();
    expect(await f.controller.adopt()).toBe(false); f.controller.cancel(); wait.resolve({ world: "World A" });
    expect(await operation).toBe(false); expect(writes).toBe(1); expect(f.controller.getSnapshot().content).toBeNull(); expect(f.closes()).toBe(1);
    await f.controller.load(); expect(f.controller.getSnapshot().content?.world).toBe("World A");
  });
  test("cancel during session open prevents writes and closes late session", async () => {
    const wait = deferred<ClientDatapackSession>(); const f = fixture();
    const c = new ClientDatapackController({ directory: "/a", world: "World A", version: "1.21.4", openSession: () => wait.promise });
    const operation = c.adopt(); c.cancel(); wait.resolve(f.session); expect(await operation).toBe(false); expect(f.calls).toHaveLength(0); expect(f.closes()).toBe(1);
  });
  test("structured errors are retained without raw diagnostics and do not auto retry", async () => {
    let calls = 0; const f = fixture({ datapacksAdopt: async () => { calls++; throw { code: "CONTENT_CONFLICT", message: "private-path" }; } });
    expect(await f.controller.adopt()).toBe(false); expect(calls).toBe(1); expect(f.controller.getSnapshot().error).toBe("CONTENT_CONFLICT"); expect(JSON.stringify(f.controller.getSnapshot())).not.toContain("private-path");
  });
});
test("client datapack catalog uses datapack category + game and filters exact loader versions", () => {
  expect(JSON.parse(new URL(datapackSearchUrl("pack", "1.21.4")).searchParams.get("facets")!)).toEqual([["categories:datapack"], ["versions:1.21.4"]]);
  const url = new URL(datapackVersionsUrl("a/b", "1.21.4")); expect(url.pathname).toContain("a%2Fb"); expect(JSON.parse(url.searchParams.get("loaders")!)).toEqual(["datapack"]);
  const version = { id: "good", game_versions: ["1.21.4"], loaders: ["datapack"] } as ModrinthVersion;
  expect(compatibleDatapackVersions([version, { ...version, id: "fabric", loaders: ["fabric"] }, { ...version, id: "old", game_versions: ["1.20"] }], "1.21.4")).toEqual([version]);
});
test("CurseForge world datapacks send provider hints, numeric IDs and no credentials", async () => {
  const f = fixture();
  expect(await f.controller.install("123", "456", "curseforge")).toBe(true);
  expect(await f.controller.setVersion("123", "455", "curseforge")).toBe(true);
  expect(f.calls[0]?.[5]).toEqual({ provider: "curseforge", version_id: "456", with_dependencies: true, workers: 8, retries: 2, store_directory: "/store" });
  expect(f.calls[1]?.[6]).toEqual({ provider: "curseforge", workers: 8, retries: 2, store_directory: "/store" });
  expect(JSON.stringify(f.calls)).not.toContain("api_key");
  expect(await f.controller.install("not-numeric", "456", "curseforge")).toBe(false);
  expect(await f.controller.setVersion("123", "0", "curseforge")).toBe(false);
  expect(f.calls).toHaveLength(2);
});
test("CF refresh opens a fresh session after native credential session retirement", async () => {
  let opens = 0, retired = false;
  const first = fixture({ datapacksInstall: async () => { retired = true; return { world: "World A" } as never; }, datapacksList: async () => { if (retired) throw new Error("retired"); return { stage: "datapacks.list", world: "World A", entries: [], unmanaged: [] }; } });
  const clean = fixture();
  const c = new ClientDatapackController({ directory: "/a", world: "World A", version: "1.21.4", openSession: async () => ++opens === 1 ? first.session : clean.session });
  expect(await c.install("123", "456", "curseforge")).toBe(true);
  expect(opens).toBe(2); expect(c.getSnapshot().refreshError).toBeNull(); expect(c.getSnapshot().content?.world).toBe("World A"); expect(first.closes()).toBe(1); expect(clean.closes()).toBe(1);
});
test("cancellation while opening post-CF refresh closes the late session without stale results", async () => {
  const late = deferred<ClientDatapackSession>(); const first = fixture(), clean = fixture(); let opens = 0;
  const c = new ClientDatapackController({ directory: "/a", world: "World A", version: "1.21.4", openSession: async () => ++opens === 1 ? first.session : late.promise });
  const operation = c.install("123", "456", "curseforge");
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(opens).toBe(2); c.cancel(); late.resolve(clean.session);
  expect(await operation).toBe(false); expect(c.getSnapshot().content).toBeNull(); expect(clean.closes()).toBe(1);
});
test("missing CF key retains actionable code but no native diagnostic", async () => {
  const f = fixture({ datapacksInstall: async () => { throw { code: "CURSEFORGE_KEY_REQUIRED", message: "PRIVATE" }; } });
  expect(await f.controller.install("123", "456", "curseforge")).toBe(false);
  expect(f.controller.getSnapshot().error).toBe("CURSEFORGE_KEY_REQUIRED"); expect(JSON.stringify(f.controller.getSnapshot())).not.toContain("PRIVATE");
});

test("download tuning is captured before asynchronous session opening", async () => {
  const gate = deferred<ClientDatapackSession>(); const f = fixture();
  const c = new ClientDatapackController({ directory: "/a", world: "World A", version: "1.21.4", openSession: () => gate.promise });
  c.setDownloadOptions({ workers: 3, retries: 0 });
  const pending = c.install("project", "v1");
  c.setDownloadOptions({ workers: 32, retries: 5 });
  gate.resolve(f.session); expect(await pending).toBe(true);
  expect(f.calls[0]?.[5]).toMatchObject({ workers: 3, retries: 0 });
  await c.setVersion("project", "v2");
  expect(f.calls[1]?.[6]).toMatchObject({ workers: 32, retries: 5 });
});
