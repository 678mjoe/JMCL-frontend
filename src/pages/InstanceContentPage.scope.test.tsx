import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "@/lib/launcher";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { CoreSession } from "@/lib/rpc";
import type { InstanceManifest } from "@/lib/types";
const dom=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,requestAnimationFrame:dom.requestAnimationFrame.bind(dom),cancelAnimationFrame:dom.cancelAnimationFrame.bind(dom),ResizeObserver:dom.ResizeObserver,IS_REACT_ACT_ENVIRONMENT:true});
const {InstanceContentPage}=await import("./InstanceContentPage");
let root:Root|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;dom.document.body.replaceChildren();localStorage.clear();});
function SwitchRoot(){const {update}=useSettings();return <button onClick={()=>update({instancesDir:"/second"})}>Switch root</button>;}
test("content page never mounts editors with stale instance manifest after root navigation",async()=>{
 localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/first"}));
 const pending:Array<{directory:string;resolve:(v:InstanceManifest)=>void}>=[];
 const session=CoreSession.createForTesting(async(method,params)=>{
  if(method==="instance.get")return await new Promise<InstanceManifest>(resolve=>pending.push({directory:String(params.directory),resolve})) as never;
  if(method.endsWith(".list"))return {entries:[],unmanaged:[]} as never;
  return {} as never;
 });
 const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
 await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{status:"ready",session,core:session.core,error:null,openSession:async()=>session}}><InstanceContentPage instanceId="same" onBack={()=>{}}/><SwitchRoot/></LauncherContext.Provider></SettingsProvider>));
 await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent==="Switch root")!.click());
 await act(async()=>pending[0].resolve({id:"same",name:"Late old instance",version_id:"1.20.1"} as InstanceManifest));
 expect(dom.document.body.textContent).not.toContain("Late old instance");
 await act(async()=>pending[1].resolve({id:"same",name:"Current instance",version_id:"1.21.4"} as InstanceManifest));
 expect(dom.document.body.textContent).toContain("Current instance");
});
