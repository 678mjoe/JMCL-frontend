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
    expect(f.calls[0]?.slice(0, 6)).toEqual(["Install", "/instances/a/.minecraft", "World A", "1.21.4", "project", { provider: "modrinth", version_id: "v2", with_dependencies: true, store_directory: "/store" }]);
    expect(f.calls[1]?.slice(0, 7)).toEqual(["SetVersion", "/instances/a/.minecraft", "World A", "1.21.4", "project", "v1", { store_directory: "/store" }]);
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
