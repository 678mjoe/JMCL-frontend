import { fetch } from "@tauri-apps/plugin-http";

export type CatalogLoader = "fabric" | "neoforge" | "forge";

interface FabricLoaderEntry {
  loader?: {
    version?: string;
  };
}

export async function listLoaderVersions(
  loader: CatalogLoader,
  minecraftVersion: string,
): Promise<string[]> {
  if (loader === "fabric") {
    const response = await fetch(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    );
    if (!response.ok) throw new Error(`Fabric metadata: HTTP ${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("Fabric metadata is invalid");
    return payload.flatMap((entry) => {
      const version = (entry as FabricLoaderEntry).loader?.version;
      return typeof version === "string" ? [version] : [];
    });
  }

  if (loader === "neoforge") {
    const response = await fetch(
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
    );
    if (!response.ok) throw new Error(`NeoForge metadata: HTTP ${response.status}`);
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("NeoForge metadata is invalid");
    const parts = minecraftVersion.split(".");
    if (parts[0] !== "1" || !parts[1]) return [];
    const prefix = `${parts[1]}.${parts[2] ?? "0"}.`;
    return Array.from(xml.querySelectorAll("version"))
      .map((node) => node.textContent?.trim() ?? "")
      .filter((version) => version.startsWith(prefix))
      .reverse();
  }

  const response = await fetch(
    "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
  );
  if (!response.ok) throw new Error(`Forge metadata: HTTP ${response.status}`);
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Forge metadata is invalid");
  }
  const entries = (payload as Record<string, unknown>)[minecraftVersion];
  if (!Array.isArray(entries)) return [];
  const prefix = `${minecraftVersion}-`;
  return entries
    .flatMap((entry) =>
      typeof entry === "string" && entry.startsWith(prefix)
        ? [entry.slice(prefix.length)]
        : [],
    )
    .reverse();
}
