import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider, useSettings } from "@/lib/settings";
import { LauncherContext } from "@/lib/launcher";
import { CoreSession } from "@/lib/rpc";
import { javaPreferencesFor } from "@/lib/javaPreferences";
import type { InstanceManifest } from "@/lib/types";
const dom=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,HTMLInputElement:dom.HTMLInputElement,MutationObserver:dom.MutationObserver,ResizeObserver:dom.ResizeObserver,IS_REACT_ACT_ENVIRONMENT:true});
const {InstanceJavaCard}=await import("./InstanceJavaCard");
let root:Root|undefined;
let disconnect:()=>void;
const instance={id:"same",source:"official",version_id:"1.21-java-test"} as InstanceManifest;
const button=(name:string)=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());};
const change=async(selector:string,value:string|boolean)=>{await act(async()=>{const el=dom.document.querySelector(selector)! as unknown as HTMLInputElement;if(typeof value==="boolean")el.checked=value;else el.value=value;if(el.tagName === "SELECT"){el.dispatchEvent(new dom.Event("change",{bubbles:true}) as unknown as Event);return;}const key=Object.getOwnPropertyNames(el).find(k=>k.startsWith("__reactProps$"))!;(el as unknown as Record<string,{onChange:(e:{target:HTMLInputElement})=>void}>)[key].onChange({target:el});});};
function Switch(){const {update}=useSettings();return <><button onClick={()=>update({instancesDir:"/two"})}>Switch root</button><button onClick={()=>update({storeDir:"/other-store"})}>Switch store</button></>;}
async function setup(probe?:(paths:string[])=>Promise<unknown>){
 localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/one",storeDir:"/store",serversDir:"/servers",javaOverrides:{same:"/legacy/java"}}));
 const session=CoreSession.createForTesting(async(method,params)=>{if(method==="version.resolve")return {java_major_version:21} as never;if(method==="java.detect")return (params.paths&&probe?await probe(params.paths as string[]):{runtimes:[]}) as never;return {runtimes:[]} as never;});
 const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
 function Connection(){const [ready,setReady]=useState(true);disconnect=()=>setReady(false);return <LauncherContext.Provider value={{status:ready?"ready":"error",core:null,error:null,session:ready?session:null,openSession:async()=>session}}><InstanceJavaCard instance={instance}/><Switch/></LauncherContext.Provider>;}
 await act(async()=>root!.render(<SettingsProvider><Connection/></SettingsProvider>));
}
const stored=()=>JSON.parse(localStorage.getItem("jmcl.settings.v1")!);
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;dom.document.body.replaceChildren();localStorage.clear();});
test("legacy override requires explicit trusted review and only applies to selected root",async()=>{
 await setup();expect(dom.document.body.textContent).toContain("legacy ID-only override is inactive");expect(javaPreferencesFor(stored().javaPreferences,"/one","same")).toEqual({policy:"auto"});
 await click("Fill legacy path for review");expect(button("Save forced override").disabled).toBe(true);await change('input[type="checkbox"]',true);await click("Save forced override");expect(javaPreferencesFor(stored().javaPreferences,"/one","same")).toEqual({policy:"auto",override:"/legacy/java"});expect(stored().javaOverrides.same).toBe("/legacy/java");
 await click("Switch root");expect(javaPreferencesFor(stored().javaPreferences,"/two","same")).toEqual({policy:"auto"});expect((dom.document.querySelector('[aria-label="Custom Java path"]') as unknown as HTMLInputElement).value).toBe("");
});
test("candidate is not forced and policy changes remain scoped",async()=>{
 await setup();await change('[aria-label="Custom Java path"]',"/jdk/bin/java");await change('input[type="checkbox"]',true);await click("Save as candidate");await change('select[aria-label="Java policy"]',"managed");expect(javaPreferencesFor(stored().javaPreferences,"/one","same")).toEqual({policy:"managed",paths:["/jdk/bin/java"]});expect(dom.document.body.textContent).toContain("local fallback");
});
for(const action of ["Switch root","Switch store"])test(`late custom probe discarded after ${action}`,async()=>{
 let finish!:(v:unknown)=>void;await setup(async()=>new Promise(r=>{finish=r;}));await change('[aria-label="Custom Java path"]',"/trusted/java");await change('input[type="checkbox"]',true);await click("Probe path");await click(action);await act(async()=>finish({runtimes:[{executable:"/trusted/java",major_version:999,architecture:"STALE"}]}));expect(dom.document.body.textContent).not.toContain("STALE");expect(button("Save as candidate").disabled).toBe(true);
});
test("editing path revokes trust and discards late probe",async()=>{
 let finish!:(v:unknown)=>void;await setup(async()=>new Promise(r=>{finish=r;}));await change('[aria-label="Custom Java path"]',"/trusted/java");await change('input[type="checkbox"]',true);await click("Probe path");await change('[aria-label="Custom Java path"]',"/other/java");await act(async()=>finish({runtimes:[{executable:"/trusted/java",major_version:999,architecture:"STALE"}]}));expect(dom.document.body.textContent).not.toContain("STALE");expect(button("Probe path").disabled).toBe(true);
});

test("filling legacy path invalidates an in-flight probe without trusting it",async()=>{
 let finish!:(v:unknown)=>void;await setup(async()=>new Promise(r=>{finish=r;}));await change('[aria-label="Custom Java path"]',"/trusted/java");await change('input[type="checkbox"]',true);await click("Probe path");await click("Fill legacy path for review");await act(async()=>finish({runtimes:[{executable:"/trusted/java",major_version:999,architecture:"STALE"}]}));expect(dom.document.body.textContent).not.toContain("STALE");expect(button("Probe path").disabled).toBe(true);
});

test("Core disconnect invalidates an in-flight probe",async()=>{
 let finish!:(v:unknown)=>void;await setup(async()=>new Promise(r=>{finish=r;}));await change('[aria-label="Custom Java path"]',"/trusted/java");await change('input[type="checkbox"]',true);await click("Probe path");await act(async()=>disconnect());await act(async()=>finish({runtimes:[{executable:"/trusted/java",major_version:999,architecture:"STALE"}]}));expect(dom.document.body.textContent).not.toContain("STALE");expect(button("Probe path").disabled).toBe(true);
});
