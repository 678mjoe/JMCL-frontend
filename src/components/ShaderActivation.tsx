import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSettings } from "@/lib/settings";
import { readShaderActivation, writeShaderActivation, type ShaderActivationScope, type ShaderActivationSnapshot, type ShaderRuntime } from "@/lib/packActivation";
import type { InstanceManifest } from "@/lib/types";
export interface ShaderActivationApi { read: typeof readShaderActivation; write: typeof writeShaderActivation }
const nativeApi: ShaderActivationApi = {read:readShaderActivation,write:writeShaderActivation};
export function ShaderActivation({instance,api=nativeApi}:{instance:InstanceManifest;api?:ShaderActivationApi}) {
 const {settings}=useSettings();
 return <ShaderActivationEditor key={`${settings.instancesDir}\0${instance.id}\0${instance.version_id}`} instancesRoot={settings.instancesDir} instanceId={instance.id} api={api}/>;
}
function ShaderActivationEditor({instancesRoot,instanceId,api}:{instancesRoot:string;instanceId:string;api:ShaderActivationApi}) {
 const {settings}=useSettings();const zh=settings.language==="zh";
 const [runtime,setRuntime]=useState<ShaderRuntime | "">("");
 const [snapshot,setSnapshot]=useState<ShaderActivationSnapshot|null>(null);
 const [shaderPack,setShaderPack]=useState<string|null>(null);
 const [enabled,setEnabled]=useState(false);
 const [confirmedRuntime,setConfirmedRuntime]=useState(false);
 const [confirmedStopped,setConfirmedStopped]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState(false);const [saved,setSaved]=useState(false);
 const alive=useRef(true);const revision=useRef(0);const lock=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;revision.current++;};},[]);
 const current=(id:number)=>alive.current && revision.current===id;
 const resetConsent=()=>{setConfirmedRuntime(false);setConfirmedStopped(false);setSaved(false);};
 const scope=():ShaderActivationScope=>({instancesRoot,instanceId,runtime:runtime as ShaderRuntime});
 function choose(value:ShaderRuntime|""){revision.current++;setRuntime(value);setSnapshot(null);setError(false);resetConsent();}
 async function load(){
  if(!runtime || lock.current)return;lock.current=true;const id=++revision.current;
  setBusy(true);setError(false);setSnapshot(null);resetConsent();
  try {const value=await api.read(scope());if(current(id)){setSnapshot(value);setShaderPack(value.shaderPack);setEnabled(value.enabled);}}
  catch {if(current(id))setError(true);}
  finally {lock.current=false;if(current(id))setBusy(false);}
 }
 async function save(){
  if(!runtime || !snapshot || !confirmedRuntime || !confirmedStopped || lock.current)return;
  lock.current=true;const id=++revision.current;setBusy(true);setError(false);setSaved(false);
  try{const value=await api.write(scope(),snapshot.revision,shaderPack,enabled,true,true);if(current(id)){setSnapshot(value);setShaderPack(value.shaderPack);setEnabled(value.enabled);setSaved(true);}}
  catch{if(current(id)){setSnapshot(null);setError(true);}}
  finally{lock.current=false;if(current(id)){setBusy(false);setConfirmedStopped(false);setConfirmedRuntime(false);}}
 }
 const dirty=!!snapshot&&(snapshot.shaderPack!==shaderPack||snapshot.enabled!==enabled);
 return <Card><CardContent className="space-y-3 pt-4">
  <h2 className="font-semibold">{zh?"光影运行时配置选择":"Shader runtime configuration selection"}</h2>
  <p className="text-sm text-muted-foreground">{zh?"安装文件、配置选择和运行时兼容是三个不同状态。这里不检测已安装的运行时：仅在你明确选择并确认后修改现有 Iris/Oculus 配置，不保证游戏已加载。未知运行时和 OptiFine 请使用游戏内菜单。":"Installed files, configured selection, and runtime compatibility are separate states. This does not detect installed runtimes: it edits an existing Iris/Oculus configuration only after your explicit selection and confirmation, without proving game loading. Use the in-game menu for unknown runtimes and OptiFine."}</p>
  <p className="text-sm text-muted-foreground">{zh?"必须先退出游戏，且保存期间不要从其他程序启动。当前跟踪的应用内操作冲突会被阻止；外部启动或 Core 断开后仍存活的游戏无法检测。仅 Unix 支持安全写入，Windows 暂不支持；缺少或无法安全解析的配置不会创建或覆盖。":"Quit the game and do not start it externally while saving. Conflicts with actively tracked in-app operations are blocked; external games or games surviving a Core disconnect cannot be detected. Safe writes are Unix-only, not yet Windows. Missing or unsupported configurations are never created or overwritten."}</p>
  <label className="block text-sm">{zh?"明确选择正在使用的运行时":"Explicitly choose the runtime you use"}<select className="ml-2 rounded border bg-background p-1" aria-label="Shader configuration runtime" disabled={busy} value={runtime} onChange={e=>choose(e.target.value as ShaderRuntime|"")}><option value="">{zh?"选择运行时…":"Choose runtime…"}</option><option value="iris">Iris — config/iris.properties</option><option value="oculus">Oculus — config/oculus.properties</option></select></label>
  <Button variant="outline" disabled={!runtime||busy} onClick={()=>void load()}>{zh?"放弃编辑并读取所选配置":"Discard edits and read selected config"}</Button>
  {busy&&<p role="status">{zh?"正在读取或保存…":"Reading or saving…"}</p>}
  {error&&<p role="alert">{zh?"无法安全读取或写入所选配置。可能文件不存在、格式不支持、已更改或任一 Core 请求正在运行；未确认成功。请重新读取，或在游戏内设置。":"Could not safely read or write selected configuration: missing, unsupported, changed, or any Core request is active. Success is not confirmed. Reload, or configure in game."}</p>}
  {saved&&<p role="status">{zh?"所选运行时配置已写入；未验证运行时安装、兼容性或游戏加载。":"Selected runtime configuration written; runtime installation, compatibility, and game loading remain unverified."}</p>}
  {snapshot&&<>
   <label className="block text-sm">{zh?"光影文件":"Shader file"}<select className="ml-2 rounded border bg-background p-1" aria-label="Shader file" value={shaderPack??""} disabled={busy} onChange={e=>{setShaderPack(e.target.value||null);resetConsent();}}><option value="">{zh?"未选择":"None selected"}</option>{shaderPack&&!snapshot.availableShaderPacks.includes(shaderPack)&&<option value={shaderPack}>{shaderPack} ({zh?"当前值；文件不存在":"current; file missing"})</option>}{snapshot.availableShaderPacks.map(pack=><option key={pack} value={pack}>{pack}</option>)}</select></label>
   <label className="flex items-start gap-2 text-sm"><input aria-label="Enable configured shader" type="checkbox" checked={enabled} disabled={busy} onChange={e=>{setEnabled(e.target.checked);resetConsent();}}/>{zh?"在所选运行时配置中启用光影":"Enable shader in selected runtime configuration"}</label>
   <label className="flex items-start gap-2 text-sm"><input aria-label="Confirm selected runtime" type="checkbox" checked={confirmedRuntime} disabled={busy||!dirty} onChange={e=>setConfirmedRuntime(e.target.checked)}/>{zh?`我确认此实例使用 ${runtime}；配置文件存在本身不能证明其安装或兼容。`:`I confirm this instance uses ${runtime}; a config file alone does not prove installation or compatibility.`}</label>
   <label className="flex items-start gap-2 text-sm"><input aria-label="Confirm shader game stopped" type="checkbox" checked={confirmedStopped} disabled={busy||!dirty} onChange={e=>setConfirmedStopped(e.target.checked)}/>{zh?"我确认所有相关游戏进程已退出，保存期间不会从外部启动。":"I confirm all related game processes are stopped and will not start externally while saving."}</label>
   <Button disabled={busy||!dirty||!confirmedRuntime||!confirmedStopped||(enabled&&(!shaderPack||!snapshot.availableShaderPacks.includes(shaderPack)))} onClick={()=>void save()}>{zh?"保存所选运行时配置":"Save selected runtime config"}</Button>
  </>}
 </CardContent></Card>;
}
