import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "@/lib/launcher";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { MicrosoftAccountsProvider } from "@/lib/auth";
import { ModpackTasksProvider, useModpackTasks } from "@/lib/modpackTasks";
import type { ModpackSession } from "@/lib/modpackImport";
import type { EventHandler, InstallEvent } from "@/lib/rpc";
import { TasksProvider } from "@/lib/tasks";
import { CoreSession } from "@/lib/rpc";
import type { InstanceManifest } from "@/lib/types";
const dom = new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true});
const { InstancesPage } = await import("./InstancesPage");
let root: Root | undefined;
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;dom.document.body.replaceChildren();localStorage.clear();});
function SwitchRoot(){const {update}=useSettings();return <button onClick={()=>update({instancesDir:"/second"})}>Switch root</button>;}
const manifest=(name:string):InstanceManifest=>({id:"same-id",name,version_id:"1.21",source:"official",installed:true,fabric_loader:null,neoforge_version:null,forge_version:null});
test("settled modpack tasks refresh once, not on draft edits or another task's progress", async () => {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", instancesDir: "/first", storeDir: "/store" }));
  let listCalls = 0;
  const session = CoreSession.createForTesting(async method => {
    if (method === "instance.list") { listCalls++; return { instances: [] } as never; }
    if (method === "account.microsoft.list") return { accounts: [] } as never;
    return {} as never;
  });
  let jobs!: ReturnType<typeof useModpackTasks>;
  function CaptureJobs() { jobs = useModpackTasks(); return null; }
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: session.core, error: null, session, openSession: async () => session }}><MicrosoftAccountsProvider><TasksProvider><ModpackTasksProvider><InstancesPage onOpenDetail={() => {}} onOpenContent={() => {}} /><CaptureJobs /></ModpackTasksProvider></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>));
  expect(listCalls).toBe(1);
  const input = (id: string) => ({ directory: "/first", storeDirectory: "/store", id, file: `/fixture/${id}.mrpack` });
  const summary = (id: string) => ({ id, name: id, version_id: "1.21", loader: null, files_installed: 2, files_skipped: 0, overrides_written: 0 });
  const dedicated = (id: string): ModpackSession => ({
    close: async () => {}, instanceList: async () => ({ instances: [] }),
    instanceGet: async () => ({ ...manifest(id), id }),
    modpackInstall: async () => summary(id),
    installExecute: async () => ({}), installPrepare: async () => ({ native_directory: "/fixture/natives" }),
  });
  await act(async () => { jobs.registry.start(input("finished"), async () => dedicated("finished")); });
  expect(jobs.registry.list()[0]!.controller.getSnapshot().phase).toBe("success");
  expect(listCalls).toBe(2);
  let emit!: EventHandler<InstallEvent>;
  let finish!: () => void;
  await act(async () => {
    jobs.registry.start(input("active"), async () => ({ ...dedicated("active"), modpackInstall: async (_root, _id, _file, _options, onEvent) => {
      emit = onEvent!;
      await new Promise<void>(resolve => { finish = resolve; });
      return summary("active");
    } }));
  });
  const beforeUpdates = listCalls;
  try {
    expect(beforeUpdates).toBe(2);
    for (let i = 1; i <= 3; i++) {
      await act(async () => { jobs.registry.setDraft("/first", "/store", { id: `edited-${i}`, file: "/fixture/new.mrpack", preview: null }); });
      await act(async () => { emit({ kind: "event", data: { event: "progress", source: "official", progress: { files_completed: i, files_total: 4, bytes_processed: i * 10, bytes_verified: i * 10, bytes_transferred: i * 10, bytes_total: 40 } } }); });
      expect(listCalls).toBe(beforeUpdates);
    }
  } finally {
    // Release the owned task even when the refresh assertion fails.
    await act(async () => { finish(); });
  }
  expect(jobs.registry.list()[1]!.controller.getSnapshot().phase).toBe("success");
  expect(listCalls).toBe(beforeUpdates + 1);
});
test("root switch hides old cards and drops delayed old-root lists",async()=>{
  localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/first",storeDir:"/store",serversDir:"/servers"}));
  const pending: Array<{directory:string;resolve:(value:{instances:InstanceManifest[]})=>void}>=[];
  const session=CoreSession.createForTesting(async(method,params)=>{
    if(method==="instance.list") return await new Promise<{instances:InstanceManifest[]}>(resolve=>pending.push({directory:String(params.directory),resolve})) as never;
    if(method==="account.microsoft.list") return {accounts:[]} as never;
    return {} as never;
  });
  const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{status:"ready",core:session.core,error:null,session,openSession:async()=>session}}><MicrosoftAccountsProvider><TasksProvider><ModpackTasksProvider><InstancesPage onOpenDetail={()=>{}} onOpenContent={()=>{}}/><SwitchRoot/></ModpackTasksProvider></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>));
  expect(pending[0]?.directory).toBe("/first");
  await act(async()=>pending[0]!.resolve({instances:[manifest("Old root card")]}));
  expect(dom.document.body.textContent).toContain("Old root card");
  await act(async()=>{const refresh=dom.document.querySelector('button[title="Refresh"]') as unknown as HTMLButtonElement;refresh.click();});
  await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent==="Switch root")!.click());
  expect(dom.document.body.textContent).not.toContain("Old root card");
  await act(async()=>pending.find((p,i)=>i>0&&p.directory==="/first")!.resolve({instances:[manifest("Late old card")]}));
  expect(dom.document.body.textContent).not.toContain("Late old card");
  await act(async()=>pending.find(p=>p.directory==="/second")!.resolve({instances:[manifest("New root card")]}));
  expect(dom.document.body.textContent).toContain("New root card");
});

