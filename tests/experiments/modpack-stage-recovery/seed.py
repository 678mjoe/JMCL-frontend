import hashlib,json,pathlib,time,zipfile,sys
root=pathlib.Path(sys.argv[1]); root.mkdir(); cache=root/'.jmclcore/metadata-cache';cache.mkdir(parents=True)
h=lambda b:hashlib.sha1(b).hexdigest()
body=b'inert synthetic artifact, not an archive';url='https://example.invalid/synthetic-version.json'
meta=json.dumps({'id':'synthetic','type':'release','mainClass':'NeverExecuted','libraries':[],'downloads':{'client':{'url':'https://example.invalid/never-fetch','size':len(body),'sha1':h(body)}}},separators=(',',':'))
manifest=json.dumps({'latest':{'release':'synthetic','snapshot':'synthetic'},'versions':[{'id':'synthetic','type':'release','url':url,'sha1':h(meta.encode()),'time':'now','releaseTime':'now'}]},separators=(',',':'))
for u,p in [('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',manifest),(url,meta)]:
 (cache/(h(u.encode())+'.json')).write_text(json.dumps({'v':1,'url':u,'fetched_at':int(time.time()),'payload':p}))
blob=root/'store/objects/sha1'/h(body)[:2]/h(body);blob.parent.mkdir(parents=True);blob.write_bytes(body);blob.chmod(0o444)
with zipfile.ZipFile(root/'fixture.mrpack','w') as z:
 z.writestr('modrinth.index.json',json.dumps({'formatVersion':1,'game':'minecraft','versionId':'offline-v1','name':'Offline recovery fixture','files':[],'dependencies':{'minecraft':'synthetic'}}))
 z.writestr('overrides/config/owned-canary.txt','owned override canary')
print(json.dumps({'root':str(root),'artifact_sha1':h(body),'metadata_sha1':h(meta.encode())}))
