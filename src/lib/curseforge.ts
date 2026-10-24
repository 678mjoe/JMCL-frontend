/** Native-owned credential custody and fixed-host CurseForge metadata only.
 * No API key getter, JS persistence, CDN derivation, or download implementation.
 */
import { invoke } from "@tauri-apps/api/core";
import { isMockTransport } from "./transportMode";
import type { ContentKind, LoaderName } from "./types";
import type { ModrinthProject, ModrinthVersion } from "./modrinth";
export type CurseForgeKind = ContentKind | "datapacks";
export type CurseForgeProject = ModrinthProject & { available: boolean };
export type CurseForgeVersion = ModrinthVersion & { available: boolean };
const classes: Record<CurseForgeKind, number> = { mods: 6, resourcepacks: 12, shaderpacks: 6552, datapacks: 5290 };
const loaders: Record<LoaderName, number> = { forge: 1, fabric: 4, neoforge: 6 };
const loaderTags: Record<LoaderName, string> = { forge: "Forge", fabric: "Fabric", neoforge: "NeoForge" };
let mockConfigured = false; // Synthetic presence only, never the entered secret.
export const validCurseForgeKey = (key: string) => /^[\x21-\x7e]{1,512}$/.test(key);
export async function curseForgeKeyStatus(): Promise<boolean> {
  return isMockTransport() ? mockConfigured : invoke<boolean>("curseforge_key_status");
}
export async function setCurseForgeKey(apiKey: string): Promise<void> {
  if (!validCurseForgeKey(apiKey)) throw new Error("Use 1–512 printable ASCII characters without spaces");
  if (isMockTransport()) { mockConfigured = true; return; }
  try { await invoke("curseforge_key_set", { apiKey }); }
  catch { throw new Error("Could not store the CurseForge key in the OS credential store"); }
}
export async function deleteCurseForgeKey(): Promise<void> {
  if (isMockTransport()) { mockConfigured = false; return; }
  try { await invoke("curseforge_key_delete"); }
  catch { throw new Error("Could not remove the CurseForge key from the OS credential store"); }
}
const numericId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";
export function mapCurseForgeProjects(raw: unknown, kind: CurseForgeKind): CurseForgeProject[] {
  const data = record(raw).data;
  if (!Array.isArray(data)) throw new Error("Invalid CurseForge catalog response");
  return data.flatMap(value => {
    const p = record(value);
    if (!numericId(p.id) || p.gameId !== 432 || p.classId !== classes[kind]) return [];
    return [{ project_id: String(p.id), slug: string(p.slug), title: string(p.name), description: string(p.summary),
      author: Array.isArray(p.authors) ? p.authors.map(a => string(record(a).name)).filter(Boolean).join(", ") : "",
      downloads: typeof p.downloadCount === "number" && Number.isFinite(p.downloadCount) ? Math.max(0, p.downloadCount) : 0,
      // No extra catalog-image hosts or webview network permissions are needed.
      icon_url: null, available: p.isAvailable !== false && p.allowModDistribution !== false }];
  });
}
export function mapCurseForgeVersions(raw: unknown, projectId: string, kind: CurseForgeKind, gameVersion: string, loader: LoaderName | null): CurseForgeVersion[] {
  const data = record(raw).data;
  if (!Array.isArray(data)) throw new Error("Invalid CurseForge file response");
  return data.flatMap(value => {
    const f = record(value);
    const tags = Array.isArray(f.gameVersions) ? f.gameVersions.filter((v): v is string => typeof v === "string") : [];
    if (!numericId(f.id) || String(f.modId) !== projectId || !tags.includes(gameVersion) || (kind === "mods" && (!loader || !tags.includes(loaderTags[loader])))) return [];
    const downloadable = f.downloadAvailable === true;
    return [{ id: String(f.id), name: string(f.displayName) || string(f.fileName), version_number: string(f.displayName) || string(f.fileName),
      game_versions: tags, loaders: loader ? [loader] : [], date_published: string(f.fileDate), available: f.isAvailable !== false && downloadable }];
  }).sort((a, b) => b.date_published.localeCompare(a.date_published));
}
export interface CatalogRequest { kind: "search" | "files"; class_id: number; game_version: string; loader?: number; project_id?: string; query?: string; index: number; page_size: number }
export function curseForgeCatalogRequest(kind: CurseForgeKind, gameVersion: string, loader: LoaderName | null, projectId?: string, query = "", index = 0): CatalogRequest {
  if (!gameVersion || gameVersion.length > 100 || query.length > 256 || /[\x00-\x1f\x7f]/.test(gameVersion + query) || !Number.isInteger(index) || index < 0 || index + 50 > 10000) throw new Error("Invalid CurseForge catalog filters");
  if (projectId !== undefined && (!/^[1-9][0-9]*$/.test(projectId) || !numericId(Number(projectId)))) throw new Error("Invalid CurseForge project ID");
  return { kind: projectId ? "files" : "search", class_id: classes[kind], game_version: gameVersion,
    ...(kind === "mods" && loader ? { loader: loaders[loader] } : {}), ...(projectId ? { project_id: projectId } : { query }), index, page_size: 50 };
}
async function catalog(request: ReturnType<typeof curseForgeCatalogRequest>): Promise<unknown> {
  if (isMockTransport()) {
    if (!mockConfigured) throw new Error("Save an API key in Settings → CurseForge first");
    if (request.kind === "search") return { data: [{ id: 123, gameId: 432, classId: request.class_id, name: "CurseForge fixture", summary: "Synthetic catalog only", allowModDistribution: true }] };
    return { data: [2, 1].map(id => ({ id, modId: Number(request.project_id), displayName: `Fixture ${id}`, gameVersions: [request.game_version, ...(request.loader ? [Object.entries(loaders).find(([, value]) => value === request.loader)![0]].map(name => loaderTags[name as LoaderName]) : [])], isAvailable: true, downloadAvailable: true, fileDate: `2026-01-0${id}T00:00:00Z` })) };
  }
  try { return await invoke("curseforge_catalog", { request }); }
  catch { throw new Error("CurseForge catalog unavailable. Check the key in Settings → CurseForge and try again"); }
}
export async function searchCurseForgeProjects(kind: CurseForgeKind, query: string, gameVersion: string, loader: LoaderName | null): Promise<CurseForgeProject[]> {
  if (kind === "mods" && !loader) return [];
  return mapCurseForgeProjects(await catalog(curseForgeCatalogRequest(kind, gameVersion, loader, undefined, query)), kind);
}
export async function curseForgeVersions(projectId: string, kind: CurseForgeKind, gameVersion: string, loader: LoaderName | null): Promise<CurseForgeVersion[]> {
  if (kind === "mods" && !loader) return [];
  // Bounded paging: UI explicitly labels the first 500 compatible files.
  const versions: CurseForgeVersion[] = [];
  for (let index = 0; index < 500; index += 50) {
    const raw = await catalog(curseForgeCatalogRequest(kind, gameVersion, loader, projectId, "", index));
    versions.push(...mapCurseForgeVersions(raw, projectId, kind, gameVersion, loader));
    const data = record(raw).data;
    if (!Array.isArray(data) || data.length < 50) break;
  }
  return [...new Map(versions.map(v => [v.id, v])).values()].sort((a,b) => b.date_published.localeCompare(a.date_published));
}
