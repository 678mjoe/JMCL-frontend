import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { LauncherContext } from "@/lib/launcher";
import { ModpackTasksProvider, useModpackTasks } from "@/lib/modpackTasks";
import type { CoreSession } from "@/lib/rpc";
import type { ModpackPreview } from "@/lib/modpackPreview";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, MutationObserver: dom.MutationObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ModpackImportDialog } = await import("./ModpackImportDialog");
let root: Root | undefined;
const button = (text: string) => [...dom.document.querySelectorAll("button")].find(b => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const fill = async (selector: string, value: string) => { await act(async () => { const input = dom.document.querySelector(selector) as unknown as HTMLInputElement; input.value = value; const key = Object.getOwnPropertyNames(input).find(k => k.startsWith("__reactProps$"))!; (input as unknown as Record<string, { onChange: (e: { target: HTMLInputElement; currentTarget: HTMLInputElement; nativeEvent: object }) => void }>)[key].onChange({ target: input, currentTarget: input, nativeEvent: {} }); }); };
const metadata: ModpackPreview = { provider: "modrinth", name: "Demo Pack", version: "1.0", minecraft_version: "1.21.4", loader: null, files_declared: 2, files_optional: null };
let jobs: ReturnType<typeof useModpackTasks>;
function Controls() { jobs = useModpackTasks(); return <><button onClick={() => jobs.show()}>New import</button>{jobs.registry.list().map(t => <button key={t.key} onClick={() => jobs.show(t.key)}>Reopen {t.controller.input.id}</button>)}</>; }
async function setup(options: { picker?: () => Promise<string | null>; session?: CoreSession; preview?: (file: string) => Promise<ModpackPreview>; keyStatus?: () => Promise<boolean> } = {}) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", instancesDir: "/fixture", storeDir: "/store" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  const session = options.session ?? {} as CoreSession; let opens = 0; let settings = 0; let opened = "";
  await act(async () => root!.render(<SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: null, error: null, session, openSession: async () => { opens++; return session; } }}><ModpackTasksProvider><Controls /><ModpackImportDialog onOpenSettings={() => { settings++; }} onOpenInstance={id => { opened = id; }} pickArchive={options.picker ?? (async () => "/fixture/demo.mrpack")} inspectArchive={options.preview ?? (async () => metadata)} keyStatus={options.keyStatus ?? (async () => false)} /></ModpackTasksProvider></LauncherContext.Provider></SettingsProvider>));
  await click("New import"); return { getOpens: () => opens, getSettings: () => settings, getOpened: () => opened };
}
const result = { id: "demo-pack", name: "Demo Pack", version_id: "1.21.4", loader: null, files_installed: 2, files_skipped: 1, overrides_written: 1 };
function goodSession(extra: Record<string, unknown> = {}) { return { instanceList: async () => ({ instances: [] }), modpackInstall: async () => result, instanceGet: async () => ({ id: "demo-pack", name: "Demo Pack", version_id: "1.21.4", source: "official" }), installExecute: async () => ({}), installPrepare: async () => ({}), close: async () => {}, ...extra } as unknown as CoreSession; }
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("modpack import application-owned flow", () => {
  test("preview suggests ID and confirms exact version and target before submission", async () => {
    const ui = await setup(); expect(button("Confirm and install").disabled).toBe(true); await click("Choose archive");
    expect((dom.document.querySelector("#pack-instance-id") as unknown as HTMLInputElement).value).toBe("demo-pack");
    expect(dom.document.body.textContent).toContain("Minecraft 1.21.4"); expect(dom.document.body.textContent).toContain("/fixture/demo-pack"); expect(ui.getOpens()).toBe(0);
  });
  test("background close/reopen keeps active controller and submits only once", async () => {
    let finish!: () => void; let imports = 0;
    const ui = await setup({ session: goodSession({ modpackInstall: async () => { imports++; await new Promise<void>(r => { finish = r; }); return result; } }) });
    await click("Choose archive"); await act(async () => { button("Confirm and install").click(); button("Confirm and install")?.click(); });
    expect(imports).toBe(1); await click("Continue in background"); expect(jobs.open).toBe(false);
    await click("Reopen demo-pack"); expect(dom.document.body.textContent).toContain("Importing pack files");
    await act(async () => finish()); expect(dom.document.body.textContent).toContain("Skipped"); expect(dom.document.body.textContent).toContain("Ready to open");
    await click("Open instance"); expect(ui.getOpened()).toBe("demo-pack"); expect(imports).toBe(1);
  });
  test("settings detour preserves archive and ID; missing key never submits", async () => {
    let saved = false;
    const ui = await setup({ preview: async () => ({ ...metadata, provider: "curseforge", files_optional: 1 }), keyStatus: async () => saved });
    await click("Choose archive"); await fill("#pack-instance-id", "custom"); expect(button("Confirm and install").disabled).toBe(true);
    await click("Open Settings"); expect(ui.getSettings()).toBe(1); saved = true; await click("New import");
    expect((dom.document.querySelector("#pack-instance-id") as unknown as HTMLInputElement).value).toBe("custom"); expect(dom.document.body.textContent).toContain("Demo Pack"); expect(button("Confirm and install").disabled).toBe(false); expect(ui.getOpens()).toBe(0);
  });
  test("existing ID offers editing in place without dropping selected archive", async () => {
    await setup({ session: goodSession({ instanceList: async () => ({ instances: [{ id: "demo-pack" }] }) }) }); await click("Choose archive"); await click("Confirm and install");
    expect(dom.document.body.textContent).toContain("Nothing was overwritten"); await click("Edit selection and retry"); expect(dom.document.body.textContent).toContain("Demo Pack"); await fill("#pack-instance-id", "another"); expect(button("Confirm and install").disabled).toBe(false);
  });
  test("unknown archive outcome has no retry and no private diagnostics", async () => {
    await setup({ session: goodSession({ modpackInstall: async () => { throw { code: "TRANSPORT_EOF", message: "PRIVATE TOKEN" }; } }) }); await click("Choose archive"); await click("Confirm and install");
    expect(dom.document.body.textContent).toContain("IMPORT_OUTCOME_UNKNOWN"); expect(dom.document.body.textContent).not.toContain("PRIVATE TOKEN"); expect(button("Resume game setup")).toBeUndefined(); expect(button("Edit selection and retry")).toBeUndefined();
  });
  test("known setup download failure can resume after view closes without archive replay", async () => {
    let imports = 0; let attempts = 0;
    await setup({ session: goodSession({ modpackInstall: async () => { imports++; return result; }, installExecute: async () => { if (++attempts === 1) throw { code: "DOWNLOAD_FAILED", message: "SECRET URL" }; return {}; } }) });
    await click("Choose archive"); await click("Confirm and install"); expect(dom.document.body.textContent).toContain("DOWNLOAD_FAILED"); await click("Close"); await click("Reopen demo-pack"); await click("Resume game setup"); expect(imports).toBe(1); expect(attempts).toBe(2); expect(dom.document.body.textContent).not.toContain("SECRET URL");
  });
  test("preview failure never leaves stale metadata eligible for install", async () => {
    let calls = 0; await setup({ preview: async () => { if (++calls === 1) return metadata; throw { code: "MODPACK_PREVIEW_LIMIT", message: "PRIVATE" }; } }); await click("Choose archive"); expect(button("Confirm and install").disabled).toBe(false); await click("Choose archive"); expect(button("Confirm and install").disabled).toBe(true); expect(dom.document.body.textContent).not.toContain("PRIVATE");
  });
  test("late picker completion after close cannot populate draft", async () => {
    let finish!: (value: string) => void; await setup({ picker: () => new Promise(resolve => { finish = resolve; }) }); await click("Choose archive"); await click("Close"); await act(async () => finish("/late.mrpack")); await click("New import"); expect(dom.document.body.textContent).not.toContain("/late.mrpack"); expect(button("Confirm and install").disabled).toBe(true);
  });
});

test("new-import entry cannot blindly replay an uncertain same-ID task", async () => {
  let imports = 0;
  await setup({ session: goodSession({ modpackInstall: async () => { imports++; throw { code: "TRANSPORT_EOF" }; } }) });
  await click("Choose archive"); await click("Confirm and install"); await click("Close"); await click("New import"); await click("Confirm and install");
  expect(imports).toBe(1); expect(dom.document.body.textContent).toContain("IMPORT_OUTCOME_UNKNOWN");
});
