import { instanceMutationKey } from "./instanceCoordinator";

/** Frontend-owned preferences, not additional fields in the Core manifest. */
export interface SavedLaunchOptions {
  extra_jvm_args?: string[];
  extra_game_args?: string[];
  resolution_width?: number;
  resolution_height?: number;
  demo?: boolean;
  include_default_user_jvm?: boolean;
}
export interface LaunchOptionsStore { version: 1; instances: Record<string, SavedLaunchOptions> }
export const emptyLaunchOptions = (): LaunchOptionsStore => ({ version: 1, instances: {} });
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const dimension = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 0xffffffff;
const argv = (v: unknown): v is string[] => Array.isArray(v) && v.every(a => typeof a === "string" && !a.includes("\0"));

/** Fail closed on malformed or future fields rather than silently changing launch intent. */
export function parseLaunchOptions(value: unknown): SavedLaunchOptions | null {
  if (!record(value)) return null;
  const allowed = new Set(["extra_jvm_args", "extra_game_args", "resolution_width", "resolution_height", "demo", "include_default_user_jvm"]);
  if (Object.keys(value).some(k => !allowed.has(k))) return null;
  const result: SavedLaunchOptions = {};
  for (const key of ["extra_jvm_args", "extra_game_args"] as const) {
    if (value[key] !== undefined) { if (!argv(value[key])) return null; result[key] = [...value[key]]; }
  }
  for (const key of ["demo", "include_default_user_jvm"] as const) {
    if (value[key] !== undefined) { if (typeof value[key] !== "boolean") return null; result[key] = value[key]; }
  }
  if (value.resolution_width !== undefined || value.resolution_height !== undefined) {
    if (!dimension(value.resolution_width) || !dimension(value.resolution_height)) return null;
    result.resolution_width = value.resolution_width; result.resolution_height = value.resolution_height;
  }
  return result;
}
export function parseLaunchOptionsStore(value: unknown): LaunchOptionsStore {
  const result = emptyLaunchOptions();
  if (!record(value) || value.version !== 1 || !record(value.instances)) return result;
  for (const [key, options] of Object.entries(value.instances)) {
    const parsed = parseLaunchOptions(options);
    if (parsed && key !== "__proto__" && key !== "constructor" && key !== "prototype") result.instances[key] = parsed;
  }
  return result;
}
export function launchOptionsFor(store: LaunchOptionsStore, directory: string, id: string): SavedLaunchOptions {
  return parseLaunchOptions(store.instances[instanceMutationKey(directory, id)]) ?? {};
}
export function withLaunchOptions(store: LaunchOptionsStore, directory: string, id: string, value: SavedLaunchOptions): LaunchOptionsStore {
  const parsed = parseLaunchOptions(value);
  if (!parsed) throw new Error("Invalid launch options");
  return { version: 1, instances: { ...store.instances, [instanceMutationKey(directory, id)]: parsed } };
}
export interface LaunchOptionsDraft { jvm: string; game: string; width: string; height: string; demo: boolean; defaults: boolean }
export function launchOptionsDraft(value: SavedLaunchOptions): LaunchOptionsDraft {
  return { jvm: JSON.stringify(value.extra_jvm_args ?? [], null, 2), game: JSON.stringify(value.extra_game_args ?? [], null, 2), width: value.resolution_width?.toString() ?? "", height: value.resolution_height?.toString() ?? "", demo: value.demo ?? false, defaults: value.include_default_user_jvm ?? true };
}
export function parseLaunchOptionsDraft(draft: LaunchOptionsDraft): SavedLaunchOptions | null {
  try {
    if ((draft.width && !/^[0-9]+$/.test(draft.width)) || (draft.height && !/^[0-9]+$/.test(draft.height))) return null;
    return parseLaunchOptions({ extra_jvm_args: JSON.parse(draft.jvm), extra_game_args: JSON.parse(draft.game), ...(draft.width || draft.height ? { resolution_width: Number(draft.width), resolution_height: Number(draft.height) } : {}), demo: draft.demo, include_default_user_jvm: draft.defaults });
  } catch { return null; }
}
