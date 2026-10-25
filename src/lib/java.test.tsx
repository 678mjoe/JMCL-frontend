import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider, useSettings } from "./settings";
import { LauncherContext } from "./launcher";
import { compatibleJavaMajors, useJavaCatalog } from "./java";
import type { JavaRuntime, ManagedJavaRuntime } from "./types";
import type { CoreSession } from "./rpc";
const local = (major: number, architecture?: string) => ({ executable: "/java", major_version: major, architecture });
const managed = (major: number, platform: string) => ({major_version: major, platform}) as ManagedJavaRuntime;
test("catalog requires exact architecture; unknown and foreign managed platforms do not satisfy", () => {
  expect([...compatibleJavaMajors([local(17,"arm64"),local(21),local(8,"x86_64")], [managed(17,"windows-x64"),managed(25,"linux-arm64"),managed(16,"linux")], {os:"linux",arch:"x86_64"})]).toEqual([8,16]);
  expect(compatibleJavaMajors([local(17,"x86_64")], [managed(21,"linux")], null).size).toBe(0);
  expect([...compatibleJavaMajors([], [managed(21,"mac-os-arm64"), managed(17,"mac-os")], {os:"osx",arch:"arm64"})]).toEqual([21]);
});
const dom = new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true});
let root: Root | undefined;
const defer = <T,>() => { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>resolve=r); return {promise,resolve}; };
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;dom.document.body.replaceChildren();localStorage.clear();});
test("catalog ignores previous-store results and reload closures after settings drift",async()=>{
  const old = defer<{runtimes:ManagedJavaRuntime[]}>(); const next = defer<{runtimes:ManagedJavaRuntime[]}>();
  const calls:string[]=[]; let oldReload: (()=>Promise<void>) | undefined;
  const session = {javaDetect:async()=>({runtimes:[] as JavaRuntime[]}),javaRuntimeList:(store:string)=>{calls.push(store);return store==="/old"?old.promise:next.promise;}} as unknown as CoreSession;
  function Probe(){const state=useJavaCatalog();const {update,settings}=useSettings(); if(settings.storeDir==="/old")oldReload=state.reload;return <><div>{state.managed.items.map(x=>x.name).join(",")}</div><button onClick={()=>update({storeDir:"/next"})}>Switch</button></>;}
  localStorage.setItem("jmcl.settings.v1",JSON.stringify({instancesDir:"/i",storeDir:"/old",serversDir:"/s"}));
  const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{session,status:"ready",core:null,error:null,openSession:async()=>session}}><Probe/></LauncherContext.Provider></SettingsProvider>));
  await act(async()=>dom.document.querySelector("button")!.click());
  await act(async()=>next.resolve({runtimes:[{...managed(21,"linux"),name:"NEW"}]}));
  await act(async()=>old.resolve({runtimes:[{...managed(17,"linux"),name:"OLD"}]}));
  await act(async()=>oldReload!());
  expect(dom.document.body.textContent).toContain("NEW");expect(dom.document.body.textContent).not.toContain("OLD");expect(calls).toEqual(["/old","/next"]);
});

test("same-major local Java does not block managed install and store changes cannot retarget a pending operation",async()=>{
  const {JavaPage}=await import("../pages/JavaPage");
  const opened=defer<CoreSession>();const installed=defer<Record<string,unknown>>();const requests:unknown[]=[];
  const shared={javaDetect:async()=>({runtimes:[local(17,"x86_64")]}),javaRuntimeList:async()=>({runtimes:[]})} as unknown as CoreSession;
  const dedicated={javaRuntimeInstall:(target:unknown,opts:unknown)=>{requests.push({target,opts});return installed.promise;},close:async()=>{}} as unknown as CoreSession;
  function Switch(){const {update}=useSettings();return <button onClick={()=>update({storeDir:"/new-store"})}>Switch store</button>;}
  localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/i",storeDir:"/old-store",serversDir:"/s"}));
  const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);
  await act(async()=>root!.render(<SettingsProvider><LauncherContext.Provider value={{session:shared,status:"ready",core:null,error:null,openSession:()=>opened.promise}}><JavaPage/><Switch/></LauncherContext.Provider></SettingsProvider>));
  const button=[...dom.document.querySelectorAll("button")].find(b=>b.textContent?.startsWith("Java 17"))!;
  expect(button.disabled).toBe(false);
  await act(async()=>button.click());
  await act(async()=>[...dom.document.querySelectorAll("button")].find(b=>b.textContent==="Switch store")!.click());
  await act(async()=>opened.resolve(dedicated));
  expect(requests).toEqual([{target:{major:17},opts:{store_directory:"/old-store",workers:8,retries:2}}]);
  await act(async()=>root!.unmount());root=undefined;
  await act(async()=>installed.resolve({}));
});
