import type { JavaPreferences } from "./javaPreferences";
import type { InstanceManifest, LaunchOptions } from "./types";
import type { LaunchExecuteOptions } from "./rpc";

/** Shared by launch and preview so the chosen instance's loader/Java cannot drift. */
export function instanceLaunchOptions(
  instance: InstanceManifest, storeDirectory: string,
  javaOverride?: JavaPreferences | string | null, options: LaunchOptions = {},
): LaunchExecuteOptions {
  return {
    source: instance.source,
    store_directory: storeDirectory,
    ...(instance.fabric_loader ? { fabric_loader: instance.fabric_loader } :
      instance.neoforge_version ? { neoforge_version: instance.neoforge_version } :
      instance.forge_version ? { forge_version: instance.forge_version } : {}),
    ...(typeof javaOverride === "string" ? { java_override: javaOverride } : javaOverride ? { java_policy: javaOverride.policy, ...(javaOverride.override ? { java_override: javaOverride.override } : javaOverride.paths?.length ? { java_paths: [...javaOverride.paths] } : {}) } : {}),
    options,
  };
}
