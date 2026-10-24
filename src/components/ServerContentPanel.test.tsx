import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ServersContext, type ServersContextValue, type ServerOperationScope } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import type { ServerContentSession } from "@/lib/serverContent";
import type { ServerContentEntry, ServerManifest } from "@/lib/types";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ServerContentPanel } = await import("./ServerContentPanel");
let root: Root | undefined;
let scope: ServerOperationScope;
const server: ServerManifest = { id: "content-ui", name: "Fixture", version_id: "1.21.4", fabric_loader: "0.16.10", neoforge_version: null, forge_version: null, source: "official", accept_eula: true, java_path: null, installed: true };
const entry: ServerContentEntry = { kind: "mod", file: "mods/fixture.jar", sha1: "a", size: 42, source: { provider: "modrinth", project_id: "fixture", version_id: "old", slug: "Fixture" }, enabled: true, as_dependency: false };
const button = (name: string) => [...dom.document.querySelectorAll("button")].find(item => item.textContent?.trim() === name)!;
const click = async (name: string) => { expect(button(name)).toBeTruthy(); await act(async () => button(name).click()); };
const input = (label: string) => dom.document.querySelector(`[aria-label="${label}"]`) as unknown as HTMLInputElement;
const fill = async (label: string, value: string) => { await act(async () => { const element = input(label); element.value = value; const key = Object.keys(element).find(key => key.startsWith("__reactProps$"))!; (element as unknown as Record<string, { onChange: (event: { target: HTMLInputElement }) => void }>)[key].onChange({ target: element }); }); };
async function setup(state: "stopped" | "running" | "unknown" = "stopped", overrides: Partial<ServerContentSession> = {}, manifest = server, kind: "mods" | "datapacks" = "mods") {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  scope = { endpointId: "content-dom", kind: "local", directory: "/fixtures", sourceRevision: 1 };
  const calls: unknown[][] = [];
  const base = {
    close: async () => {}, serverGet: async () => ({ stage: "server.get", ...manifest }),
    serverStatus: async () => ({ stage: "server.status", id: server.id, running: state === "running", stale_state: false, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, uptime_ms: null }),
    serverModsList: async () => ({ stage: "server.mods.list", id: server.id, entries: [entry], unmanaged: ["mods/manual.jar"] }),
    serverDatapacksList: async () => ({ stage: "server.datapacks.list", id: server.id, entries: [{ ...entry, kind: "datapack", file: "datapacks/fixture.zip" }], unmanaged: ["datapacks/manual.zip"] }),
    ...Object.fromEntries(["Mods", "Datapacks"].flatMap(k => ["Install", "SetVersion", "Enable", "Disable", "Remove", "Adopt"].map(action => [`server${k}${action}`, async (...args: unknown[]) => { calls.push([`${k}.${action}`, ...args]); return { id: server.id }; }]))), ...overrides,
  } as unknown as ServerContentSession;
  const servers = { endpointId: scope.endpointId, captureOperationScope: () => scope, isOperationScopeCurrent: (captured: ServerOperationScope) => JSON.stringify(captured) === JSON.stringify(scope), openSession: async () => base, refreshServerStatus: async () => {} } as unknown as ServersContextValue;
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  const render = async () => { await act(async () => root!.render(<SettingsProvider><ServersContext.Provider value={servers}><ServerContentPanel server={manifest} state={state} /></ServersContext.Provider></SettingsProvider>)); };
  await render(); await click(kind === "mods" ? "Manage Mods" : "Manage datapacks"); await click("Load / refresh content");
  return { calls, render };
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("server content fixture DOM", () => {
  test("list, toggle, adopt and confirmed remove route through scoped server RPC", async () => {
    const { calls } = await setup(); expect(dom.document.body.textContent).toContain("mods/manual.jar");
    await click("Disable"); expect(calls[0]).toEqual(["Mods.Disable", "/fixtures", server.id, { file: "mods/fixture.jar" }]);
    await click("Adopt unmanaged files"); expect(calls[1]?.[0]).toBe("Mods.Adopt");
    await click("Remove"); expect(button("Confirm removal").disabled).toBe(true);
    await fill("Type file name to confirm removal", "wrong"); expect(button("Confirm removal").disabled).toBe(true);
    await fill("Type file name to confirm removal", "mods/fixture.jar"); await click("Confirm removal");
    expect(calls[2]).toEqual(["Mods.Remove", "/fixtures", server.id, { file: "mods/fixture.jar" }]);
    expect(dom.document.body.textContent).toContain("Operation completed.");
  });
  test("Vanilla blocks mod install search but permits cleanup; datapacks allow install before first launch", async () => {
    const { calls } = await setup("stopped", {}, { ...server, fabric_loader: null });
    expect(button("Search Modrinth").disabled).toBe(true); expect(button("Disable").disabled).toBe(false);
    await click("Disable"); expect(calls[0]?.[0]).toBe("Mods.Disable");
    await click("Manage datapacks"); await click("Load / refresh content"); expect(button("Search Modrinth").disabled).toBe(false);
    expect(dom.document.body.textContent).toContain("before first launch");
    await click("Search Modrinth"); await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    await click("Datapack fixtureSynthetic server-compatible catalog fixture"); await click("Install");
    expect(calls[1]?.slice(0, 4)).toEqual(["Datapacks.Install", "/fixtures", server.id, "mock-server-datapacks"]);
  });
  test("compatible installed project versions use set-version, never client content RPC", async () => {
    const { calls } = await setup(); await click("Choose version"); await click("Switch version");
    expect(calls[0]?.slice(0, 5)).toEqual(["Mods.SetVersion", "/fixtures", server.id, "fixture", "mock-mods-2"]);
  });
  for (const state of ["running", "unknown"] as const) test(`${state} status disables all changes, reads stay enabled`, async () => {
    await setup(state); expect(button("Disable").disabled).toBe(true); expect(button("Remove").disabled).toBe(true); expect(button("Adopt unmanaged files").disabled).toBe(true); expect(button("Load / refresh content").disabled).toBe(false);
  });
  test("failed authority disables mutations and never displays private diagnostics", async () => {
    await setup("stopped", { serverStatus: async () => { throw { code: "SSH_DISCONNECTED", message: "PRIVATE-DIAGNOSTIC" }; } });
    expect(button("Search Modrinth").disabled).toBe(true); expect(button("Disable").disabled).toBe(true);
    expect(dom.document.body.textContent).toContain("authoritative status refresh failed"); expect(dom.document.body.textContent).not.toContain("PRIVATE-DIAGNOSTIC");
  });
  test("cancel, close and endpoint changes erase confirmations and catalog", async () => {
    const { render } = await setup(); await click("Remove"); await fill("Type file name to confirm removal", "mods/fixture.jar"); await click("Cancel / clear selection"); expect(input("Type file name to confirm removal")).toBeNull();
    await click("Load / refresh content"); await click("Choose version"); await click("Close content management"); await click("Manage Mods"); expect(button("Switch version")).toBeUndefined();
    await click("Load / refresh content"); await click("Remove"); scope = { ...scope, sourceRevision: 2 }; await render(); await click("Manage Mods"); expect(input("Type file name to confirm removal")).toBeNull();
  });
  test("repeated clicks blocked; close suppresses late mutation completion", async () => {
    let resolve!: (value: Awaited<ReturnType<ServerContentSession["serverModsRemove"]>>) => void;
    let count = 0;
    await setup("stopped", { serverModsRemove: async () => { count++; return new Promise(done => { resolve = done; }); } });
    await click("Remove"); await fill("Type file name to confirm removal", "mods/fixture.jar"); await click("Confirm removal"); expect(button("Confirm removal").disabled).toBe(true); await click("Confirm removal"); expect(count).toBe(1);
    await click("Close content management"); await act(async () => resolve({ stage: "server.mods.remove", id: server.id, removed: entry }));
    await click("Manage Mods"); expect(dom.document.body.textContent).not.toContain("Operation completed.");
  });
  test("cancelled pending catalog search cannot revive a closed panel", async () => {
    await setup(); await click("Search Modrinth"); await click("Cancel / clear selection");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(input("Search server-compatible projects")).toBeNull(); expect(dom.document.body.textContent).not.toContain("Server Mod fixture");
  });
});
