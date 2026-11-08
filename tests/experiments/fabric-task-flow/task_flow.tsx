// Test-only stdio adapter. Not Tauri IPC, NativeSession or packaged GUI coverage.
// No network calls by harness; DOM package contains unused network capabilities.
// Every RPC result/error comes from guarded real Core.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { CoreSession, RpcError } from '../../../src/lib/rpc';
import React, { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Window } from 'happy-dom';
import { TasksProvider, useTasks } from '../../../src/lib/tasks';
import { LauncherContext } from '../../../src/lib/launcher';
import { instanceCoordinator, instanceMutationKey } from '../../../src/lib/instanceCoordinator';
const [root, core, guard, python, relay] = process.argv.slice(2);
const counts: Record<string, number> = {}; const calls: any[] = []; const exits:any[] = []; const fatals:any[] = []; let sessions = 0; const events:any[]=[];const errors:any[]=[];
const directory = `${root}/instances`, id = 'fabric-owned', game = `${directory}/${id}/.minecraft`;
const log = (name: string, bytes: any) => appendFileSync(`${root}/${name}`, bytes);
const recordError=(kind:string,error:any,context:any={})=>log('original-errors.jsonl',JSON.stringify({kind,...context,name:error?.name??null,code:error?.code??null,message:error?.message??String(error),stack:error?.stack??null})+'\n');
let releaseOpen: (()=>void)|null=null; let openBarrier: Promise<void>|null=null; let opens=0;
const open = async () => {
 opens++; if(openBarrier) await openBarrier;
 const session = ++sessions;
 const p = spawn(python, ['-I','-S',relay,'--',python,'-I','-S',guard,'--exec',core,'rpc'], {cwd:root, env:{PATH:'/usr/bin:/bin',HOME:root}, stdio:['pipe','pipe','pipe']});
 log('sessions.jsonl',JSON.stringify({session,relayPid:p.pid})+'\n');
 p.stdout.on('data',b=>log(`session-${session}.stdout.raw`,b)); p.stderr.on('data',b=>log(`session-${session}.stderr.raw`,b));
 let next=0; let pending: any; const coreErrors=new WeakSet<object>();
 const exit = new Promise<{code:number|null,signal:string|null}>(resolve=>p.once('close',(code,signal)=>{if(pending){pending.reject(new Error(`Core exit ${code}/${signal}`));pending=null;}resolve({code,signal});}));
 p.on('error',e=>{recordError('transport',e,{session});fatals.push(String(e));if(pending)pending.reject(e);});
 createInterface({input:p.stdout}).on('line',line=>{
  try { const e=JSON.parse(line); assert(pending,'unsolicited event'); assert.equal(e.protocol,1);assert.equal(e.id,pending.id);
   if(e.event==='result'||e.event==='error'){const q=pending;pending=null;if(e.event==='error'){errors.push({session,...e.error});const error=new RpcError({kind:'rpc',code:e.error.code,message:e.error.message});assert.equal(error.kind,'rpc');coreErrors.add(error);q.reject(error);}else q.resolve(e.result);}
   else {events.push({session,data:e});flushSync(()=>pending.onEvent?.({kind:'event',data:e}));}
  }catch(e){recordError('protocol',e,{session});fatals.push(String(e));pending?.reject(e);pending=null;}
 });
 async function request(method:string,params:any,onEvent?:any){
  assert.equal(fatals.length,0,'sticky protocol failure');assert(!pending,'one request at a time'); counts[method]=(counts[method]??0)+1;calls.push({session,method,params});
  const rid=`s${session}-${++next}`; const raw=JSON.stringify({protocol:1,id:rid,method,params})+'\n';log(`session-${session}.stdin.raw`,raw);
  return await new Promise<any>((resolve,reject)=>{pending={id:rid,resolve,reject,onEvent};p.stdin.write(raw);});
 }
 const native = CoreSession.createForTesting(async (method, params, onEvent, options) => {
  try {
  assert(['version.resolve','install.execute','install.prepare','instance.get','instance.list'].includes(method),'method allowlist');
  const result=await request(method,params,onEvent);
  if(method==='version.resolve'){assert.equal(result.kind,'fabric');assert.equal(result.id,'fabric-loader-0.0.0-owned-synthetic');}
  if(method==='install.execute') {
   assert.equal(result.files_downloaded,0);assert.equal(result.bytes_transferred,0);assert.equal(result.files_cached,2);assert.equal(result.files_hard_linked,2);

  }
  return result;
  }catch(error){const coreError=typeof error==='object'&&error!==null&&coreErrors.has(error);recordError(coreError?'core-rpc':'request-seam',error,{session,method});if(!coreError)fatals.push(String(error));throw error;}
 });
 // Test-owned lifecycle seam only; real typed methods/request coordinator are untouched.
 native.close=async()=>{
  try {
  p.stdin.end();const result=await exit;
  exits.push({session,...result});log('sessions.jsonl',JSON.stringify({session,...result})+'\n');assert.deepEqual(result,{code:0,signal:null});
  }catch(error){recordError('close',error,{session});fatals.push(String(error));throw error;}
 };
 return native;
};

