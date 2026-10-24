import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ServersContext, type ServersContextValue, type ServerOperationScope } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import type { ServerWorldsSession } from "@/lib/serverWorlds";
import type { ServerManifest, ServerWorldEntry } from "@/lib/types";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ServerWorldsPanel } = await import("./ServerWorldsPanel");
let root: Root | undefined;
let scope: ServerOperationScope;
const server: ServerManifest = { id: "world-ui", name: "Fixture", version_id: "1.21.4", fabric_loader: null, neoforge_version: null, forge_version: null, source: "official", accept_eula: true, java_path: null, installed: true };
const world: ServerWorldEntry = { name: "world", level_name: "Fixture", version_name: null, version_id: null, game_mode: "survival", hardcore: false, cheats: null, difficulty: null, last_played_ms: null, size_bytes: 42, has_icon: false, locked: false, version_relation: "unknown" };
const button = (name: string) => [...dom.document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!;
const click = async (name: string) => { expect(button(name)).toBeTruthy(); await act(async () => button(name).click()); };
const input = (label: string) => dom.document.querySelector(`[aria-label="${label}"]`) as unknown as HTMLInputElement;
const fill = async (label: string, value: string) => { await act(async () => { const element = input(label); element.value = value; const key = Object.keys(element).find((key) => key.startsWith("__reactProps$"))!; (element as unknown as Record<string, { onChange: (event: { target: HTMLInputElement }) => void }>)[key].onChange({ target: element }); }); };
async function setup(state: "stopped" | "running" | "unknown" = "stopped", overrides: Partial<ServerWorldsSession> = {}) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  scope = { endpointId: "world-dom", kind: "local", directory: "/fixtures", sourceRevision: 1 };
  const calls: unknown[][] = [];
  const session: ServerWorldsSession = {
    close: async () => {},
    serverStatus: async () => ({ stage: "server.status", id: server.id, running: state === "running", stale_state: false, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, uptime_ms: null }),
    serverPropertiesGet: async () => ({ stage: "server.properties.get", id: server.id, properties: { "level-name": "world" } }),
    serverWorldsList: async () => ({ stage: "server.worlds.list", id: server.id, worlds: [world, { ...world, name: "world_nether" }] }),
    serverWorldsGet: async (_dir, _id, name) => ({ stage: "server.worlds.get", id: server.id, world: { ...world, name }, icon_png_base64: null }),
    serverWorldsBackups: async () => ({ stage: "server.worlds.backups", id: server.id, backups: [{ file: "fixture.zip", world: null, created_ms: 1, size_bytes: 2 }] }),
    serverWorldsRename: async (...args) => { calls.push(["rename", ...args]); return { stage: "server.worlds.rename", renamed: { old_name: args[2], new_name: args[3] } }; },
    serverWorldsDelete: async (...args) => { calls.push(["delete", ...args]); return { stage: "server.worlds.delete", deleted: args[2] }; },
    serverWorldsBackup: async (...args) => { calls.push(["backup", ...args]); return { stage: "server.worlds.backup", backup: "fixture.zip" }; },
    serverWorldsRestore: async (...args) => { calls.push(["restore", ...args]); return { stage: "server.worlds.restore", restored: "world" }; }, ...overrides,
  };
  const servers = { endpointId: scope.endpointId, captureOperationScope: () => scope, isOperationScopeCurrent: (captured: ServerOperationScope) => JSON.stringify(captured) === JSON.stringify(scope), openSession: async () => session, refreshServerStatus: async () => {} } as unknown as ServersContextValue;
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  const render = async () => { await act(async () => root!.render(<SettingsProvider><ServersContext.Provider value={servers}><ServerWorldsPanel server={server} state={state} /></ServersContext.Provider></SettingsProvider>)); };
  await render(); await click("Open world management"); await click("Load / refresh worlds and backups");
  return { calls, render };
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("server worlds fixture DOM interactions", () => {
  test("lists base and dimensions, renders nullable details and whole backup", async () => {
    const { calls } = await setup(); expect(dom.document.body.textContent).toContain("world_nether");
    await click("World details"); expect(dom.document.body.textContent).toContain("Unknown / not provided");
    await click("Back up all worlds"); expect(calls).toEqual([["backup", "/fixtures", server.id, {}]]);
  });
  test("named rename and cascade delete confirmation required", async () => {
    const { calls } = await setup(); await click("Rename world");
    expect(dom.document.body.textContent).toContain("updates level-name");
    await fill("New world name", "renamed"); expect(button("Confirm operation").disabled).toBe(true);
    await fill("Type target name to confirm", "wrong"); expect(button("Confirm operation").disabled).toBe(true);
    await fill("Type target name to confirm", "world"); await click("Confirm operation");
    expect(calls[0]).toEqual(["rename", "/fixtures", server.id, "world", "renamed"]);
    await click("Delete world"); expect(dom.document.body.textContent).toContain("Coupled dimensions: world_nether");
    await fill("Type target name to confirm", "world"); await click("Confirm operation"); expect(calls[1]?.[0]).toBe("delete");
  });
  test("restore never implicitly replaces; explicit checkbox and name dispatch replace", async () => {
    const { calls } = await setup(); await click("Restore backup");
    expect(dom.document.body.textContent).toContain("level-name is unchanged");
    await fill("Type target name to confirm", "fixture.zip"); await click("Confirm operation");
    expect(calls[0]).toEqual(["restore", "/fixtures", server.id, "fixture.zip", false]);
    await click("Restore backup"); await fill("Type target name to confirm", "fixture.zip");
    await act(async () => (dom.document.querySelector('input[type="checkbox"]') as unknown as HTMLInputElement).click()); await click("Confirm operation");
    expect(calls[1]).toEqual(["restore", "/fixtures", server.id, "fixture.zip", true]);
  });
  test("unknown status disables mutations while reads remain available", async () => {
    await setup("unknown"); expect(button("Back up all worlds").disabled).toBe(true); expect(button("Rename world").disabled).toBe(true); expect(button("World details").disabled).toBe(false);
  });
  test("running status disables mutation controls", async () => {
    await setup("running"); expect(button("Delete world").disabled).toBe(true); expect(button("Restore backup").disabled).toBe(true); expect(button("Back up all worlds").disabled).toBe(true);
  });
  test("locked entries and failed authority refresh keep changes disabled", async () => {
    await setup("stopped", {
      serverWorldsList: async () => ({ stage: "server.worlds.list", id: server.id, worlds: [{ ...world, locked: true }] }),
      serverStatus: async () => { throw { code: "SSH_DISCONNECTED", message: "PRIVATE-HOST" }; },
    });
    expect(button("Rename world").disabled).toBe(true); expect(button("Delete world").disabled).toBe(true); expect(button("Back up all worlds").disabled).toBe(true);
    expect(dom.document.body.textContent).toContain("Authoritative refresh failed"); expect(dom.document.body.textContent).not.toContain("PRIVATE-HOST");
  });
  test("pending mutation blocks repeats and close cannot present late completion", async () => {
    let resolve!: (value: Awaited<ReturnType<ServerWorldsSession["serverWorldsDelete"]>>) => void;
    let deletes = 0;
    await setup("stopped", { serverWorldsDelete: async () => { deletes++; return new Promise((done) => { resolve = done; }); } });
    await click("Delete world"); await fill("Type target name to confirm", "world"); await click("Confirm operation");
    expect(button("Confirm operation").disabled).toBe(true); await click("Confirm operation"); expect(deletes).toBe(1);
    await click("Close world management");
    await act(async () => resolve({ stage: "server.worlds.delete", deleted: "world" }));
    await click("Open world management"); expect(dom.document.body.textContent).not.toContain("Operation completed."); expect(input("Type target name to confirm")).toBeNull();
  });
  test("cancel, close and source changes discard target confirmations", async () => {
    const { render } = await setup(); await click("Delete world"); await fill("Type target name to confirm", "world"); await click("Cancel / clear confirmation"); expect(input("Type target name to confirm")).toBeNull();
    await click("Load / refresh worlds and backups"); await click("Delete world"); await fill("Type target name to confirm", "world"); await click("Close world management"); await click("Open world management"); expect(input("Type target name to confirm")).toBeNull();
    await click("Load / refresh worlds and backups"); await click("Delete world"); scope = { ...scope, sourceRevision: 2 }; await render(); await click("Open world management"); expect(input("Type target name to confirm")).toBeNull();
  });
  test("errors use safe copy, retain explicit retry confirmation and refresh lists", async () => {
    await setup("stopped", { serverWorldsDelete: async () => { throw { code: "WORLD_LOCKED", message: "PRIVATE-DIAGNOSTIC" }; } }); await click("Delete world"); await fill("Type target name to confirm", "world"); await click("Confirm operation");
    expect(dom.document.body.textContent).toContain("World is locked"); expect(dom.document.body.textContent).not.toContain("PRIVATE-DIAGNOSTIC"); expect(input("Type target name to confirm").value).toBe("world");
  });
});
