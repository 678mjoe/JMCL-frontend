import { describe, expect, test } from "bun:test";
import { compatibleServerVersions, serverSearchUrl, serverVersionsUrl, searchServerProjects, serverProjectVersions, type ModrinthVersion } from "./modrinth";
describe("server Modrinth catalog scope", () => {
  test("Fabric, NeoForge and Forge search require loader, game and server support", () => {
    for (const loader of ["fabric", "neoforge", "forge"] as const) {
      const url = new URL(serverSearchUrl("mods", "a & b", "1.21.4", loader));
      expect(url.searchParams.get("query")).toBe("a & b");
      expect(JSON.parse(url.searchParams.get("facets")!)).toEqual([["project_type:mod"], [`categories:${loader}`], ["versions:1.21.4"], ["server_side:required", "server_side:optional"]]);
    }
  });
  test("Vanilla datapacks use datapack loader, never resourcepack or server mod loader", () => {
    const search = JSON.parse(new URL(serverSearchUrl("datapacks", "", "1.21.4", null)).searchParams.get("facets")!);
    expect(search).toContainEqual(["categories:datapack"]);
    const url = new URL(serverVersionsUrl("id/with?chars", "datapacks", "1.21.4", "forge"));
    expect(url.pathname).toEndWith("id%2Fwith%3Fchars/version");
    expect(url.searchParams.get("loaders")).toBe('["datapack"]');
    expect(url.searchParams.get("game_versions")).toBe('["1.21.4"]');
  });
  test("returned versions are defensively filtered, including downgrade choices", () => {
    const version = (id: string, loaders: string[], game_versions = ["1.21.4"]): ModrinthVersion => ({ id, loaders, game_versions, name: id, version_number: id, date_published: "2026-01-01" });
    const versions = [version("2", ["fabric"]), version("1", ["fabric"]), version("forge", ["forge"]), version("wrong-game", ["fabric"], ["1.20.1"]), version("pack", ["datapack"])];
    expect(compatibleServerVersions(versions, "mods", "1.21.4", "fabric").map(v => v.id)).toEqual(["2", "1"]);
    expect(compatibleServerVersions(versions, "datapacks", "1.21.4", null).map(v => v.id)).toEqual(["pack"]);
    expect(compatibleServerVersions(versions, "mods", "1.21.4", null)).toEqual([]);
  });
  test("Vanilla mod catalog never requests network; fixtures expose datapack-compatible versions", async () => {
    expect(await searchServerProjects("mods", "", "1.21.4", null)).toEqual([]);
    expect(await serverProjectVersions("x", "mods", "1.21.4", null)).toEqual([]);
    const versions = await serverProjectVersions("fixture", "datapacks", "1.21.4", null);
    expect(versions).toHaveLength(2); expect(versions.every(v => v.loaders.includes("datapack"))).toBe(true);
  });
});
