# Private pure fixtures: binary echo, nonzero, signal, output drain, EOF.
import os,signal,sys
mode=sys.argv[1]
if mode=='echo':
 while True:
  b=os.read(0,65536)
  if not b:break
  os.write(1,b);os.write(2,b)
elif mode=='nonzero':
 os.write(2,b'owned nonzero marker\x00\xff');raise SystemExit(17)
elif mode=='signal':
 os.write(2,b'owned signal marker');os.kill(os.getpid(),signal.SIGTERM)
elif mode=='drain':
 for _ in range(16):os.write(1,b'x'*65536)
elif mode=='timeout':
 import time
 time.sleep(120)
elif mode=='fds':
 import json,stat
 print(json.dumps({str(fd):{'socket':stat.S_ISSOCK(os.fstat(fd).st_mode),'fifo':stat.S_ISFIFO(os.fstat(fd).st_mode)} for fd in (0,1,2)}))
else:raise SystemExit(2)
