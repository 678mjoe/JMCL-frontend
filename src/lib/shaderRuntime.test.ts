import { expect, spyOn, test } from "bun:test";
import * as catalog from "./modrinth";
import { checkShaderRuntimes, compatibleRuntimeVersions, installedRuntimeMatch, SHADER_RUNTIMES } from "./shaderRuntime";
import type { ContentEntry } from "./types";
const version = { id: "v1", project_id: "YL57xq9U", name: "Fixture", version_number: "1", game_versions: ["1.21.4"], loaders: ["fabric"], date_published: "2026-01-01" };
test("runtime metadata must match exact project, game and loader together", () => {
  const versions = [version, {...version, project_id:"other"}, {...version, game_versions:["1.20.1"]}, {...version, loaders:["forge"]}];
  expect(compatibleRuntimeVersions(versions, "YL57xq9U", "1.21.4", "fabric")).toEqual([version]);
  expect(compatibleRuntimeVersions([version], "YL57xq9U", "1.21.4", null)).toEqual([]);
  expect(compatibleRuntimeVersions([{...version, project_id:undefined}], "YL57xq9U", "1.21.4", "fabric")).toEqual([]);
});
test("query both projects for actual selected loader, including non-assumed combinations", async () => {
  const calls: unknown[][] = [];
  const spy = spyOn(catalog,"projectVersions").mockImplementation(async (...args) => { calls.push(args); return [{...version, project_id:args[0], game_versions:[args[2]], loaders:[args[3]!]}]; });
  try {
    const result=await checkShaderRuntimes("1.21.1","neoforge");
    expect(calls).toEqual(SHADER_RUNTIMES.map(p=>[p.project_id,"mods","1.21.1","neoforge"]));
    expect(result.every(r=>r.versions.length===1)).toBe(true);
    expect(await checkShaderRuntimes("1.21.1",null)).toEqual([]);
    expect(calls).toHaveLength(2);
  } finally {spy.mockRestore();}
});
test("installed identity and enabled state are distinct from runtime metadata match", () => {
  const candidate={project:SHADER_RUNTIMES[0], versions:[version]};
  const entry={enabled:true,source:{provider:"modrinth",project_id:"YL57xq9U",version_id:"v1"}} as ContentEntry;
  expect(installedRuntimeMatch(candidate,[entry])).toBe("matching");
  expect(installedRuntimeMatch(candidate,[{...entry,enabled:false}])).toBe("disabled");
  expect(installedRuntimeMatch(candidate,[{...entry,source:{...entry.source,version_id:"other"}}])).toBe("unverified");
  expect(installedRuntimeMatch(candidate,[entry,entry])).toBe("unverified");
  expect(installedRuntimeMatch(candidate,[{...entry,source:{...entry.source,provider:"manual"}}])).toBe("absent");
});
