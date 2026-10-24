import { expect, test } from "bun:test";
import { curseForgeCatalogRequest, mapCurseForgeProjects, mapCurseForgeVersions, validCurseForgeKey, setCurseForgeKey, deleteCurseForgeKey, curseForgeKeyStatus, searchCurseForgeProjects, curseForgeVersions } from "./curseforge";
import { CoreSession } from "./rpc";

test("CF request uses numeric class IDs and loader only for mods; bounds and IDs fail closed", () => {
  for (const [kind, id] of [["mods", 6], ["resourcepacks", 12], ["shaderpacks",6552], ["datapacks",5290]] as const) {
    expect(curseForgeCatalogRequest(kind,"1.21.4","fabric")).toMatchObject({kind:"search",class_id:id,game_version:"1.21.4",page_size:50,index:0});
    expect(curseForgeCatalogRequest(kind,"1.21.4","fabric").loader).toBe(kind === "mods" ? 4 : undefined);
  }
  expect(curseForgeCatalogRequest("mods","1.21.4","neoforge","123").loader).toBe(6);
  for (const id of ["../1","0","01","1.5","4294967296"]) expect(() => curseForgeCatalogRequest("mods","1.21.4","forge",id)).toThrow();
  expect(() => curseForgeCatalogRequest("mods","","forge")).toThrow();
  expect(() => curseForgeCatalogRequest("mods","1.21.4","forge",undefined,"",9951)).toThrow();
});
test("CF metadata defensively filters class/game/project/compatibility and never returns URLs", () => {
  const project = {id:123, gameId:432, classId:6, name:"Fixture", allowModDistribution:false};
  expect(mapCurseForgeProjects({data:[project,{...project,gameId:1},{...project,classId:12}]},"mods")).toMatchObject([{project_id:"123",available:false,icon_url:null}]);
  const file = {id:456,modId:123,gameVersions:["1.21.4","Fabric"],downloadAvailable:true,fileDate:"2026-01-01",displayName:"v1"};
  const mapped = mapCurseForgeVersions({data:[file,{...file,id:457,downloadAvailable:false},{...file,id:458,isAvailable:false},{...file,modId:9},{...file,gameVersions:["1.21.4","Forge"]}]},"123","mods","1.21.4","fabric");
  expect(mapped.map(v => [v.id,v.available])).toEqual([["456",true],["457",false],["458",false]]);
  expect(JSON.stringify(mapped)).not.toContain("downloadUrl");
});
test("CF key syntax and mock presence never provide a getter or retain secret content", async () => {
  for (const key of ["","a b","a\n","é","a".repeat(513)]) expect(validCurseForgeKey(key)).toBe(false);
  expect(validCurseForgeKey("a".repeat(512))).toBe(true);
  await deleteCurseForgeKey();
  await expect(searchCurseForgeProjects("mods","","1.21.4","fabric")).rejects.toThrow("Settings");
  await setCurseForgeKey("synthetic-fixture-not-a-real-key");
  expect(await curseForgeKeyStatus()).toBe(true);
  expect((await searchCurseForgeProjects("mods","","1.21.4","fabric"))[0].project_id).toBe("123");
  expect((await curseForgeVersions("123","mods","1.21.4","fabric")).map(v=>v.id)).toEqual(["2","1"]);
  await deleteCurseForgeKey();
  expect(await curseForgeKeyStatus()).toBe(false);
});
test("RPC carries only CF intent, strips GUI markers and rejects caller API keys", async () => {
  const calls: unknown[]=[];
  const session=CoreSession.createForTesting(async (method,params,_event,options) => {calls.push({method,params,options});return {} as never;});
  await session.contentInstall("mods","/instances/a/.minecraft","1.21.4","123",{provider:"curseforge",version_id:"456"});
  await session.contentSetVersion("mods","/instances/a/.minecraft","1.21.4","123","457",{provider:"curseforge"});
  await session.modpackInstall("/instances","pack","/fixture.zip",{provider:"curseforge"});
  expect(calls).toMatchObject([{params:{provider:"curseforge"},options:{curseforge:true}},{params:{project:"123",version_id:"457"},options:{curseforge:true}},{params:{file:"/fixture.zip"},options:{curseforge:true}}]);
  expect((calls[1] as {params:object}).params).not.toHaveProperty("provider");
  expect((calls[2] as {params:object}).params).not.toHaveProperty("provider");
  await expect(session.request("mods.install",{api_key:"synthetic"})).rejects.toThrow("Settings");
  await expect(session.request("ping",{provider:"curseforge"})).rejects.toThrow("not permitted");
});
test("synthetic native-intent path installs and switches client CF content without a JS key payload", async () => {
  const { resetMockFixture } = await import("./mockTransport");
  resetMockFixture("default");
  await setCurseForgeKey("synthetic-fixture-not-a-real-key");
  const session = await CoreSession.open();
  const directory = "/mock/jmcl/instances/demo/.minecraft";
  await session.contentInstall("mods",directory,"1.21.4","123",{provider:"curseforge",version_id:"456",loader:"fabric"});
  const content = await session.contentList("mods",directory);
  expect(content.entries.find(entry => entry.source.project_id === "123")?.source).toMatchObject({provider:"curseforge",version_id:"456"});
  await session.contentSetVersion("mods",directory,"1.21.4","123","457",{provider:"curseforge",loader:"fabric"});
  expect((await session.contentList("mods",directory)).entries.find(entry => entry.source.project_id === "123")?.source.version_id).toBe("457");
  await session.modpackInstall("/mock/jmcl/instances","cf-fixture","/mock/curseforge.zip",{provider:"curseforge"});
  expect((await session.instanceGet("/mock/jmcl/instances","cf-fixture")).installed).toBe(false);
  await deleteCurseForgeKey();
  await expect(session.contentInstall("mods",directory,"1.21.4","123",{provider:"curseforge"})).rejects.toThrow("Settings");
});
test("ordinary Modrinth and Microsoft token contracts do not request CF credentials", async () => {
  const calls: {method:string;params:Record<string,unknown>;options:unknown}[]=[];
  const session=CoreSession.createForTesting(async (method,params,_event,options) => {calls.push({method,params,options});return {} as never;});
  await session.contentInstall("mods","/instances/a/.minecraft","1.21.4","modrinth-id",{provider:"modrinth",loader:"fabric"});
  await session.authMinecraftRefreshExchange("synthetic-client","synthetic-refresh");
  await session.authMinecraftExchange("synthetic-client","synthetic-access");
  expect(calls[0].params.provider).toBe("modrinth");
  expect(calls[1].params.refresh_token).toBe("synthetic-refresh");
  expect(calls[2].params.access_token).toBe("synthetic-access");
  for(const call of calls) expect(call.options).not.toHaveProperty("curseforge");
});
