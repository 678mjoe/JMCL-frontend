import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "@/lib/launcher";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { MicrosoftAccountsProvider } from "@/lib/auth";
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
test("root switch hides old cards and drops delayed old-root lists",async()=>{
  localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/first",storeDir:"/store",serversDir:"/servers"}));
  const pending: Array<{directory:string;resolve:(value:{instances:InstanceManifest[]})=>void}>=[];
  const session=CoreSession.createForTesting(async(method,params)=>{
    if(method==="instance.list") return await new Promise<{instances:InstanceManifest[]}>(resolve=>pending.push({directory:String(params.directory),resolve})) as never;
    if(method==="account.microsoft.list") return {accounts:[]} as never;
    return {} as never;
  });
  const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{status:"ready",core:session.core,error:null,session,openSession:async()=>session}}><MicrosoftAccountsProvider><TasksProvider><InstancesPage onOpenDetail={()=>{}} onOpenContent={()=>{}}/><SwitchRoot/></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>));
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
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{status:"ready",core:session.core,error:null,session,openSession:async()=>session}}><MicrosoftAccountsProvider><TasksProvider>{page==="list"?<InstancesPage onOpenDetail={()=>{}} onOpenContent={()=>{}}/>:<InstanceDetailPage instanceId="same-id" onBack={()=>{}} onOpenContent={()=>{}}/>}<SwitchRoot/></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>));
  await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Launch")!.click());
  expect(typeof finish).toBe("function");
  if(interruption==="root") await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent==="Switch root")!.click());
  else { await act(async()=>root!.unmount()); root=undefined; }
  await act(async()=>finish({state:"authenticated",refresh_token:"synthetic-rotated",session:{player_name:"Synthetic",uuid:"synthetic",access_token:"synthetic-access"}}));
  expect(launchCount).toBe(0);
  mockCredentialDelete("synthetic-account");
});
