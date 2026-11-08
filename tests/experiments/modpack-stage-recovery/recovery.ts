// Test-only stdio adapter. Not Tauri IPC, NativeSession or packaged GUI coverage.
// No network imports/APIs. Every result/error comes from the guarded real Core.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { CoreSession } from '../../../src/lib/rpc';
import { ModpackImportController } from '../../../src/lib/modpackImport';
import { instanceCoordinator, instanceMutationKey } from '../../../src/lib/instanceCoordinator';
const [root, core, guard, python, relay] = process.argv.slice(2);
const counts: Record<string, number> = {}; const calls: any[] = []; const exits:any[] = []; const fatals:any[] = []; let sessions = 0;
const directory = `${root}/instances`, id = 'recovery', game = `${directory}/${id}/.minecraft`;
const log = (name: string, bytes: any) => appendFileSync(`${root}/${name}`, bytes);
const recordError=(kind:string,error:any,context:any={})=>log('original-errors.jsonl',JSON.stringify({kind,...context,name:error?.name??null,code:error?.code??null,message:error?.message??String(error),stack:error?.stack??null})+'\n');
const open = async () => {
 const session = ++sessions;
 const p = spawn(python, ['-I','-S',relay,'--',python,'-I','-S',guard,'--exec',core,'rpc'], {cwd:root, env:{PATH:'/usr/bin:/bin',HOME:root}, stdio:['pipe','pipe','pipe']});
 log('sessions.jsonl',JSON.stringify({session,relayPid:p.pid})+'\n');
 p.stdout.on('data',b=>log(`session-${session}.stdout.raw`,b)); p.stderr.on('data',b=>log(`session-${session}.stderr.raw`,b));
 let next=0; let pending: any; const coreErrors=new WeakSet<object>();
 const exit = new Promise<{code:number|null,signal:string|null}>(resolve=>p.once('close',(code,signal)=>{if(pending){pending.reject(new Error(`Core exit ${code}/${signal}`));pending=null;}resolve({code,signal});}));
 p.on('error',e=>{recordError('transport',e,{session});fatals.push(String(e));if(pending)pending.reject(e);});
 createInterface({input:p.stdout}).on('line',line=>{
  try { const e=JSON.parse(line); assert(pending,'unsolicited event'); assert.equal(e.protocol,1);assert.equal(e.id,pending.id);
   if(e.event==='result'||e.event==='error'){const q=pending;pending=null;if(e.event==='error'){coreErrors.add(e.error);q.reject(e.error);}else q.resolve(e.result);}
   else pending.onEvent?.({kind:'event',data:e});
  }catch(e){recordError('protocol',e,{session});fatals.push(String(e));pending?.reject(e);pending=null;}
 });
 async function request(method:string,params:any,onEvent?:any){
  assert.equal(fatals.length,0,'sticky protocol failure');assert(!pending,'one request at a time'); counts[method]=(counts[method]??0)+1;calls.push({session,method,params});
  const rid=`s${session}-${++next}`; const raw=JSON.stringify({protocol:1,id:rid,method,params})+'\n';log(`session-${session}.stdin.raw`,raw);
  return await new Promise<any>((resolve,reject)=>{pending={id:rid,resolve,reject,onEvent};p.stdin.write(raw);});
 }
 const native = CoreSession.createForTesting(async (method, params, onEvent, options) => {
  try {
  if(session<=2) assert(instanceCoordinator.isBusy(instanceMutationKey(directory,id)),'lease during request');
  if(['modpack.install','install.execute','install.prepare'].includes(method)) assert.equal(options.coordinate,false);
  const result=await request(method,params,onEvent);
  if(method==='install.execute') {
   assert.equal(result.files_downloaded,0);assert.equal(result.bytes_transferred,0);assert.equal(result.files_cached,1);assert.equal(result.files_hard_linked,1);
   writeFileSync(`${game}/.jmcl/runtime`,'owned canary',{flag:'wx'});
  }
  return result;
  }catch(error){const coreError=typeof error==='object'&&error!==null&&coreErrors.has(error);recordError(coreError?'core-rpc':'request-seam',error,{session,method});if(!coreError)fatals.push(String(error));throw error;}
 });
 // Test-owned lifecycle seam only; real typed methods/request coordinator are untouched.
 native.close=async()=>{
  try {
  if(session<=2) assert(instanceCoordinator.isBusy(instanceMutationKey(directory,id)),'lease before close');
  p.stdin.end();const result=await exit;
  if(session<=2) assert(instanceCoordinator.isBusy(instanceMutationKey(directory,id)),'lease after close drain');
  exits.push({session,...result});log('sessions.jsonl',JSON.stringify({session,...result})+'\n');assert.deepEqual(result,{code:0,signal:null});
  }catch(error){recordError('close',error,{session});fatals.push(String(error));throw error;}
 };
 return native;
};
const controller=new ModpackImportController({directory,storeDirectory:`${root}/store`,id,file:`${root}/fixture.mrpack`,workers:1,retries:0},open);
const states:any[]=[];controller.subscribe(()=>states.push(structuredClone(controller.getSnapshot())));
await controller.run();
assert.deepEqual([controller.getSnapshot().phase,controller.getSnapshot().error,controller.getSnapshot().canResume,controller.getSnapshot().busy],['error','PREPARE_FAILED',true,false]);
assert(!instanceCoordinator.isBusy(instanceMutationKey(directory,id)));
const receipt=readFileSync(`${game}/.jmcl/install.json`);const jar=readFileSync(`${game}/versions/synthetic/synthetic.jar`);
assert.equal(jar.toString(),'inert synthetic artifact, not an archive');const digest=createHash('sha1').update(jar).digest('hex');const blob=`${root}/store/objects/sha1/${digest.slice(0,2)}/${digest}`;const a=statSync(`${game}/versions/synthetic/synthetic.jar`),b=statSync(blob);assert.equal(a.ino,b.ino);assert.equal(a.dev,b.dev);assert.equal(a.mode & 0o222,0);assert(a.nlink>=2);assert.equal(readFileSync(`${game}/.jmcl/runtime`,'utf8'),'owned canary');
assert.equal(readFileSync(`${game}/config/owned-canary.txt`,'utf8'),'owned override canary');
unlinkSync(`${game}/.jmcl/runtime`);
await controller.run();assert.equal(controller.getSnapshot().phase,'success');assert.equal(controller.getSnapshot().busy,false);assert(!instanceCoordinator.isBusy(instanceMutationKey(directory,id)));
assert.deepEqual(readFileSync(`${game}/.jmcl/install.json`),receipt);assert.deepEqual(readFileSync(`${game}/versions/synthetic/synthetic.jar`),jar);assert(statSync(`${game}/.jmcl/runtime`).isDirectory());
const fresh=await open();const manifest=await fresh.instanceGet(directory,id);assert.equal(manifest.installed,true);assert.equal(manifest.version_id,'synthetic');await fresh.close();
assert.equal(fatals.length,0);assert(states.some(s=>s.phase==='install'&&s.installProgress?.detail?.kind==='file'&&s.installProgress.detail.status==='cached'));assert(states.some(s=>s.phase==='install'&&s.progress?.files===1&&s.progress.total===1));
assert.equal(exits.length,3);assert(exits.every(e=>e.code===0&&e.signal===null));assert.equal(controller.getSnapshot().instance?.installed,true);
assert.deepEqual(counts,{'instance.list':1,'modpack.install':1,'instance.get':3,'install.execute':1,'install.prepare':2});
assert.deepEqual(calls.filter(c=>c.session===2).map(c=>c.method),['instance.get','install.prepare']);
writeFileSync(`${root}/result.json`,JSON.stringify({counts,calls,states,manifest,sessions,scope:'Original GUI controller + original CoreSession typed request methods through createForTesting + test byte-relay stdio/lifecycle seam + real guarded Core. Not Tauri IPC, packaged GUI, Java or game execution.'},null,2));
console.log(JSON.stringify({passed:true,counts,sessions}));
