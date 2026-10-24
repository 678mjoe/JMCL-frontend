import { expect, test } from "bun:test";
import { readPackActivation, writePackActivation } from "./packActivation";
import { instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";
test("mock activation revision guard, stopped consent, unknown file refusal and scope isolation",async()=>{
 const scope={instancesRoot:"/synthetic-pack-test",instanceId:"a"};const first=await readPackActivation(scope);
 await expect(writePackActivation(scope,first.revision,["vanilla"],false)).rejects.toThrow("STOP_CONFIRMATION_REQUIRED");
 await expect(writePackActivation(scope,first.revision,["file/absent.zip"],true)).rejects.toThrow("INVALID_PACK");
 const next=await writePackActivation(scope,first.revision,["vanilla","file/Fixture.zip"],true);
 expect(next.resourcePacks).toEqual(["vanilla","file/Fixture.zip"]);
 await expect(writePackActivation(scope,first.revision,["vanilla"],true)).rejects.toThrow("CONFIG_CHANGED");
 expect((await readPackActivation({...scope,instancesRoot:"/other-synthetic-root"})).resourcePacks).toEqual(["vanilla"]);
});
test("activation shares instance lock with launch and content mutations",async()=>{
 const scope={instancesRoot:"/synthetic-lock",instanceId:"a"}; const snapshot=await readPackActivation(scope);
 for(const operation of ["launch","content-install","delete"] as const){
  const release=instanceCoordinator.tryAcquire(instanceMutationKey(scope.instancesRoot,scope.instanceId),operation);
  await expect(writePackActivation(scope,snapshot.revision,["vanilla"],true)).rejects.toThrow("busy");release();
 }
 expect(instanceCoordinator.isBusy(instanceMutationKey(scope.instancesRoot,scope.instanceId))).toBe(false);
});

test("shader mock requires both confirmations, guards revision and scopes runtime",async()=>{
 const {readShaderActivation,writeShaderActivation}=await import("./packActivation");
 const scope={instancesRoot:"/synthetic-shaders",instanceId:"a",runtime:"iris" as const};const first=await readShaderActivation(scope);
 await expect(writeShaderActivation(scope,first.revision,"FixtureShader.zip",true,true,false)).rejects.toThrow("CONFIRMATION_REQUIRED");
 await expect(writeShaderActivation(scope,first.revision,"missing.zip",true,true,true)).rejects.toThrow("INVALID_PACK");
 const value=await writeShaderActivation(scope,first.revision,"FixtureShader.zip",true,true,true);expect(value.enabled).toBe(true);
 await expect(writeShaderActivation(scope,first.revision,null,false,true,true)).rejects.toThrow("CONFIG_CHANGED");
 expect((await readShaderActivation({...scope,runtime:"oculus"})).enabled).toBe(false);
});
