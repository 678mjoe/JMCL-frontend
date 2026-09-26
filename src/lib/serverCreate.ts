import type { CoreSession } from "./rpc";
import type { LoaderFields, ServerManifest, Source } from "./types";

export type LoaderChoice = "none" | "fabric" | "neoforge" | "forge";
export type LoaderCatalogState = "ready" | "loading" | "error";

export async function submitServerCreate({
  session,
  directory,
  id,
  versionId,
  name,
  source,
  loader,
  loaderVersion,
  recordCreated,
  onCreated,
}: {
  session: Pick<CoreSession, "serverCreate">;
  directory: string;
  id: string;
  versionId: string;
  name: string;
  source: Source;
  loader: LoaderChoice;
  loaderVersion: string;
  recordCreated: (server: ServerManifest) => Promise<void>;
  onCreated: (server: ServerManifest) => void;
}): Promise<void> {
  const loaderField: LoaderFields = loader === "fabric"
    ? { fabric_loader: loaderVersion.trim() }
    : loader === "neoforge"
      ? { neoforge_version: loaderVersion.trim() }
      : loader === "forge"
        ? { forge_version: loaderVersion.trim() }
        : {};
  const server = await session.serverCreate(directory, id, versionId, {
    name: name.trim() || id,
    source,
    accept_eula: false,
    ...loaderField,
  });
  await recordCreated(server);
  onCreated(server);
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function deriveServerId(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/([._-])\1+/g, "$1")
    .replace(/^[^a-z0-9]+/, "");
}

export function isValidServerId(id: string): boolean {
  if (!ID_RE.test(id) || id.endsWith(".")) return false;
  if (RESERVED.has(id.split(".", 1)[0])) return false;
  return new TextEncoder().encode(id).length <= 64;
}

export function resetLoaderVersionSelection(loader: LoaderChoice): {
  loaderVersion: string;
  loaderVersions: string[];
  loaderState: LoaderCatalogState;
} {
  return {
    loaderVersion: "",
    loaderVersions: [],
    loaderState: loader === "none" ? "ready" : "loading",
  };
}

export function isLoaderVersionSelectionValid(
  loader: LoaderChoice,
  loaderVersion: string,
  loaderVersions: string[],
  loaderState: LoaderCatalogState,
): boolean {
  return loader === "none" || (
    loaderState === "ready" &&
    loaderVersion.trim().length > 0 &&
    loaderVersions.includes(loaderVersion)
  );
}
