/**
 * Modrinth catalog client. Search/browse is a GUI responsibility (contract §1):
 * the GUI talks to directory APIs directly, then hands the chosen
 * provider+project+version to the core via `<kind>.install`.
 *
 * CurseForge needs a caller-supplied API key and is not wired yet.
 */
import { fetch } from "@tauri-apps/plugin-http";
import type { ContentKind, LoaderName } from "./types";

const API_BASE = "https://api.modrinth.com/v2";
/** Modrinth API rules ask for an identifying User-Agent. */
const USER_AGENT = "mjoe/jmcl (github.com/jmcl-launcher)";

const PROJECT_TYPE: Record<ContentKind, string> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaderpacks: "shader",
};

export interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string | null;
}

export interface ModrinthVersion {
  id: string;
  /** Display name, e.g. "Sodium 0.6.13". */
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Modrinth ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Search the catalog, filtered to the instance's game version. Mods are also
 * filtered by the instance loader; resource packs and shaders are
 * loader-agnostic. Empty query browses by download count.
 */
export async function searchProjects(
  kind: ContentKind,
  query: string,
  gameVersion: string,
  loader: LoaderName | null,
): Promise<ModrinthProject[]> {
  const facets: string[][] = [[`project_type:${PROJECT_TYPE[kind]}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (kind === "mods" && loader) facets.push([`categories:${loader}`]);
  const params = new URLSearchParams({
    query,
    limit: "24",
    index: query.trim() ? "relevance" : "downloads",
    facets: JSON.stringify(facets),
  });
  const data = await getJson<{ hits: ModrinthProject[] }>(
    `${API_BASE}/search?${params}`,
  );
  return data.hits;
}

/**
 * Compatible versions of one project, newest first (Modrinth's default
 * ordering). Returns every matching version so the UI can offer downgrade as
 * well as upgrade.
 */
export async function projectVersions(
  projectId: string,
  kind: ContentKind,
  gameVersion: string,
  loader: LoaderName | null,
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
  if (kind === "mods" && loader) {
    params.set("loaders", JSON.stringify([loader]));
  }
  const query = params.toString();
  return getJson<ModrinthVersion[]>(
    `${API_BASE}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ""}`,
  );
}
