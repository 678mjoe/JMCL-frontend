import { afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { LauncherContext } from "@/lib/launcher";
import type { CoreSession } from "@/lib/rpc";
import type { ContentEntry, InstanceManifest } from "@/lib/types";
import * as cf from "@/lib/curseforge";
import * as modrinth from "@/lib/modrinth";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, MutationObserver: dom.MutationObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ContentSearchDialog } = await import("./ContentSearchDialog");
let root: Root | undefined;
const spies: { mockRestore: () => void }[] = [];
const button = (text: string) => [...dom.document.querySelectorAll("button")].find(b => b.textContent?.trim() === text)!;
const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()); };
async function change(selector: string, value: string) {
  await act(async () => {
    const element = dom.document.querySelector(selector) as unknown as HTMLInputElement; element.value = value;
    element.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
  });
}
const project = { project_id: "123", title: "CF fixture", slug: "fixture", author: "", description: "Synthetic", downloads: 0, icon_url: null, available: true };
const version = { id: "456", name: "Allowed", version_number: "456", game_versions: ["1.21.4"], loaders: ["fabric"], date_published: "2026-01-01", available: true };
const instance = { id: "content-fixture", version_id: "1.21.4", fabric_loader: "0.16.10" } as InstanceManifest;
async function setup(entries: ContentEntry[] = [], session = { close: async () => {} } as CoreSession) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", instancesDir: "/fixture", storeDir: "/store" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  let changed = 0; let open = true;
  const render = async () => { await act(async () => root!.render(<SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: null, error: null, session, openSession: async () => session }}><ContentSearchDialog kind="mods" instance={instance} entries={entries} open={open} onOpenChange={value => { open = value; }} onChanged={() => { changed++; }} /></LauncherContext.Provider></SettingsProvider>)); };
  await render(); await change('[aria-label="Catalog provider"]', "curseforge");
  return { render, close: () => { open = false; }, changes: () => changed };
}
const waitSearch = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; for (const spy of spies.splice(0)) spy.mockRestore(); dom.document.body.replaceChildren(); localStorage.clear(); });
test("client content provider identity, restricted versions and repeated click guard", async () => {
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockResolvedValue([project]));
  spies.push(spyOn(cf, "curseForgeVersions").mockResolvedValue([version, { ...version, id: "455", available: false }]));
  let finish!: () => void; const calls: unknown[][] = [];
  const session = { close: async () => {}, contentInstall: async (...args: unknown[]) => { calls.push(args); await new Promise<void>(resolve => { finish = resolve; }); }, contentSetVersion: async () => { throw new Error("wrong provider collision"); } } as unknown as CoreSession;
  const ui = await setup([{ source: { provider: "modrinth", project_id: "123", version_id: "456" } } as ContentEntry], session);
  await waitSearch(); const row = [...dom.document.querySelectorAll("button")].find(b => b.textContent?.startsWith("CF fixture"))!; await act(async () => row.click());
  expect(button("Third-party download unavailable").disabled).toBe(true);
  await act(async () => { button("Install").click(); button("Install").click(); });
  expect(calls).toHaveLength(1); expect(calls[0]?.[4]).toMatchObject({ provider: "curseforge", version_id: "456" });
  expect((dom.document.querySelector('[aria-label="Catalog provider"]') as unknown as HTMLSelectElement).disabled).toBe(true);
  await act(async () => finish()); expect(ui.changes()).toBe(1); expect(JSON.stringify(calls)).not.toContain("api_key");
});
test("client content installed CF versions send native key intent", async () => {
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockResolvedValue([project])); spies.push(spyOn(cf, "curseForgeVersions").mockResolvedValue([version]));
  const calls: unknown[][] = [];
  const session = { close: async () => {}, contentSetVersion: async (...args: unknown[]) => { calls.push(args); } } as unknown as CoreSession;
  await setup([{ source: { provider: "curseforge", project_id: "123", version_id: "454" } } as ContentEntry], session);
  await waitSearch(); const row = [...dom.document.querySelectorAll("button")].find(b => b.textContent?.startsWith("CF fixture"))!; await act(async () => row.click());
  await click("Switch version"); expect(calls[0]?.[5]).toMatchObject({ provider: "curseforge" });
});
test("late CF results cannot overwrite newer provider or closed dialog", async () => {
  let finish!: (value: typeof project[]) => void;
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockImplementation(() => new Promise(resolve => { finish = resolve; })));
  const ui = await setup(); await waitSearch(); await change('[aria-label="Catalog provider"]', "modrinth");
  await act(async () => finish([{ ...project, title: "Stale CF" }]));
  expect(dom.document.body.textContent).not.toContain("Stale CF");
  ui.close(); await ui.render(); await waitSearch(); expect(dom.document.body.textContent).not.toContain("Stale CF");
});
for (const reverse of [false, true]) test(`client content blocks ambiguous cross-provider ID/slug selector (${reverse})`, async () => {
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockResolvedValue([project])); spies.push(spyOn(cf, "curseForgeVersions").mockResolvedValue([version]));
  const entries = [{ source: { provider: "curseforge", project_id: "123", version_id: "454" } }, { source: { provider: "modrinth", project_id: "other", slug: "123", version_id: "old" } }] as ContentEntry[];
  let calls = 0;
  await setup(reverse ? entries.reverse() : entries, { close: async () => {}, contentSetVersion: async () => { calls++; } } as unknown as CoreSession);
  await waitSearch(); const row = [...dom.document.querySelectorAll("button")].find(b => b.textContent?.startsWith("CF fixture"))!; await act(async () => row.click());
  expect(button("Switch version").disabled).toBe(true); expect(dom.document.body.textContent).toContain("version switching is unsafe");
  await click("Switch version"); expect(calls).toBe(0);
});

test("explicit runtime project opens version selection and rejects mismatched catalog metadata", async () => {
  const runtimeProject = { ...project, project_id: "YL57xq9U", title: "Iris runtime" };
  spies.push(spyOn(modrinth, "projectVersions").mockResolvedValue([
    { ...version, id: "valid", project_id: "YL57xq9U" },
    { ...version, id: "wrong-project", project_id: "other" },
    { ...version, id: "wrong-loader", project_id: "YL57xq9U", loaders: ["forge"] },
    { ...version, id: "wrong-game", project_id: "YL57xq9U", game_versions: ["1.20.1"] },
  ] as modrinth.ModrinthVersion[]));
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", instancesDir: "/fixture", storeDir: "/store" }));
  const calls: unknown[][] = [];
  const session = { close: async () => {}, contentInstall: async (...args: unknown[]) => { calls.push(args); } } as unknown as CoreSession;
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: null, error: null, session, openSession: async () => session }}><ContentSearchDialog kind="mods" instance={instance} entries={[]} open initialProject={runtimeProject} onOpenChange={() => {}} onChanged={() => {}} /></LauncherContext.Provider></SettingsProvider>));
  expect(calls).toHaveLength(0);
  expect([...dom.document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Install")).toHaveLength(1);
  expect((dom.document.querySelector('[aria-label="Catalog provider"]') as unknown as HTMLSelectElement).disabled).toBe(true);
  await click("Install");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[3]).toBe("YL57xq9U");
  expect(calls[0]?.[4]).toMatchObject({provider:"modrinth",version_id:"valid",loader:"fabric"});
});
