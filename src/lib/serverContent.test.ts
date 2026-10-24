import { describe, expect, test } from "bun:test";
import { ServerContentController, serverContentLoader, type ServerContentSession, type ServerContentKind } from "./serverContent";
import { ServerWorldsController } from "./serverWorlds";
import { acquireServerTarget, serverTargetBusy } from "./serverTargetLock";
import type { ServerOperationScope } from "./servers";
import type { ServerManifest, ServerStatus } from "./types";
const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; };
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const manifest: ServerManifest={id:"demo",name:"Demo",version_id:"1.21.4",installed:true,accept_eula:true,source:"official",fabric_loader:"0.16.10",neoforge_version:null,forge_version:null,java_path:null};
const status=(running=false):ServerStatus=>({stage:"server.status",id:"demo",running,stale_state:false,pid:null,supervisor_pid:null,java_path:null,started_at_ms:null,uptime_ms:null});
let serial=0;
function harness(kind:ServerContentKind="mods", overrides:Partial<ServerContentSession>={}, opening?:()=>Promise<ServerContentSession>) {
  const scope:ServerOperationScope={endpointId:`content-${++serial}`,kind:"ssh",directory:"/synthetic",sourceRevision:1};
  let current=true,closes=0; const calls:string[]=[]; const mutations:unknown[][]=[];
  const result=(stage:string,args:unknown[])=>{calls.push(stage);mutations.push(args);return {stage,id:"demo"};};
  const session={
    close:async()=>{closes++;}, serverGet:async()=>{calls.push("get");return {stage:"server.get",...manifest};}, serverStatus:async()=>{calls.push("status");return status();},
    serverModsList:async()=>({stage:"server.mods.list",id:"demo",entries:[],unmanaged:[]}), serverDatapacksList:async()=>({stage:"server.datapacks.list",id:"demo",entries:[],unmanaged:[]}),
    ...Object.fromEntries(["Mods","Datapacks"].flatMap(k=>["Install","SetVersion","Enable","Disable","Remove","Adopt"].map(a=>[`server${k}${a}`,async(...args:unknown[])=>result(`${k}.${a}`,args)]))), ...overrides,
  } as ServerContentSession;
  const make=()=>new ServerContentController({id:"demo",kind,scope,isScopeCurrent:()=>current,openSession:opening??(async()=>session)});
  return {controller:make(),make,session,scope,calls,mutations,invalidate:()=>{current=false;},get closes(){return closes;}};
}
const actions=[(c:ServerContentController)=>c.install("fixture","v1"),(c:ServerContentController)=>c.setVersion("fixture","v2"),(c:ServerContentController)=>c.toggle({project:"fixture"},true),(c:ServerContentController)=>c.toggle({project:"fixture"},false),(c:ServerContentController)=>c.remove({project:"fixture"}),(c:ServerContentController)=>c.adopt()];
describe("server content controller",()=>{
  for(const kind of ["mods","datapacks"] as const) test(`${kind}: all mutations route only server RPC with fresh matching authority`,async()=>{
    const h=harness(kind);for(const action of actions){h.calls.length=0;expect(await action(h.controller)).toBe(true);expect(h.calls.slice(0,2)).toEqual(["get","status"]);}
    expect(h.mutations).toHaveLength(6);for(const args of h.mutations)expect(args.slice(0,2)).toEqual(["/synthetic","demo"]);
    expect(h.mutations[0]?.[3]).toEqual({provider:"modrinth",version_id:"v1",with_dependencies:true});expect(h.closes).toBe(6);
  });
  for(const [name,value,code] of [["running",status(true),"SERVER_ALREADY_RUNNING"],["unknown",{...status(),running:undefined},"SERVER_STATUS_FAILED"],["wrong target",{...status(),id:"else"},"INVALID_PARAMS"]] as const) test(`every mutation rejects ${name}`,async()=>{
    for(const action of actions){const h=harness("mods",{serverStatus:async()=>value as ServerStatus});expect(await action(h.controller)).toBe(false);expect(h.mutations).toHaveLength(0);expect(h.controller.getSnapshot().error).toBe(code);}
  });
  test("fresh manifest rejects Vanilla install, retains cleanup, datapacks allowed before first world",async()=>{
    const vanilla={...manifest,fabric_loader:null};const h=harness("mods",{serverGet:async()=>({stage:"server.get",...vanilla})});expect(await h.controller.install("fixture","v1")).toBe(false);expect(h.controller.getSnapshot().error).toBe("SERVER_LOADER_REQUIRED");expect(await h.controller.remove({file:"mods/old.jar"})).toBe(true);
    const d=harness("datapacks",{serverGet:async()=>({stage:"server.get",...vanilla})});expect(await d.controller.install("fixture","v1")).toBe(true);
    expect(serverContentLoader(manifest)).toBe("fabric");expect(serverContentLoader({...vanilla,neoforge_version:"1"})).toBe("neoforge");expect(serverContentLoader({...vanilla,forge_version:"1"})).toBe("forge");
  });
  test("wrong manifest and transport status failures never mutate or retain diagnostics",async()=>{
    for(const overrides of [{serverGet:async()=>({stage:"server.get" as const,...manifest,id:"other"})},{serverStatus:async()=>{throw {code:"SSH_DISCONNECTED",message:"secret-host-password"};}}]){const h=harness("mods",overrides);expect(await h.controller.adopt()).toBe(false);expect(h.mutations).toHaveLength(0);expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("secret");}
  });
  test("endpoint invalidation during authority rejects stale response and closes independent session",async()=>{
    const pending=deferred<ServerStatus>();const h=harness("mods",{serverStatus:()=>pending.promise});const task=h.controller.adopt();await flush();h.invalidate();pending.resolve(status());expect(await task).toBe(false);expect(h.mutations).toHaveLength(0);expect(h.closes).toBe(1);expect(serverTargetBusy(h.scope,"demo")).toBe(false);
  });
  test("cancel while opening closes late session once; no mutation",async()=>{
    const pending=deferred<ServerContentSession>();const h=harness("mods",{},()=>pending.promise);const task=h.controller.adopt();h.controller.cancel();pending.resolve(h.session);expect(await task).toBe(false);expect(h.closes).toBe(1);expect(h.mutations).toHaveLength(0);
  });
  test("cancel/repeated operations keep physical shared target locked until request settles",async()=>{
    const pending=deferred<Awaited<ReturnType<ServerContentSession["serverModsAdopt"]>>>();const h=harness("mods",{serverModsAdopt:()=>pending.promise});const task=h.controller.adopt();await flush();expect(await h.controller.adopt()).toBe(false);h.controller.cancel();expect(await h.make().adopt()).toBe(false);expect(acquireServerTarget(h.scope,"demo")).toBeNull();pending.resolve({stage:"server.mods.adopt",id:"demo",adopted:[]});expect(await task).toBe(false);expect(h.closes).toBe(1);expect(serverTargetBusy(h.scope,"demo")).toBe(false);expect(h.controller.getSnapshot().content).toBeNull();
  });
  test("content blocks world controller on the same physical target", async () => {
    const pending = deferred<Awaited<ReturnType<ServerContentSession["serverModsAdopt"]>>>();
    const h = harness("mods", { serverModsAdopt: () => pending.promise });
    const task = h.controller.adopt(); await flush();
    let opened = false;
    const worlds = new ServerWorldsController({ id: "demo", version: "1.21.4", scope: h.scope, isScopeCurrent: () => true, openSession: async () => { opened = true; throw new Error("must not open"); } });
    expect(await worlds.backup()).toBe(false); expect(opened).toBe(false); expect(worlds.getSnapshot().error).toBe("BUSY");
    pending.resolve({ stage: "server.mods.adopt", id: "demo", adopted: [] }); await task;
  });
  test("confirmed mutation survives refresh failure; lock is released", async () => {
    const h = harness("mods", { serverModsList: async () => { throw { code: "SSH_DISCONNECTED", message: "secret" }; } });
    expect(await h.controller.adopt()).toBe(true);
    expect(h.controller.getSnapshot()).toMatchObject({ error: null, refreshError: "SSH_DISCONNECTED", pending: false, content: null });
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
  });
  test("other endpoint/target can run independently",async()=>{
    const h=harness();const release=acquireServerTarget(h.scope,"other")!;expect(await h.controller.adopt()).toBe(true);release();
  });
  test("redacts event payloads and errors; delayed progress cannot revive cancelled view",async()=>{
    let handler:Parameters<ServerContentSession["serverModsInstall"]>[4];const pending=deferred<Awaited<ReturnType<ServerContentSession["serverModsInstall"]>>>();const h=harness("mods",{serverModsInstall:async(_d,_i,_p,_o,event)=>{handler=event;event?.({kind:"diagnostic",data:"secret-password"});event?.({kind:"event",data:{event:"retry",source:"official",retry:{path:"secret-url",attempt:1,max_attempts:2,error:"secret-token"}}});return pending.promise;}});const task=h.controller.install("fixture","v1");await flush();expect(h.controller.getSnapshot().progress).toBe("retry");expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("secret");h.controller.cancel();handler?.({kind:"event",data:{event:"retry",source:"official",retry:{path:"secret",attempt:1,max_attempts:2,error:"secret"}}});pending.resolve({stage:"server.mods.install",id:"demo",installed:[],skipped:0});await task;expect(h.controller.getSnapshot().progress).toBeNull();
  });
  test("invalid identifiers and ambiguous selectors never mutate",async()=>{const h=harness();expect(await h.controller.install("../bad","v1")).toBe(false);expect(await h.controller.setVersion("fixture","")).toBe(false);expect(await h.controller.remove({project:"fixture",file:"fixture.jar"})).toBe(false);expect(h.mutations).toHaveLength(0);});
  for (const kind of ["mods", "datapacks"] as const) test(`${kind} manual registry file selectors preserve real Core relative paths`, async () => {
    const h = harness(kind);
    const file = `${kind}/manual.${kind === "mods" ? "jar" : "zip"}`;
    expect(await h.controller.toggle({ file }, false)).toBe(true);
    expect(await h.controller.toggle({ file }, true)).toBe(true);
    expect(await h.controller.remove({ file })).toBe(true);
    expect(h.mutations.map(args => args[2])).toEqual([{ file }, { file }, { file }]);
    for (const invalid of ["manual.jar", "/mods/manual.jar", "mods/../manual.jar", "datapacks/../../secret", "mods\\manual.jar", "mods/nested/manual.jar", `${kind}/`, `${kind}/..`, `${kind}/bad\nname`, `${kind === "mods" ? "datapacks" : "mods"}/wrong.jar`]) {
      expect(await h.controller.remove({ file: invalid })).toBe(false);
    }
    expect(h.mutations).toHaveLength(3);
  });
  test("wrong list target is not displayed, status failures erase old authority",async()=>{const h=harness("mods",{serverModsList:async()=>({stage:"server.mods.list",id:"other",entries:[],unmanaged:[]})});await h.controller.load();expect(h.controller.getSnapshot().content).toBeNull();expect(h.controller.getSnapshot().refreshError).toBe("INVALID_PARAMS");});
});
