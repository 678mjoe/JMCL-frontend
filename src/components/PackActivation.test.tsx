import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider, useSettings } from "@/lib/settings";
import type { InstanceManifest } from "@/lib/types";
import type { PackActivationSnapshot } from "@/lib/packActivation";
const dom = new Window({url: "http://localhost/"});
Object.assign(globalThis, {window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true});
const {PackActivation} = await import("./PackActivation");
let root: Root | undefined;
afterEach(async () => { await act(async()=>root?.unmount()); root=undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
const instance = {id:"fixture",version_id:"1.21.4"} as InstanceManifest;
const snapshot = (): PackActivationSnapshot => ({revision:"opaque",resourcePacks:["vanilla","file/A.zip","file/B.zip","mod/builtin"],availableResourcePacks:["file/A.zip","file/B.zip","file/C.zip"]});
const button = (label: string) => [...dom.document.querySelectorAll("button")].find(el => el.textContent === label || el.getAttribute("aria-label") === label)!;
const click = async(label:string) => {await act(async()=>button(label).click());};
async function confirm(){await act(async()=>{const el=dom.document.querySelector('input[type="checkbox"]')! as unknown as HTMLInputElement;el.click();});}
function SwitchRoot(){const {update}=useSettings();return <button onClick={()=>update({instancesDir:"/new-root"})}>Switch root</button>;}
async function setup(api: Parameters<typeof PackActivation>[0]["api"]){localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/old-root"}));const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);await act(async()=>root!.render(<SettingsProvider><PackActivation instance={instance} api={api}/><SwitchRoot/></SettingsProvider>));}
test("selection/reorder preserves unknown IDs, requires stopped confirmation, saves opaque revision and exact order",async()=>{
  const calls: unknown[][]=[];
  await setup({read:async()=>snapshot(),write:async(...args)=>{calls.push(args);return {...snapshot(),revision:"new",resourcePacks:args[2]};}});
  expect(button("Save in-game selection").disabled).toBe(true);
  expect(button("Lower priority file/A.zip").disabled).toBe(true);
  expect(button("Higher priority file/B.zip").disabled).toBe(true);
  await click("Higher priority file/A.zip");
  await click("Select file/C.zip");
  expect(button("Save in-game selection").disabled).toBe(true);
  await confirm(); await click("Save in-game selection");
  expect(calls).toEqual([[{instancesRoot:"/old-root",instanceId:"fixture"},"opaque",["vanilla","file/B.zip","file/A.zip","mod/builtin","file/C.zip"],true]]);
  expect(dom.document.body.textContent).toContain("actual game loading and compatibility are not verified");
});
test("edits reset consent; discard reload does not write",async()=>{
 let writes=0; await setup({read:async()=>snapshot(),write:async()=>{writes++;return snapshot();}});
 await click("Select file/C.zip");await confirm();await click("Deselect file/A.zip");
 expect(button("Save in-game selection").disabled).toBe(true);
 await click("Discard edits and reload");expect(writes).toBe(0);
 expect(button("Select file/C.zip")).toBeDefined();
});
test("uncertain save invalidates approval/revision and requires reload; repeated clicks do not duplicate",async()=>{
 let reject!:()=>void;let writes=0;await setup({read:async()=>snapshot(),write:async()=>{writes++;return await new Promise((_,r)=>{reject=()=>r(new Error("changed"));});}});
 await click("Select file/C.zip");await confirm();await click("Save in-game selection");await click("Save in-game selection");expect(writes).toBe(1);
 await act(async()=>reject());expect(dom.document.querySelector('[role="alert"]')).not.toBeNull();
 expect([...dom.document.querySelectorAll("button")].some(b=>b.textContent==="Save in-game selection")).toBe(false);
 await click("Discard edits and reload");expect(button("Save in-game selection").disabled).toBe(true);
});
test("root navigation discards pending old read and does not reuse old draft",async()=>{
 let finish!:(value:PackActivationSnapshot)=>void;
 await setup({read:async(scope)=>scope.instancesRoot==="/old-root"?await new Promise(r=>{finish=r;}):({...snapshot(),resourcePacks:["new-built-in"]}),write:async()=>snapshot()});
 await click("Switch root");expect(dom.document.body.textContent).toContain("new-built-in");
 await act(async()=>finish(snapshot()));expect(dom.document.body.textContent).not.toContain("mod/builtin");expect(dom.document.body.textContent).toContain("new-built-in");
});
test("unmounted write response is ignored",async()=>{
 let finish!:(value:PackActivationSnapshot)=>void;
 await setup({read:async()=>snapshot(),write:async()=>await new Promise(r=>{finish=r;})});
 await click("Select file/C.zip");await confirm();await click("Save in-game selection");
 await act(async()=>root!.unmount());root=undefined;
 await act(async()=>finish(snapshot()));expect(dom.document.body.textContent).toBe("");
});