for (const page of ["list", "detail"] as const) for (const interruption of ["root", "unmount"] as const) test(`${page}: pending authentication cannot launch after ${interruption}`,async()=>{
  const { mockCredentialSet, mockCredentialDelete } = await import("@/lib/mockTransport");
  const { InstanceDetailPage } = await import("./InstanceDetailPage");
  localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/first",storeDir:"/store",serversDir:"/servers",activeAccountId:"synthetic-account"}));
  mockCredentialSet("synthetic-account","synthetic-refresh");
  let finish!: (value:unknown)=>void;
  let launchCount=0;
  const session=CoreSession.createForTesting(async(method)=>{
    if(method==="instance.list") return {instances:[manifest("Selected instance")]} as never;
    if(method==="instance.get") return manifest("Selected instance") as never;
    if(method==="account.microsoft.list") return {accounts:[{id:"synthetic-account",player_name:"Synthetic",client_id:"synthetic-client"}]} as never;
    if(method==="auth.minecraft.refresh_exchange") return await new Promise<unknown>(resolve=>{finish=resolve;}) as never;
    if(method==="java.runtime.list" || method==="java.detect") return {runtimes:[]} as never;
    if(method==="worlds.list") return {worlds:[]} as never;
    if(method==="worlds.backups") return {backups:[]} as never;
    if(method==="launch.execute") launchCount++;
    return {} as never;
  });
  session.close=async()=>{};
  const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{status:"ready",core:session.core,error:null,session,openSession:async()=>session}}><MicrosoftAccountsProvider><TasksProvider><ModpackTasksProvider>{page==="list"?<InstancesPage onOpenDetail={()=>{}} onOpenContent={()=>{}}/>:<InstanceDetailPage instanceId="same-id" onBack={()=>{}} onOpenContent={()=>{}}/>}<SwitchRoot/></ModpackTasksProvider></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>));
  await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Launch")!.click());
  expect(typeof finish).toBe("function");
  if(interruption==="root") await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent==="Switch root")!.click());
  else { await act(async()=>root!.unmount()); root=undefined; }
  await act(async()=>finish({state:"authenticated",refresh_token:"synthetic-rotated",session:{player_name:"Synthetic",uuid:"synthetic",access_token:"synthetic-access"}}));
  expect(launchCount).toBe(0);
  mockCredentialDelete("synthetic-account");
});
