import hashlib,json,pathlib,time,sys
root=pathlib.Path(sys.argv[1]);root.mkdir();cache=root/'.jmclcore/metadata-cache';cache.mkdir(parents=True)
h=lambda b:hashlib.sha1(b).hexdigest()
body=b'inert synthetic client, not an archive';lib=b'inert synthetic Fabric library, not an archive'
base='synthetic';loader='0.0.0-owned';profile_id=f'fabric-loader-{loader}-{base}'
url='https://example.invalid/synthetic-version.json'
profile_url=f'https://meta.fabricmc.net/v2/versions/loader/{base}/{loader}/profile/json'
meta={'id':base,'type':'release','mainClass':'NeverExecuted','libraries':[],'downloads':{'client':{'url':'https://example.invalid/never-fetch-client','size':len(body),'sha1':h(body)}}}
meta_s=json.dumps(meta,separators=(',',':'))
manifest={'latest':{'release':base,'snapshot':base},'versions':[{'id':base,'type':'release','url':url,'sha1':h(meta_s.encode()),'time':'now','releaseTime':'now'}]}
profile={'id':profile_id,'inheritsFrom':'wrong-owned-parent','mainClass':'NeverExecutedFabric','libraries':[{'name':'org.owned:inert:1','url':'https://example.invalid/maven/','sha1':h(lib),'size':len(lib)}]}
for u,p in [('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',json.dumps(manifest)),(url,meta_s),(profile_url,json.dumps(profile))]:
 (cache/(h(u.encode())+'.json')).write_text(json.dumps({'v':1,'url':u,'fetched_at':int(time.time()),'payload':p}))
for b in [body,lib]:
 blob=root/'store/objects/sha1'/h(b)[:2]/h(b);blob.parent.mkdir(parents=True,exist_ok=True);blob.write_bytes(b);blob.chmod(0o444)
instance={'schema_version':1,'id':'fabric-owned','name':'Owned synthetic Fabric','version_id':base,'fabric_loader':loader,'neoforge_version':None,'forge_version':None,'source':'official'}
d=root/'instances/fabric-owned';(d/'.minecraft').mkdir(parents=True);(d/'instance.json').write_text(json.dumps(instance))
(root/'fixture.json').write_text(json.dumps({'instance':instance,'profile_cache':str(cache/(h(profile_url.encode())+'.json')),'profile_id':profile_id,'artifacts':[{'relative':f'versions/{profile_id}/{profile_id}.jar','sha1':h(body),'text':body.decode()},{'relative':'libraries/org/owned/inert/1/inert-1.jar','sha1':h(lib),'text':lib.decode()}]}))
print(json.dumps({'root':str(root),'client':h(body),'library':h(lib)}))
