import { expect, test } from "bun:test";
import { hasAmbiguousContentProject } from "./contentIdentity";
for (const reversed of [false, true]) test(`project selector collisions independent of registry order (${reversed})`, () => {
  const cf = { source: { provider: "curseforge", project_id: "123", slug: "cf-pack" } };
  const modrinth = { source: { provider: "modrinth", project_id: "other", slug: "123" } };
  const entries = reversed ? [modrinth, cf] : [cf, modrinth];
  expect(hasAmbiguousContentProject(entries, "123")).toBe(true);
  expect(hasAmbiguousContentProject([{ ...modrinth, source: { ...modrinth.source, project_id: "123", slug: "other" } }, cf], "123")).toBe(true);
  expect(hasAmbiguousContentProject([cf], "123")).toBe(false);
  expect(hasAmbiguousContentProject([cf, { source: { provider: "manual", slug: "123" } }], "123")).toBe(false);
});
