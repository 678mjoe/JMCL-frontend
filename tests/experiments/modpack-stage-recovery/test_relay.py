# Pure fixture tests only. No guard, Core, network or external service.
import pathlib,signal,subprocess,sys,json
base=pathlib.Path(__file__).resolve().parent;results=[]
for mode in ['echo','nonzero','signal','drain','timeout']:
 payload=bytes(range(256))*1024 if mode=='echo' else b''
 cmd=[sys.executable,'-I','-S',str(base/'stdio_relay.py'),'--',sys.executable,'-I','-S',str(base/'relay_fixtures.py'),mode]
 p=subprocess.run(cmd,input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=70)
 pathlib.Path(mode+'.stdout.raw').write_bytes(p.stdout);pathlib.Path(mode+'.stderr.raw').write_bytes(p.stderr)
 results.append({'mode':mode,'returncode':p.returncode,'stdout_bytes':len(p.stdout),'stderr_bytes':len(p.stderr)})
 if mode=='echo':assert p.returncode==0 and p.stdout==payload and p.stderr==payload
 if mode=='nonzero':assert p.returncode==17 and p.stderr==b'owned nonzero marker\x00\xff'
 if mode=='signal':assert p.returncode==-signal.SIGTERM and p.stderr==b'owned signal marker'
 if mode=='drain':assert p.returncode==0 and p.stdout==b'x'*(16*65536) and not p.stderr
 if mode=='timeout':assert p.returncode==-signal.SIGKILL and b"'timeout': True" in p.stderr
pathlib.Path('results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
