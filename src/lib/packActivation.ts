import { invoke } from "@tauri-apps/api/core";
import { isMockTransport } from "./native";
import { instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";

/** Opaque revision: native stores originals, never returns unrelated options. */
export interface PackActivationSnapshot {
  revision: string;
  resourcePacks: string[];
  availableResourcePacks: string[];
}
export interface PackActivationScope { instancesRoot: string; instanceId: string }
const snapshots = new Map<string, PackActivationSnapshot>();
const clone = (value: PackActivationSnapshot): PackActivationSnapshot => ({ ...value, resourcePacks: [...value.resourcePacks], availableResourcePacks: [...value.availableResourcePacks] });
function mockRead(scope: PackActivationScope): PackActivationSnapshot {
  const key = instanceMutationKey(scope.instancesRoot, scope.instanceId);
  if (!snapshots.has(key)) snapshots.set(key, { revision: "mock-0", resourcePacks: ["vanilla"], availableResourcePacks: ["file/Fixture.zip", "file/Overlay.zip"] });
  return clone(snapshots.get(key)!);
}
export async function readPackActivation(scope: PackActivationScope): Promise<PackActivationSnapshot> {
  if (isMockTransport()) return mockRead(scope);
  return invoke("pack_activation_read", scope as unknown as Record<string, unknown>);
}
export async function writePackActivation(scope: PackActivationScope, revision: string, resourcePacks: string[], confirmedStopped: boolean): Promise<PackActivationSnapshot> {
  return instanceCoordinator.run(instanceMutationKey(scope.instancesRoot, scope.instanceId), "pack-activation", async () => {
    if (!confirmedStopped) throw new Error("STOP_CONFIRMATION_REQUIRED");
    if (isMockTransport()) {
      const current = mockRead(scope);
      if (current.revision !== revision) throw new Error("CONFIG_CHANGED");
      if (new Set(resourcePacks).size !== resourcePacks.length || resourcePacks.some(id => !current.availableResourcePacks.includes(id) && !current.resourcePacks.includes(id))) throw new Error("INVALID_PACK");
      const next = { ...current, revision: `mock-${Number(revision.slice(5)) + 1}`, resourcePacks: [...resourcePacks] };
      snapshots.set(instanceMutationKey(scope.instancesRoot, scope.instanceId), next);
      return clone(next);
    }
    return invoke("pack_activation_write", { ...scope, revision, resourcePacks, confirmedStopped });
  });
}

export type ShaderRuntime = "iris" | "oculus";
export interface ShaderActivationScope extends PackActivationScope { runtime: ShaderRuntime }
export interface ShaderActivationSnapshot {
  revision: string;
  runtime: ShaderRuntime;
  shaderPack: string | null;
  enabled: boolean;
  availableShaderPacks: string[];
}
const shaderSnapshots = new Map<string, ShaderActivationSnapshot>();
const shaderKey = (scope: ShaderActivationScope) => `${instanceMutationKey(scope.instancesRoot, scope.instanceId)}\0${scope.runtime}`;
const cloneShader = (value: ShaderActivationSnapshot): ShaderActivationSnapshot => ({...value,availableShaderPacks:[...value.availableShaderPacks]});
export async function readShaderActivation(scope: ShaderActivationScope): Promise<ShaderActivationSnapshot> {
  if (isMockTransport()) {
    const key = shaderKey(scope);
    if (!shaderSnapshots.has(key)) shaderSnapshots.set(key,{revision:"mock-0",runtime:scope.runtime,shaderPack:null,enabled:false,availableShaderPacks:["FixtureShader.zip"]});
    return cloneShader(shaderSnapshots.get(key)!);
  }
  return invoke("shader_activation_read", scope as unknown as Record<string, unknown>);
}
export async function writeShaderActivation(scope: ShaderActivationScope, revision: string, shaderPack: string | null, enabled: boolean, confirmedStopped: boolean, confirmedRuntime: boolean): Promise<ShaderActivationSnapshot> {
  return instanceCoordinator.run(instanceMutationKey(scope.instancesRoot, scope.instanceId), "pack-activation", async () => {
    if (!confirmedStopped || !confirmedRuntime) throw new Error("CONFIRMATION_REQUIRED");
    if (isMockTransport()) {
      const current = await readShaderActivation(scope);
      if (current.revision !== revision) throw new Error("CONFIG_CHANGED");
      if (enabled && (!shaderPack || !current.availableShaderPacks.includes(shaderPack))) throw new Error("INVALID_PACK");
      const next = {...current,revision:`mock-${Number(revision.slice(5)) + 1}`,shaderPack,enabled};
      shaderSnapshots.set(shaderKey(scope),next);
      return cloneShader(next);
    }
    return invoke("shader_activation_write",{...scope,revision,shaderPack,enabled,confirmedStopped,confirmedRuntime});
  });
}
