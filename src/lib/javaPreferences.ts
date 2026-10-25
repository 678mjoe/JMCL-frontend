import { instanceMutationKey } from "./instanceCoordinator";
import type { JavaPolicy } from "./types";

/** Frontend preferences only; legacy ID-only overrides are never applied implicitly. */
export interface JavaPreferences { policy: JavaPolicy; paths?: string[]; override?: string }
export type JavaPreferencesStore = Record<string, JavaPreferences>;
export const absoluteJavaPath = (value: string): boolean => !value.includes("\0") && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));
export function parseJavaPreferences(value: unknown): JavaPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.policy !== "auto" && v.policy !== "local" && v.policy !== "managed") return null;
  if (Object.keys(v).some(k => !["policy", "paths", "override"].includes(k))) return null;
  if (v.override !== undefined && (typeof v.override !== "string" || !absoluteJavaPath(v.override))) return null;
  if (v.paths !== undefined && (!Array.isArray(v.paths) || !v.paths.every(p => typeof p === "string" && absoluteJavaPath(p)))) return null;
  if (v.override !== undefined && v.paths !== undefined) return null;
  return { policy: v.policy, ...(v.override !== undefined ? { override: v.override as string } : {}), ...(v.paths !== undefined ? { paths: [...v.paths as string[]] } : {}) };
}
export function parseJavaPreferencesStore(value: unknown): JavaPreferencesStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, value]) => { const p = parseJavaPreferences(value); return p ? [[key, p]] : []; }));
}
export function javaPreferencesFor(store: JavaPreferencesStore, directory: string, id: string): JavaPreferences {
  return parseJavaPreferences(store[instanceMutationKey(directory, id)]) ?? { policy: "auto" };
}
export function withJavaPreferences(store: JavaPreferencesStore, directory: string, id: string, value: JavaPreferences): JavaPreferencesStore {
  const parsed = parseJavaPreferences(value);
  if (!parsed) throw new Error("Invalid Java preferences");
  return { ...store, [instanceMutationKey(directory, id)]: parsed };
}

/** Installer processors must remain compatible: forced launch overrides never apply. */
export function installationJavaOptions(value?: JavaPreferences): { java_policy?: JavaPolicy; java_paths?: string[] } {
  if (!value) return {};
  return { java_policy: value.policy, ...(value.paths?.length ? { java_paths: [...value.paths] } : {}) };
}
