import { expect, test } from "bun:test";
import { contentEntryTarget } from "./ContentManager";
import { CoreSession } from "@/lib/rpc";
import type { ContentEntry } from "@/lib/types";

test("client enable, disable and removal use exact file selectors for every provider", async () => {
  const calls: unknown[] = [];
  const session = CoreSession.createForTesting(async (method, params) => { calls.push({ method, params }); return {} as never; });
  for (const provider of ["modrinth", "curseforge", "manual"] as const) {
    const entry: ContentEntry = { kind: "mod", file: `mods/${provider}.jar`, sha1: "a".repeat(40), size: 1, enabled: false, as_dependency: false, source: { provider, project_id: provider === "manual" ? undefined : "123", version_id: provider === "manual" ? undefined : "456", slug: provider } };
    const target = contentEntryTarget(entry);
    expect(target).toEqual({ file: entry.file });
    await session.contentEnable("mods", "/fixture", target);
    await session.contentDisable("mods", "/fixture", target);
    await session.contentRemove("mods", "/fixture", target);
  }
  expect(calls).toEqual(["modrinth", "curseforge", "manual"].flatMap(provider => ["enable", "disable", "remove"].map(operation => ({ method: `mods.${operation}`, params: { directory: "/fixture", file: `mods/${provider}.jar` } }))));
  expect(JSON.stringify(calls)).not.toContain('"project"');
});
