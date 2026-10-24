import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { instanceCoordinator, instanceMutationKey } from "@/lib/instanceCoordinator";
import { SettingsProvider } from "@/lib/settings";
import { LauncherContext } from "@/lib/launcher";
import type { CoreSession } from "@/lib/rpc";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, MutationObserver: dom.MutationObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ModpackImportDialog } = await import("./ModpackImportDialog");
let root: Root | undefined;
const button = (text: string) => [...dom.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const fill = async (selector: string, value: string) => { await act(async () => { const input = dom.document.querySelector(selector) as unknown as HTMLInputElement; input.value = value; const key = Object.getOwnPropertyNames(input).find((k) => k.startsWith("__reactProps$"))!; (input as unknown as Record<string, { onChange: (e: { target: HTMLInputElement; currentTarget: HTMLInputElement; nativeEvent: object }) => void }>)[key].onChange({ target: input, currentTarget: input, nativeEvent: {} }); }); };
async function setup(picker: () => Promise<string | null>, session = {} as CoreSession, keyStatus = async () => false) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", instancesDir: "/fixture", storeDir: "/store" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  let open = true; let opens = 0; let refreshed = 0;
  const render = async () => { await act(async () => root!.render(<SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: null, error: null, session, openSession: async () => { opens++; return session; } }}><ModpackImportDialog open={open} onOpenChange={(value) => { open = value; }} onImported={() => { refreshed++; }} pickArchive={picker} keyStatus={keyStatus} /></LauncherContext.Provider></SettingsProvider>)); };
  await render(); return { render, getOpen: () => open, getOpens: () => opens, getRefresh: () => refreshed };
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("modpack import fixture DOM", () => {
  test("CurseForge import carries only provider intent and refreshes missing key status", async () => {
    let saved = false; let options: unknown;
    const session = { instanceList: async () => ({ instances: [] }), modpackInstall: async (_directory: string, _id: string, _file: string, opts: unknown) => { options = opts; throw { code: "DOWNLOAD_UNAVAILABLE", message: "PRIVATE" }; }, close: async () => {} } as unknown as CoreSession;
    const ui = await setup(async () => "/fixture/pack.zip", session, async () => saved);
    await act(async () => { const select = dom.document.querySelector("#pack-provider") as unknown as HTMLSelectElement; select.value = "curseforge"; select.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event); }); await fill("#pack-instance-id", "pack"); await click("Choose archive");
    expect(button("Import into new instance").disabled).toBe(true);
    saved = true; await click("Refresh key status"); expect(button("Import into new instance").disabled).toBe(false);
    await click("Import into new instance"); expect(options).toEqual({ store_directory: "/store", provider: "curseforge" }); expect(ui.getOpens()).toBe(1);
    expect(dom.document.body.textContent).toContain("unavailable for third-party download"); expect(dom.document.body.textContent).not.toContain("PRIVATE");
  });

  test("cancelled picker does not enable import; late picker result after Close is discarded", async () => {
    let finish!: (path: string | null) => void;
    const ui = await setup(() => new Promise((resolve) => { finish = resolve; }));
    await fill("#pack-instance-id", "pack"); await click("Choose archive"); expect(button("Choose archive").disabled).toBe(true);
    await act(async () => finish(null)); expect(button("Import into new instance").disabled).toBe(true);
    await click("Choose archive"); await click("Close"); await ui.render(); await act(async () => finish("/fixture/late.mrpack"));
    expect(dom.document.body.textContent).not.toContain("late.mrpack"); expect(ui.getOpens()).toBe(0);
  });
  test("CurseForge without a saved key offers Settings guidance without requesting a key", async () => {
    const ui = await setup(async () => "/fixture/pack.zip"); await act(async () => { const select = dom.document.querySelector("#pack-provider") as unknown as HTMLSelectElement; select.value = "curseforge"; select.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event); });
    expect(dom.document.body.textContent).toContain("Open Settings → CurseForge"); expect(dom.document.querySelector('input[type="password"]')).toBeNull(); expect(button("Import into new instance").disabled).toBe(true); expect(ui.getOpens()).toBe(0);
  });
  test("repeated import clicks submit once; Close cannot dismiss active archive; errors never leak diagnostics", async () => {
    let finish!: () => void; let imports = 0;
    const session = { instanceList: async () => ({ instances: [] }), modpackInstall: async () => { imports++; await new Promise<void>((resolve) => { finish = resolve; }); throw { code: "UNSAFE_MODPACK", message: "PRIVATE-CONTENT" }; }, close: async () => {} } as unknown as CoreSession;
    const ui = await setup(async () => "/fixture/pack.mrpack", session);
    await fill("#pack-instance-id", "pack"); await click("Choose archive");
    await act(async () => { const b = button("Import into new instance"); b.click(); b.click(); });
    expect(imports).toBe(1); expect(button("Close").disabled).toBe(true); await click("Close"); expect(ui.getOpen()).toBe(true);
    await act(async () => finish()); expect(dom.document.body.textContent).toContain("Core rejected unsafe paths"); expect(dom.document.body.textContent).not.toContain("PRIVATE-CONTENT"); expect(ui.getRefresh()).toBe(1);
  });
  test("busy instance says archive was not submitted rather than unknown outcome", async () => {
    const ui = await setup(async () => "/fixture/pack.mrpack");
    const release = instanceCoordinator.tryAcquire(instanceMutationKey("/fixture", "pack"), "launch");
    try {
      await fill("#pack-instance-id", "pack"); await click("Choose archive"); await click("Import into new instance");
      expect(ui.getOpens()).toBe(0);
      expect(dom.document.body.textContent).toContain("The archive was not submitted");
      expect(dom.document.body.textContent).not.toContain("its outcome is unknown");
    } finally { release(); }
  });

});
