// Preparation only. Executes only a Python fstat report; no Core, filter or network API.
import {spawn} from 'node:child_process';
import {strict as assert} from 'node:assert';
const p=spawn(process.argv[2],['-I','-S',process.argv[3],'--',process.argv[2],'-I','-S',process.argv[4],'fds'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:process.cwd()}});
let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.stdin.end();
p.on('error',e=>{throw e;});
const code=await new Promise(resolve=>p.on('close',resolve));assert.equal(code,0);assert.equal(err,'');const fds=JSON.parse(out);assert.deepEqual(Object.keys(fds).sort(),["0","1","2"]);assert(Object.values(fds).every((v:any)=>v.socket===false&&v.fifo===true),'child requires three actual FIFOs');console.log(out.trim());
