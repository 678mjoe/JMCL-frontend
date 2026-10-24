import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider, useSettings } from "@/lib/settings";
import type { InstanceManifest } from "@/lib/types";
import type { ShaderActivationSnapshot } from "@/lib/packActivation";
const dom=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,Event:dom.Event,MouseEvent:dom.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true});
const {ShaderActivation}=await import("./ShaderActivation");
let root:Root|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;dom.document.body.replaceChildren();localStorage.clear();});
const snapshot=():ShaderActivationSnapshot=>({revision:"opaque-shader",runtime:"iris",shaderPack:null,enabled:false,availableShaderPacks:["A.zip","B.zip"]});
const button=(name:string)=>[...dom.document.querySelectorAll("button")].find(el=>el.textContent===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());};
async function select(label:string,value:string){await act(async()=>{const el=dom.document.querySelector(`[aria-label="${label}"]`)! as unknown as HTMLSelectElement;el.value=value;el.dispatchEvent(new dom.Event("change",{bubbles:true}) as unknown as Event);});}
async function check(label:string){await act(async()=>(dom.document.querySelector(`[aria-label="${label}"]`)! as unknown as HTMLInputElement).click());}
function SwitchRoot(){const {update}=useSettings();return <button onClick={()=>update({instancesDir:"/new"})}>Switch root</button>;}
async function setup(api:Parameters<typeof ShaderActivation>[0]["api"]){localStorage.setItem("jmcl.settings.v1",JSON.stringify({language:"en",instancesDir:"/old"}));const host=dom.document.createElement("div");dom.document.body.append(host);root=createRoot(host as unknown as HTMLElement);await act(async()=>root!.render(<SettingsProvider><ShaderActivation instance={{id:"fixture",version_id:"1.21.4"} as InstanceManifest} api={api}/><SwitchRoot/></SettingsProvider>));}
const readButton="Discard edits and read selected config",saveButton="Save selected runtime config";
test("explicit runtime and separate confirmations required; selected config write does not claim detection",async()=>{
 const writes:unknown[][]=[];let reads=0;
 await setup({read:async()=>{reads++;return snapshot();},write:async(...args)=>{writes.push(args);return {...snapshot(),shaderPack:args[2],enabled:args[3]};}});
 expect(reads).toBe(0);expect(button(readButton).disabled).toBe(true);
 await select("Shader configuration runtime","iris");await click(readButton);await select("Shader file","B.zip");await check("Enable configured shader");
 expect(button(saveButton).disabled).toBe(true);await check("Confirm selected runtime");expect(button(saveButton).disabled).toBe(true);await check("Confirm shader game stopped");await click(saveButton);
 expect(writes).toEqual([[{instancesRoot:"/old",instanceId:"fixture",runtime:"iris"},"opaque-shader","B.zip",true,true,true]]);
 expect(dom.document.body.textContent).toContain("runtime installation, compatibility, and game loading remain unverified");
});
test("runtime/root changes discard draft and approval, uncertain writes require reread",async()=>{
 let writes=0;await setup({read:async()=>snapshot(),write:async()=>{writes++;throw new Error("changed");}});
 await select("Shader configuration runtime","iris");await click(readButton);await select("Shader file","A.zip");await check("Confirm selected runtime");await check("Confirm shader game stopped");
 await select("Shader configuration runtime","oculus");expect(dom.document.querySelector('[aria-label="Shader file"]')).toBeNull();
 await click(readButton);await select("Shader file","B.zip");await check("Confirm selected runtime");await check("Confirm shader game stopped");await click(saveButton);
 expect(writes).toBe(1);expect(dom.document.querySelector('[role="alert"]')).not.toBeNull();expect(dom.document.querySelector('[aria-label="Shader file"]')).toBeNull();
 await click("Switch root");expect((dom.document.querySelector('[aria-label="Shader configuration runtime"]')! as unknown as HTMLSelectElement).value).toBe("");
});
test("pending old-root read cannot repopulate a new scope",async()=>{
 let finish!:(value:ShaderActivationSnapshot)=>void;await setup({read:async()=>await new Promise(r=>{finish=r;}),write:async()=>snapshot()});
 await select("Shader configuration runtime","iris");await click(readButton);await click("Switch root");await act(async()=>finish(snapshot()));
 expect(dom.document.querySelector('[aria-label="Shader file"]')).toBeNull();
});
test("missing selected file cannot be enabled; edits revoke both confirmations",async()=>{
 await setup({read:async()=>({...snapshot(),shaderPack:"missing.zip"}),write:async()=>snapshot()});
 await select("Shader configuration runtime","iris");await click(readButton);await check("Enable configured shader");await check("Confirm selected runtime");await check("Confirm shader game stopped");expect(button(saveButton).disabled).toBe(true);
 await select("Shader file","A.zip");expect(button(saveButton).disabled).toBe(true);
 expect((dom.document.querySelector('[aria-label="Confirm selected runtime"]') as unknown as HTMLInputElement).checked).toBe(false);
});
