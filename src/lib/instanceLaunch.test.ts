import { expect, test } from "bun:test";
import { CoreSession } from "./rpc";
import { instanceLaunchOptions } from "./instanceLaunch";
import type { InstanceManifest } from "./types";
const auth = { player_name: "Player", uuid: "synthetic", access_token: "SECRET" };
for (const loader of [{}, {fabric_loader:"0.16"}, {forge_version:"51"}, {neoforge_version:"21"}]) test(`plan/execute exact selected instance wire ${JSON.stringify(loader)}`, async () => {
  const calls: unknown[] = [];
  const session = CoreSession.createForTesting(async (method, params) => { calls.push({method, params}); return {} as never; });
  const instance = {id:"custom-id", name:"Custom", installed:true, version_id:"1.21", source:"bmclapi", fabric_loader:null, forge_version:null, neoforge_version:null, ...loader} as InstanceManifest;
  const options = {extra_jvm_args:["-Dname=a b", "-Xmx1G", "-Xmx2G"], extra_game_args:["--flag", "", "$(not-shell)"], resolution_width:1280, resolution_height:720, include_default_user_jvm:false, demo:true};
  const launch = instanceLaunchOptions(instance,"/store","/java/custom",options);
  const common = {id:"1.21",directory:"/root/custom-id/.minecraft",auth,source:"bmclapi",store_directory:"/store",java_override:"/java/custom",...loader,options};
  await session.launchPlan(instance.version_id,common.directory,"/placeholder-natives",auth,launch);
  await session.launchExecute(instance.version_id,common.directory,auth,launch);
  expect(calls).toEqual([{method:"launch.plan",params:{...common,natives_directory:"/placeholder-natives"}},{method:"launch.execute",params:common}]);
});
test("default launch options retain Core defaults", () => {
  expect(instanceLaunchOptions({source:"official"} as InstanceManifest,"/store")).toEqual({source:"official",store_directory:"/store",options:{}});
});
test("GC exact wire shape and default omissions", async () => {
  const calls: unknown[]=[];
  const session=CoreSession.createForTesting(async(method,params)=>{calls.push({method,params});return {} as never;});
  await session.storeGc(); await session.storeGc({store_directory:"/synthetic",dry_run:true,min_age_seconds:86400}); await session.storeGc({store_directory:"/synthetic",dry_run:false,min_age_seconds:0});
  expect(calls).toEqual([{method:"store.gc",params:{}},{method:"store.gc",params:{store_directory:"/synthetic",dry_run:true,min_age_seconds:86400}},{method:"store.gc",params:{store_directory:"/synthetic",dry_run:false,min_age_seconds:0}}]);
});
test("plan forwards explicit Java policy, paths and architecture outside options", async () => {
  let observed: unknown;
  const session=CoreSession.createForTesting(async(method,params)=>{observed={method,params};return {} as never;});
  await session.launchPlan("1.21","/game","/natives",auth,{java_policy:"local",java_paths:["/java/bin/java"],arch:"arm64",options:{extra_jvm_args:["-ea"]}});
  expect(observed).toEqual({method:"launch.plan",params:{id:"1.21",directory:"/game",natives_directory:"/natives",auth,java_policy:"local",java_paths:["/java/bin/java"],arch:"arm64",options:{extra_jvm_args:["-ea"]}}});
});
test("synthetic GC mock mirrors Core defaults and never claims dry-run deletion", async () => {
  const { mockRequest } = await import("./mockTransport");
  const result = await mockRequest<{dry_run:boolean;min_age_seconds:number;summary:{objects_deleted:number;bytes_deleted:number}}>("store.gc",{});
  expect(result.dry_run).toBe(true); expect(result.min_age_seconds).toBe(86400);
  expect(result.summary.objects_deleted).toBe(0); expect(result.summary.bytes_deleted).toBe(0);
  await expect(mockRequest("store.gc",{dry_run:null})).rejects.toMatchObject({code:"INVALID_PARAMS"});
});
