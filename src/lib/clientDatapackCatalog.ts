import { fetch } from "@tauri-apps/plugin-http";
import { isMockTransport } from "./native";
import type { ModrinthProject, ModrinthVersion } from "./modrinth";
const base = "https://api.modrinth.com/v2";
export function datapackSearchUrl(query: string, version: string) {
  return `${base}/search?${new URLSearchParams({ query, limit: "24", index: query.trim() ? "relevance" : "downloads", facets: JSON.stringify([["categories:datapack"], [`versions:${version}`]]) })}`;
}
export function datapackVersionsUrl(project: string, version: string) {
  return `${base}/project/${encodeURIComponent(project)}/version?${new URLSearchParams({ game_versions: JSON.stringify([version]), loaders: JSON.stringify(["datapack"]) })}`;
}
export function compatibleDatapackVersions(versions: ModrinthVersion[], game: string) {
  return versions.filter(version => version.game_versions.includes(game) && version.loaders.includes("datapack"));
}
async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "mjoe/jmcl (github.com/jmcl-launcher)" } });
  if (!response.ok) throw new Error("Catalog request failed");
  return await response.json() as T;
}
export async function searchDatapackProjects(query: string, version: string): Promise<ModrinthProject[]> {
  if (isMockTransport()) return [{ project_id: "mock-client-datapack", slug: "fixture", title: query.trim() || "World datapack fixture", description: "Synthetic compatible datapack", author: "JMCL fixture", downloads: 42, icon_url: null }];
  return (await get<{ hits: ModrinthProject[] }>(datapackSearchUrl(query, version))).hits;
}
export async function datapackProjectVersions(project: string, game: string): Promise<ModrinthVersion[]> {
  if (isMockTransport()) return ["2", "1"].map(number => ({ id: `mock-client-datapack-${number}`, name: `Fixture ${number}`, version_number: number, game_versions: [game], loaders: ["datapack"], date_published: "2026-01-01T00:00:00Z" }));
  return compatibleDatapackVersions(await get<ModrinthVersion[]>(datapackVersionsUrl(project, game)), game);
}
