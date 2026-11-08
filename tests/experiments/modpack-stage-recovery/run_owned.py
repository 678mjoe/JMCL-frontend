# Own only the process group created here. Kill/reap descendants on every outcome.
import ctypes,os,pathlib,signal,subprocess,sys,time,json
root=pathlib.Path(sys.argv[1]);root.mkdir(exist_ok=True)
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'subreaper failed')
cmd=sys.argv[2:]; result={};p=None
with (root/'runner.stdout.raw').open('wb') as out,(root/'runner.stderr.raw').open('wb') as err:
 try:
  p=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True,close_fds=True,cwd=root)
  result={'pid':p.pid,'pgid':p.pid,'command':cmd}
  try:result['returncode']=p.wait(timeout=90)
  except subprocess.TimeoutExpired:result['timeout']=True
 finally:
  if p:
   try:os.killpg(p.pid,signal.SIGKILL);result['cleanup_kill_sent']=True
   except ProcessLookupError:result['cleanup_kill_sent']=False
   p.wait();adopted=[]
   deadline=time.monotonic()+5;result['no_children']=False
   while time.monotonic()<deadline:
    try:
     pid,status=os.waitpid(-1,os.WNOHANG)
     if pid:adopted.append([pid,status]);continue
     time.sleep(.02)
    except ChildProcessError:result['no_children']=True;break
   result['reaped']=adopted
   try:os.killpg(p.pid,0);result['group_remaining']=True
   except ProcessLookupError:result['group_remaining']=False
  (root/'runner.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
sys.exit(0 if result.get('returncode')==0 and not result.get('group_remaining') and result.get('no_children') else 1)
