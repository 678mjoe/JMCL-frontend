/**
 * Modrinth catalog client. Search/browse is a GUI responsibility (contract §1):
 * the GUI talks to directory APIs directly, then hands the chosen
 * provider+project+version to the core via `<kind>.install`.
 *
 * CurseForge uses the separate native-owned credential/catalog bridge.
 */
import { fetch } from "@tauri-apps/plugin-http";
import type { ContentKind, LoaderName } from "./types";
import { isMockTransport } from "./native";

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
  /** Present on Modrinth version responses; absent in legacy/provider adapters. */
  project_id?: string;
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
  if (isMockTransport()) {
    const title = query.trim() || "Sodium";
    return [{ project_id: "AANobbMI", slug: "sodium", title, description: "Mock Modrinth project for browser development", author: "JMCL fixture", downloads: 123456, icon_url: null }];
  }
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
  if (isMockTransport()) {
    return [{ id: "mock-sodium", name: "Sodium mock", version_number: "0.6.0-mock", game_versions: [gameVersion], loaders: loader ? [loader] : [], date_published: "2026-01-01T00:00:00Z" }];
  }
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

/** Server catalog only. Never infer remote paths or pass client install options. */
export type ServerCatalogKind = "mods" | "datapacks";
export function serverSearchUrl(kind: ServerCatalogKind, query: string, gameVersion: string, loader: LoaderName | null): string {
  const facets: string[][] = kind === "mods" ? [["project_type:mod"], [`categories:${loader}`]] : [["categories:datapack"]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  // v2 documents server_side as supported (deprecated in favour of environment).
  // Required/optional deliberately exclude unknown and unsupported client-only hits.
  facets.push(["server_side:required", "server_side:optional"]);
  return `${API_BASE}/search?${new URLSearchParams({ query, limit: "24", index: query.trim() ? "relevance" : "downloads", facets: JSON.stringify(facets) })}`;
}
export function serverVersionsUrl(projectId: string, kind: ServerCatalogKind, gameVersion: string, loader: LoaderName | null): string {
  const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify([kind === "datapacks" ? "datapack" : loader]) });
  return `${API_BASE}/project/${encodeURIComponent(projectId)}/version?${params}`;
}
export function compatibleServerVersions(versions: ModrinthVersion[], kind: ServerCatalogKind, gameVersion: string, loader: LoaderName | null): ModrinthVersion[] {
  const requiredLoader = kind === "datapacks" ? "datapack" : loader;
  return requiredLoader ? versions.filter((version) => version.game_versions.includes(gameVersion) && version.loaders.includes(requiredLoader)) : [];
}
export async function searchServerProjects(kind: ServerCatalogKind, query: string, gameVersion: string, loader: LoaderName | null): Promise<ModrinthProject[]> {
  if (kind === "mods" && !loader) return [];
  if (isMockTransport()) return [{ project_id: `mock-server-${kind}`, slug: `server-${kind}`, title: query.trim() || (kind === "mods" ? "Server Mod fixture" : "Datapack fixture"), description: "Synthetic server-compatible catalog fixture", author: "JMCL fixture", downloads: 42, icon_url: null }];
  return (await getJson<{ hits: ModrinthProject[] }>(serverSearchUrl(kind, query, gameVersion, loader))).hits;
}
export async function serverProjectVersions(projectId: string, kind: ServerCatalogKind, gameVersion: string, loader: LoaderName | null): Promise<ModrinthVersion[]> {
  if (kind === "mods" && !loader) return [];
  if (isMockTransport()) return ["2", "1"].map((number) => ({ id: `mock-${kind}-${number}`, name: `Fixture ${number}`, version_number: number, game_versions: [gameVersion], loaders: [kind === "datapacks" ? "datapack" : loader!], date_published: "2026-01-01T00:00:00Z" }));
  return compatibleServerVersions(await getJson<ModrinthVersion[]>(serverVersionsUrl(projectId, kind, gameVersion, loader)), kind, gameVersion, loader);
}