const fixture=JSON.parse(readFileSync(`${root}/fixture.json`,'utf8'));
// No navigation, resource nodes, fetch, XHR or WebSocket are used by this harness.
const window=new Window({settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false}});
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
let api: ReturnType<typeof useTasks>;const states:any[]=[];
function Observer(){const value=useTasks();useLayoutEffect(()=>{api=value;states.push(structuredClone(value.tasks));},[value]);return null;}
const container=window.document.createElement('div');window.document.body.appendChild(container);
const mounted=createRoot(container as any);
await act(async()=>{mounted.render(React.createElement(LauncherContext.Provider,{value:{status:'ready',core:null,error:null,session:null,openSession:open}},React.createElement(TasksProvider,null,React.createElement(Observer))));});
const snapshot=()=>api!;
// Flushing synchronous beginTask updates gives an actual committed running state.
let valid:boolean;await act(async()=>{valid=await api!.startValidate(fixture.instance);});
assert.equal(valid!,false);assert.equal(snapshot().taskFor('validate',id)?.status,'error');
assert.match(snapshot().taskFor('validate',id)?.message??'',/VERSION_RESOLUTION_FAILED/);
assert.deepEqual(counts,{'version.resolve':1});assert.equal(exits.length,1);
const cache=JSON.parse(readFileSync(fixture.profile_cache,'utf8'));const profile=JSON.parse(cache.payload);assert.equal(profile.inheritsFrom,'wrong-owned-parent');profile.inheritsFrom='synthetic';cache.payload=JSON.stringify(profile);cache.fetched_at=Math.floor(Date.now()/1000);writeFileSync(fixture.profile_cache,JSON.stringify(cache));
await act(async()=>{valid=await api!.startValidate(fixture.instance);});assert.equal(valid!,true);assert.equal(snapshot().taskFor('validate',id)?.status,'success');
const dirs={instancesDir:directory,storeDir:`${root}/store`,workers:1,retries:0};
// An explicit held open, not a timing-dependent sleep, proves duplicate suppression.
openBarrier=new Promise<void>(resolve=>releaseOpen=resolve);const before=opens;let install:Promise<void>;
await act(async()=>{
flushSync(()=>{install=api!.startInstall(fixture.instance,dirs);});assert.equal(opens,before+1);assert.equal(snapshot().taskFor('install',id,directory)?.status,'running');
await api!.startInstall(fixture.instance,dirs);assert.equal(opens,before+1);openBarrier=null;releaseOpen!();await install!;
});
assert.equal(snapshot().taskFor('install',id,directory)?.status,'success');assert.equal(snapshot().taskFor('install',id,directory)?.stage,'task.stage.prepare');assert(!instanceCoordinator.isBusy(instanceMutationKey(directory,id)));
const receipt=readFileSync(`${game}/.jmcl/install.json`);assert.deepEqual(JSON.parse(receipt.toString()),{schema_version:1,version_id:'synthetic',fabric_loader:'0.0.0-owned',neoforge_version:null,forge_version:null,source:'official',os:'linux',arch:'x86_64'});
const verifyBytes=()=>{for(const artifact of fixture.artifacts){const file=`${game}/${artifact.relative}`;assert.equal(readFileSync(file,'utf8'),artifact.text);const blob=`${root}/store/objects/sha1/${artifact.sha1.slice(0,2)}/${artifact.sha1}`;assert.equal(createHash('sha1').update(readFileSync(file)).digest('hex'),artifact.sha1);const a=statSync(file),b=statSync(blob);assert.equal(a.ino,b.ino);assert.equal(a.dev,b.dev);assert.equal(a.mode&0o222,0);assert(a.nlink>=2);}};verifyBytes();
await act(async()=>{await api!.startInstall(fixture.instance,dirs);});assert.equal(snapshot().taskFor('install',id,directory)?.status,'success');assert.equal(opens,before+2);assert(!instanceCoordinator.isBusy(instanceMutationKey(directory,id)));verifyBytes();
assert.deepEqual(readFileSync(`${game}/.jmcl/install.json`),receipt);
const fresh=await open();const manifest=await fresh.instanceGet(directory,id);const list=await fresh.instanceList(directory);await fresh.close();
assert.equal(manifest.installed,true);assert.equal(manifest.version_id,'synthetic');assert.equal(manifest.fabric_loader,'0.0.0-owned');assert(list.instances.some((m:any)=>m.id===id&&m.installed===true&&m.fabric_loader==='0.0.0-owned'));
for(const {session,data:e} of events){assert([3,4].includes(session));assert(['started','file','progress'].includes(e.event));if(e.event==='started'){assert.equal(e.started.stage,'download');assert.equal(e.started.files_total,2);}if(e.event==='file'){assert.equal(e.file.status,'cached');assert.equal(e.file.attempts,0);assert.equal(e.file.placement,'hard_link');}if(e.event==='progress')assert.equal(e.progress.bytes_transferred,0);}
assert.deepEqual(errors.map(e=>e.code),['VERSION_RESOLUTION_FAILED']);assert.equal(events.filter(e=>e.data.event==='file'&&e.data.file?.status==='cached').length,4);
assert.equal(fatals.length,0);assert.equal(exits.length,5);assert(exits.every(e=>e.code===0&&e.signal===null));
assert(states.some(s=>Object.values(s).some((t:any)=>t.kind==='install'&&t.installProgress?.detail?.kind==='file'&&t.installProgress.detail.status==='cached')));
assert(states.some(s=>Object.values(s).some((t:any)=>t.kind==='install'&&t.progress?.filesCompleted===2&&t.progress?.filesTotal===2)));
assert(!states.some(s=>Object.values(s).some((t:any)=>['task.stage.java','task.stage.processor'].includes(t.stage))));
assert.deepEqual(counts,{'version.resolve':2,'install.execute':2,'install.prepare':2,'instance.get':1,'instance.list':1});
await act(async()=>{mounted.unmount();});await window.happyDOM.close();
writeFileSync(`${root}/result.json`,JSON.stringify({counts,calls,events,errors,exits,states,manifest,list,sessions,receiptBeforeRepeat:JSON.parse(receipt.toString()),receiptAfterRepeat:JSON.parse(readFileSync(`${game}/.jmcl/install.json`,'utf8')),scope:'Original React TasksProvider and CoreSession typed request methods, local happy-dom container and test-owned session lifecycle/stdio relay. Real guarded Core. Synthetic bytes only. Not real UI, Tauri IPC, NativeSession, loader catalog, create dialog, Java, game or real Fabric acceptance.'},null,2));
console.log(JSON.stringify({passed:true,counts,sessions}));
