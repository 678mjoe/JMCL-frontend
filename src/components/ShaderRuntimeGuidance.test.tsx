import { afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { LauncherContext } from "@/lib/launcher";
import * as runtime from "@/lib/shaderRuntime";
import type { CoreSession } from "@/lib/rpc";
import type { InstanceManifest } from "@/lib/types";
const dom=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,MutationObserver:dom.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true});
const {ShaderRuntimeGuidance}=await import("./ShaderRuntimeGuidance");
let root:Root|undefined;
const spies:{mockRestore:()=>void}[]=[];
const button=(text:string)=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent===text)!;
const instance={id:"fixture",version_id:"1.21.4",fabric_loader:"0.16"} as InstanceManifest;
const result=[{project:runtime.SHADER_RUNTIMES[0],versions:[]}];
async function setup(){
 localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/fixture",storeDir:"/store"}));
 const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
 const session={contentList:async()=>({entries:[],unmanaged:[]})} as unknown as CoreSession;
 return async (value=instance)=>{await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{session,status:"ready",core:null,error:null,openSession:async()=>{throw new Error("No install authorized by check");}}}><ShaderRuntimeGuidance instance={value}/></LauncherContext.Provider></SettingsProvider>));};
}
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;spies.splice(0).forEach(s=>s.mockRestore());dom.document.body.replaceChildren();localStorage.clear();});
test("explicit read-only check blocks repeated clicks and cancel ignores delayed response",async()=>{
 let calls=0;let finish!:(v:typeof result)=>void;
 spies.push(spyOn(runtime,"checkShaderRuntimes").mockImplementation(async()=>{calls++;return new Promise(resolve=>finish=resolve);}));
 const render=await setup();await render();expect(calls).toBe(0);
 await act(async()=>{button("Check runtime versions").click();button("Check runtime versions").click();});expect(calls).toBe(1);
 await act(async()=>button("Cancel check").click());await act(async()=>finish(result));
 expect(dom.document.body.textContent).not.toContain("No matching catalog versions returned");
 expect(button("Check runtime versions").disabled).toBe(false);
});
test("new instance scope cannot display late old runtime results",async()=>{
 let finish!:(v:typeof result)=>void;
 spies.push(spyOn(runtime,"checkShaderRuntimes").mockImplementation(async()=>new Promise(resolve=>finish=resolve)));
 const render=await setup();await render();await act(async()=>button("Check runtime versions").click());
 await render({...instance,id:"new-instance",version_id:"1.20.1"});await act(async()=>finish(result));
 expect(dom.document.body.textContent).not.toContain("No matching catalog versions returned");
 expect(dom.document.body.textContent).toContain("1.20.1");
});
test("Vanilla cannot imply a compatible runtime and failed check stays unverified",async()=>{
 const spy=spyOn(runtime,"checkShaderRuntimes").mockRejectedValue(new Error("fixture"));spies.push(spy);
 const render=await setup();await render({...instance,fabric_loader:null});
 expect(button("Check runtime versions").disabled).toBe(true);expect(spy).not.toHaveBeenCalled();
 await render();await act(async()=>button("Check runtime versions").click());
 expect(dom.document.body.textContent).toContain("Compatibility remains unverified");
});
