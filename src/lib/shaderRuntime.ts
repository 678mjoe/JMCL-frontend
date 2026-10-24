import { projectVersions, type ModrinthProject, type ModrinthVersion } from "./modrinth";
import type { ContentEntry, LoaderName } from "./types";

/** Verified project identity, not a loader/version compatibility table. See format sources. */
export const SHADER_RUNTIMES: readonly ModrinthProject[] = [
  { project_id: "YL57xq9U", slug: "iris", title: "Iris", description: "Iris shader runtime", author: "IrisShaders", downloads: 0, icon_url: null },
  { project_id: "GchcoXML", slug: "oculus", title: "Oculus", description: "Oculus shader runtime", author: "Asek3", downloads: 0, icon_url: null },
];

export function compatibleRuntimeVersions(versions: ModrinthVersion[], projectId: string, gameVersion: string, loader: LoaderName | null): ModrinthVersion[] {
  if (!loader || !gameVersion) return [];
  return versions.filter(v => v.project_id === projectId
    && Array.isArray(v.game_versions) && v.game_versions.includes(gameVersion)
    && Array.isArray(v.loaders) && v.loaders.includes(loader));
}

export interface RuntimeCandidate { project: ModrinthProject; versions: ModrinthVersion[] }
export async function checkShaderRuntimes(gameVersion: string, loader: LoaderName | null): Promise<RuntimeCandidate[]> {
  if (!loader || !gameVersion) return [];
  return Promise.all(SHADER_RUNTIMES.map(async project => ({ project,
    versions: compatibleRuntimeVersions(await projectVersions(project.project_id, "mods", gameVersion, loader), project.project_id, gameVersion, loader),
  })));
}

/** Only exact provider/project/version identity establishes catalog metadata match. */
export function installedRuntimeMatch(candidate: RuntimeCandidate, entries: ContentEntry[]): "matching" | "disabled" | "unverified" | "absent" {
  const installed = entries.filter(e => e.source.provider === "modrinth" && e.source.project_id === candidate.project.project_id);
  if (!installed.length) return "absent";
  if (installed.length !== 1 || !candidate.versions.some(v => v.id === installed[0].source.version_id)) return "unverified";
  return installed[0].enabled ? "matching" : "disabled";
}
