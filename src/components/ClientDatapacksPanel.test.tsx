import { afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { CoreSession } from "@/lib/rpc";
import type { ClientDatapackSession } from "@/lib/clientDatapacks";
import type { InstanceManifest, WorldEntry } from "@/lib/types";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ClientDatapacksPanel } = await import("./ClientDatapacksPanel");
let root: Root | undefined;
const spies: { mockRestore: () => void }[] = [];
const instance = { id: "world-ui", version_id: "1.21.4" } as InstanceManifest;
const world = { name: "World A", level_name: "Fixture World", locked: false } as WorldEntry;
const button = (name: string) => [...dom.document.querySelectorAll("button")].find(item => item.textContent?.trim() === name)!;
const click = async (name: string) => { expect(button(name)).toBeTruthy(); await act(async () => button(name).click()); };
const fill = async (label: string, value: string) => { await act(async () => { const element = dom.document.querySelector(`[aria-label="${label}"]`) as unknown as HTMLInputElement; element.value = value; const key = Object.keys(element).find(key => key.startsWith("__reactProps$"))!; (element as unknown as Record<string, { onChange: (event: { target: HTMLInputElement }) => void }>)[key].onChange({ target: element }); }); };
async function setup(overrides: Partial<ClientDatapackSession> = {}, locked = false) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" })); const calls: unknown[][] = [];
  const fixture = { close: async () => {}, worldsGet: async () => ({ world: { ...world, locked } }), datapacksList: async () => ({ stage: "datapacks.list", world: "World A", entries: [{ kind: "datapack", file: "datapacks/fixture.zip", enabled: true, source: { provider: "modrinth", project_id: "fixture", version_id: "old" } }], unmanaged: ["datapacks/manual.zip"] }), ...Object.fromEntries(["Install", "SetVersion", "Enable", "Disable", "Remove", "Adopt"].map(action => [`datapacks${action}`, async (...args: unknown[]) => { calls.push([action, ...args]); return { world: "World A" }; }])), ...overrides } as unknown as CoreSession;
  spies.push(spyOn(CoreSession, "open").mockImplementation(async () => fixture));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  const render = async (name = "World A", directory = "/instances/a/.minecraft") => { await act(async () => root!.render(<SettingsProvider><ClientDatapacksPanel instance={instance} world={{ ...world, name, locked }} directory={directory} /></SettingsProvider>)); };
  await render(); await click("Load / refresh content"); return { calls, render };
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; for (const spy of spies.splice(0)) spy.mockRestore(); dom.document.body.replaceChildren(); localStorage.clear(); });
test("world panel toggle, adopt, confirmation use exact world file identity", async () => {
  const { calls } = await setup(); expect(dom.document.body.textContent).toContain("datapacks/manual.zip");
  await click("Disable"); expect(calls[0]).toEqual(["Disable", "/instances/a/.minecraft", "World A", { file: "datapacks/fixture.zip" }]);
  await click("Adopt unmanaged files"); expect(calls[1]?.[0]).toBe("Adopt"); await click("Remove"); expect(button("Confirm removal").disabled).toBe(true);
  await fill("Type file name to confirm removal", "fixture.zip"); expect(button("Confirm removal").disabled).toBe(true);
  await fill("Type file name to confirm removal", "datapacks/fixture.zip"); await click("Confirm removal"); expect(calls[2]).toEqual(["Remove", "/instances/a/.minecraft", "World A", { file: "datapacks/fixture.zip" }]);
});
test("locked world remains readable but all mutation controls disabled", async () => {
  await setup({}, true); expect(dom.document.body.textContent).toContain("datapacks/fixture.zip"); for (const name of ["Disable", "Remove", "Adopt unmanaged files", "Search Modrinth", "Choose version"]) expect(button(name).disabled).toBe(true);
});
test("cancel clears pending selection and scope changes remove stale content and confirmation", async () => {
  const { calls, render } = await setup(); await click("Remove"); await fill("Type file name to confirm removal", "datapacks/fixture.zip"); await click("Cancel / clear selection"); expect(button("Confirm removal")).toBeUndefined(); expect(calls).toHaveLength(0);
  await click("Load / refresh content"); await click("Remove"); await render("Other World"); expect(button("Confirm removal")).toBeUndefined(); expect(dom.document.body.textContent).not.toContain("datapacks/fixture.zip"); expect(button("Search Modrinth").disabled).toBe(true);
});
test("Modrinth search and version switching work in synthetic catalog; Back removes versions", async () => {
  const { calls } = await setup(); await click("Choose version"); await click("Switch version"); expect(calls[0]?.slice(0, 6)).toEqual(["SetVersion", "/instances/a/.minecraft", "World A", "1.21.4", "fixture", "mock-client-datapack-2"]);
  await click("Back to search"); expect(button("Switch version")).toBeUndefined(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  await click("World datapack fixtureSynthetic compatible datapack"); await click("Install"); expect(calls[1]?.[0]).toBe("Install");
});
test("pending repeated clicks cannot duplicate writes; changing world ignores late success", async () => {
  let resolve!: (value: unknown) => void; let writes = 0, closes = 0;
  const pending = new Promise(resolvePromise => { resolve = resolvePromise; });
  const { render } = await setup({ close: async () => { closes++; }, datapacksAdopt: async () => { writes++; return await pending as never; } });
  await click("Adopt unmanaged files"); expect(button("Adopt unmanaged files").disabled).toBe(true);
  await click("Adopt unmanaged files"); expect(writes).toBe(1);
  await render("New World"); expect(dom.document.body.textContent).not.toContain("datapacks/fixture.zip");
  await act(async () => { resolve({ world: "World A" }); await pending; });
  expect(dom.document.body.textContent).not.toContain("Operation completed."); expect(button("Search Modrinth").disabled).toBe(true); expect(closes).toBe(2);
});
test("cancel while catalog is debouncing cannot reopen results", async () => {
  await setup(); await click("Search Modrinth"); await fill("Search compatible datapacks", "Late project"); await click("Cancel / clear selection");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  expect(dom.document.body.textContent).not.toContain("Late project"); expect(dom.document.querySelector('[aria-label="Search compatible datapacks"]')).toBeNull();
});
test("CurseForge world search keeps provider identity and blocks restricted downloads", async () => {
  const cf = await import("@/lib/curseforge");
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockResolvedValue([{ project_id: "123", slug: "fixture", title: "CF fixture", available: true, author: "", description: "Synthetic", downloads: 0, icon_url: null }]));
  spies.push(spyOn(cf, "curseForgeVersions").mockResolvedValue([
    { id: "456", name: "Allowed", version_number: "456", game_versions: ["1.21.4"], loaders: [], date_published: "2026-01-01", available: true },
    { id: "455", name: "Restricted", version_number: "455", game_versions: ["1.21.4"], loaders: [], date_published: "2026-01-01", available: false },
  ]));
  const { calls } = await setup({ datapacksList: async () => ({ stage: "datapacks.list", world: "World A", entries: [{ kind: "datapack", file: "datapacks/collision.zip", enabled: true, source: { provider: "modrinth", project_id: "123", version_id: "old" } }], unmanaged: [] }) as never });
  await click("Search CurseForge");
  expect(dom.document.body.textContent).toContain("Settings → CurseForge");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  await click("CF fixtureSynthetic");
  expect(button("Author has disabled third-party downloads").disabled).toBe(true);
  expect(button("Switch version")).toBeUndefined();
  await click("Install");
  expect(calls[0]?.[5]).toMatchObject({ provider: "curseforge", version_id: "456" });
  expect(JSON.stringify(calls)).not.toContain("api_key");
});
test("CurseForge provider navigation drops a pending catalog response", async () => {
  const cf = await import("@/lib/curseforge");
  let resolve!: (value: Awaited<ReturnType<typeof cf.searchCurseForgeProjects>>) => void;
  spies.push(spyOn(cf, "searchCurseForgeProjects").mockImplementation(() => new Promise(done => { resolve = done; })));
  await setup(); await click("Search CurseForge");
  await act(async () => { await new Promise(done => setTimeout(done, 300)); });
  await click("Search Modrinth");
  await act(async () => resolve([{ project_id: "123", title: "Stale CF result", available: true, slug: "late", description: "", author: "", downloads: 0, icon_url: null }]));
  expect(dom.document.body.textContent).not.toContain("Stale CF result");
});
for (const reverse of [false, true]) test(`world datapacks block ambiguous cross-provider ID/slug selector (${reverse})`, async () => {
  const cf = await import("@/lib/curseforge");
  spies.push(spyOn(cf, "curseForgeVersions").mockResolvedValue([{ id: "456", name: "Allowed", version_number: "456", game_versions: ["1.21.4"], loaders: [], date_published: "2026-01-01", available: true }]));
  const entries = [{ kind: "datapack", file: "datapacks/cf.zip", enabled: true, source: { provider: "curseforge", project_id: "123", version_id: "454" } }, { kind: "datapack", file: "datapacks/modrinth.zip", enabled: true, source: { provider: "modrinth", project_id: "other", slug: "123", version_id: "old" } }];
  const { calls } = await setup({ datapacksList: async () => ({ stage: "datapacks.list", world: "World A", entries: reverse ? entries.reverse() : entries, unmanaged: [] }) as never });
  const row = [...dom.document.querySelectorAll("article")].find(el => el.textContent?.includes("datapacks/cf.zip"))!;
  await act(async () => (row.querySelector("button") as unknown as HTMLButtonElement).click());
  expect(button("Switch version").disabled).toBe(true); expect(dom.document.body.textContent).toContain("version switching is unsafe");
  await click("Switch version"); expect(calls).toHaveLength(0);
});
