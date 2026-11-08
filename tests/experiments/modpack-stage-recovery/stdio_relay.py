#!/usr/bin/env python3
"""Owned IPC byte relay; NOT a network sandbox. Child gets fresh nonsocket pipes.
No network APIs. Do not alter requests/responses. Guard remains the child's job.
"""
import os,signal,subprocess,sys,threading,resource

def main():
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    if len(sys.argv)<3 or sys.argv[1]!='--':raise SystemExit('expected -- executable arguments')
    child=subprocess.Popen(sys.argv[2:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,bufsize=0)
    errors=[]
    def copy(src,dst,label,close=None):
        try:
            while True:
                block=os.read(src,65536)
                if not block:break
                view=memoryview(block)
                while view:
                    n=os.write(dst,view)
                    if n<=0:raise OSError('zero-byte relay write')
                    view=view[n:]
        except BaseException as exc:
            errors.append((label,type(exc).__name__,str(exc)))
            # A copying error must not leave a running child stalled on a pipe.
            try:child.kill()
            except ProcessLookupError:pass
        finally:
            if close is not None:
                try:close.close()
                except OSError as exc:errors.append((label,'close',str(exc)))
    streams=[threading.Thread(target=copy,args=(0,child.stdin.fileno(),'stdin',child.stdin),daemon=True),
             threading.Thread(target=copy,args=(child.stdout.fileno(),1,'stdout'),daemon=True),
             threading.Thread(target=copy,args=(child.stderr.fileno(),2,'stderr'),daemon=True)]
    for t in streams:t.start()
    timeout=False
    try:code=child.wait(timeout=60)
    except subprocess.TimeoutExpired:
        timeout=True;child.kill();code=child.wait()
    for t in streams[1:]:
        t.join(timeout=5)
        if t.is_alive():errors.append(('drain','timeout','output did not reach EOF'))
    if code==0:
        streams[0].join(timeout=1)
        if streams[0].is_alive():errors.append(('stdin','incomplete','child exited before input EOF'))
    if errors or timeout:
        os.write(2,('relay failure: '+repr({'errors':errors,'timeout':timeout,'child_returncode':code})+'\n').encode())
    # Never convert a child signal/nonzero exit to success. SIGSYS remains SIGSYS.
    if code<0:
        sig=-code
        if sig not in (signal.SIGKILL,signal.SIGSTOP):signal.signal(sig,signal.SIG_DFL)
        os.kill(os.getpid(),sig);os._exit(128+sig)
    if code!=0:return code
    return 124 if timeout else 125 if errors else 0

if __name__=='__main__':raise SystemExit(main())
