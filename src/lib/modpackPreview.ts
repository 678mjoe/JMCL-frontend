import { invoke } from "@tauri-apps/api/core";
import { isMockTransport } from "./transportMode";

/** Local manifest information only, not full archive validation or an install plan. */
export interface ModpackPreview {
  provider: "modrinth" | "curseforge";
  name: string;
  version: string | null;
  minecraft_version: string;
  loader: { kind: "fabric" | "forge" | "neoforge"; version: string } | null;
  /** Manifest references only; excludes overrides and is not a disk estimate. */
  files_declared: number;
  /** CurseForge optional references, not a prediction of all skipped files. */
  files_optional: number | null;
}
export const modpackPreviewErrorCodes = [
  "MODPACK_PREVIEW_READ_FAILED", "MODPACK_PREVIEW_INVALID", "MODPACK_PREVIEW_LIMIT",
  "MODPACK_PREVIEW_UNSUPPORTED", "MODPACK_PREVIEW_UNKNOWN_FORMAT", "MODPACK_PREVIEW_AMBIGUOUS",
  "MODPACK_PREVIEW_UNSUPPORTED_LOADER", "MODPACK_PREVIEW_LOADER_CONFLICT",
] as const;
export type ModpackPreviewErrorCode = typeof modpackPreviewErrorCodes[number];
export function modpackPreviewErrorCode(error: unknown): ModpackPreviewErrorCode {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && (modpackPreviewErrorCodes as readonly string[]).includes(code)
    ? code as ModpackPreviewErrorCode : "MODPACK_PREVIEW_READ_FAILED";
}
function fail(): never { throw { code: "MODPACK_PREVIEW_INVALID" }; }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail();
  return value;
}
function version(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._+-]{1,64}$/.test(value)) fail();
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 4096) fail();
  return value;
}
export function parseModpackPreview(value: unknown): ModpackPreview {
  const data = record(value);
  if (data.provider !== "modrinth" && data.provider !== "curseforge") fail();
  let loader: ModpackPreview["loader"] = null;
  if (data.loader !== null) {
    const raw = record(data.loader);
    if (raw.kind !== "fabric" && raw.kind !== "forge" && raw.kind !== "neoforge") fail();
    loader = { kind: raw.kind, version: version(raw.version) };
  }
  const files = count(data.files_declared);
  const optional = data.files_optional === null ? null : count(data.files_optional);
  if (optional !== null && optional > files) fail();
  if (data.provider === "modrinth" && optional !== null) fail();
  return {
    provider: data.provider,
    name: text(data.name),
    version: data.version === null ? null : text(data.version),
    minecraft_version: version(data.minecraft_version),
    loader, files_declared: files, files_optional: optional,
  };
}
export async function previewModpack(file: string): Promise<ModpackPreview> {
  if (!file) fail();
  if (isMockTransport()) {
    // Browser fixtures do not read the local filesystem and are not native acceptance.
    const curseforge = file.toLowerCase().endsWith(".zip");
    return parseModpackPreview({
      provider: curseforge ? "curseforge" : "modrinth",
      name: curseforge ? "Synthetic CurseForge Pack" : "Synthetic Modrinth Pack",
      version: "1.0.0", minecraft_version: "1.21.4",
      loader: /fabric/i.test(file) ? { kind: "fabric", version: "0.16.10" } : null,
      files_declared: 4, files_optional: curseforge ? 0 : null,
    });
  }
  return parseModpackPreview(await invoke<unknown>("modpack_preview", { file }));
}
