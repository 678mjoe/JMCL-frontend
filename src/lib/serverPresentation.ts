import type { ServerManifest } from "./types";

export function serverLoaderName(server: ServerManifest, none: string): string {
  if (server.fabric_loader) return `Fabric ${server.fabric_loader}`;
  if (server.neoforge_version) return `NeoForge ${server.neoforge_version}`;
  if (server.forge_version) return `Forge ${server.forge_version}`;
  return none;
}
