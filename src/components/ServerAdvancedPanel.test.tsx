import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ServersContext, type ServersContextValue, type ServerOperationScope } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import type { ServerAdvancedSession } from "@/lib/serverAdvanced";
import type { ServerManifest, ServerProperties } from "@/lib/types";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { ServerAdvancedPanel } = await import("./ServerAdvancedPanel");
let root: Root | undefined;
let scope: ServerOperationScope;
const server: ServerManifest = { id: "advanced-ui", name: "Fixture", version_id: "1.21.4", fabric_loader: null, neoforge_version: null, forge_version: null, source: "official", accept_eula: true, java_path: null, installed: true };
const button = (name: string) => [...dom.document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!;
const click = async (name: string) => { expect(button(name)).toBeTruthy(); await act(async () => button(name).click()); };
const input = (selector: string) => dom.document.querySelector(selector) as unknown as HTMLInputElement;
const fill = async (selector: string, value: string) => { await act(async () => { const element = input(selector); element.value = value; const key = Object.keys(element).find((key) => key.startsWith("__reactProps$"))!; (element as unknown as Record<string, { onChange: (event: { target: HTMLInputElement }) => void }>)[key].onChange({ target: element }); }); };
const setup = async (state: "running" | "stopped" | "unknown", overrides: Partial<ServerAdvancedSession> = {}) => {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  scope = { endpointId: "local", kind: "local", directory: "/fixture", sourceRevision: 1 };
  let properties: ServerProperties = { "max-players": "020", "custom.unknown": "false", "rcon.password": "<redacted>" };
  const writes: ServerProperties[] = [];
  const session: ServerAdvancedSession = {
    close: async () => {},
    serverStatus: async () => ({ stage: "server.status", id: server.id, running: state === "running", stale_state: false, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, uptime_ms: null }),
    serverPropertiesGet: async () => ({ stage: "server.properties.get", id: server.id, properties }),
    serverPropertiesSet: async (_dir, _id, changes) => { writes.push(changes); properties = { ...properties, ...changes }; return { stage: "server.properties.set", id: server.id, properties }; },
    serverRconCommand: async () => ({ stage: "server.rcon.command", text: "Fixture reply", truncated: true }),
    serverQuery: async (_dir, _id, mode) => ({ stage: "server.query", mode: mode ?? "full", hostname: "Fixture", game_type: "SMP", map: "world", version: null, plugins: null, players: 2, max_players: 20, host_port: 25565, host_ip: "127.0.0.1", player_names: mode === "basic" ? [] : ["Alex", "Steve"] }),
    ...overrides,
  };
  const servers = { endpointId: "local", captureOperationScope: () => scope, isOperationScopeCurrent: (captured: ServerOperationScope) => JSON.stringify(captured) === JSON.stringify(scope), openSession: async () => session } as unknown as ServersContextValue;
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  const render = async () => { await act(async () => root!.render(<SettingsProvider><ServersContext.Provider value={servers}><ServerAdvancedPanel server={server} state={state} /></ServersContext.Provider></SettingsProvider>)); };
  await render(); await click("Open advanced controls");
  return { writes, render, host };
};
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });

describe("ServerAdvancedPanel fixture DOM interactions", () => {
  test("writes explicit string edits only and keeps redacted password read-only", async () => {
    const { writes } = await setup("stopped");
    await click("Load / reload properties");
    expect(input('[aria-label="rcon.password"]').disabled).toBe(true);
    expect(input('[aria-label="max-players"]').value).toBe("020");
    await fill('[aria-label="max-players"]', "001");
    await click("Save explicit changes");
    expect(writes).toEqual([{ "max-players": "001" }]);
    expect(input('[aria-label="custom.unknown"]').value).toBe("false");
    expect(dom.document.body.textContent).toContain("Properties saved.");
  });
  test("failed save retains edits and safe recovery copy, not diagnostics", async () => {
    await setup("stopped", { serverPropertiesSet: async () => { throw { code: "JAVA_NOT_FOUND", message: "PRIVATE-DIAGNOSTIC" }; } });
    await click("Load / reload properties"); await fill('[aria-label="max-players"]', "009"); await click("Save explicit changes");
    expect(input('[aria-label="max-players"]').value).toBe("009");
    expect(dom.document.querySelector('[role="alert"]')).not.toBeNull();
    expect(dom.document.body.textContent).not.toContain("PRIVATE-DIAGNOSTIC");
    await click("Cancel / discard edits");
    expect(input('[aria-label="max-players"]')?.value ?? "").not.toBe("009");
  });
  test("clears transient password on submit, close, cancel and endpoint revision switch", async () => {
    const { render } = await setup("running");
    const secret = "fixture-transient-only";
    expect(input('input[type="password"]').getAttribute("autocomplete")).toBe("off");
    await fill('input[type="password"]', secret);
    await fill('section[aria-label="RCON"] input:not([type="password"])', "list");
    await click("Send RCON command");
    expect(input('input[type="password"]').value).toBe("");
    expect(dom.document.body.textContent).toContain("Fixture reply");
    expect(localStorage.getItem("jmcl.settings.v1")).not.toContain(secret);
    await fill('input[type="password"]', secret); await click("Cancel / discard edits"); expect(input('input[type="password"]').value).toBe("");
    await fill('input[type="password"]', secret); await click("Close advanced controls"); await click("Open advanced controls"); expect(input('input[type="password"]').value).toBe("");
    await fill('input[type="password"]', secret); scope = { ...scope, sourceRevision: 2 }; await render(); await click("Open advanced controls"); expect(input('input[type="password"]').value).toBe("");
  });
  test("renders Query nulls and full player names; basic clears previous names", async () => {
    await setup("running"); await click("Full Query");
    expect(dom.document.body.textContent).toContain("Not provided (null)"); expect(dom.document.body.textContent).toContain("Alex"); expect(dom.document.body.textContent).toContain("Steve");
    await click("Basic Query"); expect(dom.document.body.textContent).not.toContain("Alex"); expect(dom.document.body.textContent).toContain("Basic Query does not include a player list.");
  });
  test("explicit new values preserve strings and reject password / duplicate keys", async () => {
    const { writes } = await setup("stopped"); await click("Load / reload properties");
    await fill('[aria-label="New property name"]', "rcon.password"); await fill('[aria-label="New string value"]', "not-a-real-secret"); await click("Add pending property");
    expect(dom.document.body.textContent).toContain("rcon.password cannot be added or changed"); expect(writes).toHaveLength(0);
    await fill('[aria-label="New property name"]', "max-players"); await click("Add pending property"); expect(writes).toHaveLength(0);
    await fill('[aria-label="New property name"]', "another.unknown"); await fill('[aria-label="New string value"]', "000false"); await click("Add pending property"); await click("Save explicit changes");
    expect(writes).toEqual([{ "another.unknown": "000false" }]);
  });
  test("pending Query disables repeat requests and close discards late results", async () => {
    let resolve!: (value: Awaited<ReturnType<ServerAdvancedSession["serverQuery"]>>) => void;
    let requests = 0;
    await setup("running", { serverQuery: async () => { requests++; return new Promise((done) => { resolve = done; }); } });
    await click("Full Query"); expect(button("Full Query").disabled).toBe(true); await click("Full Query"); expect(requests).toBe(1);
    await click("Close advanced controls");
    await act(async () => resolve({ stage: "server.query", mode: "full", hostname: "LATE-HOST", game_type: "SMP", map: "world", version: null, plugins: null, players: 0, max_players: 20, host_port: 25565, host_ip: "127.0.0.1", player_names: [] }));
    await click("Open advanced controls"); expect(dom.document.body.textContent).not.toContain("LATE-HOST");
  });
  test("unknown status blocks property writes and running-only requests", async () => {
    const { writes } = await setup("unknown"); await click("Load / reload properties");
    expect(input('[aria-label="max-players"]').disabled).toBe(true); expect(button("Save explicit changes").disabled).toBe(true); expect(button("Send RCON command").disabled).toBe(true); expect(button("Full Query").disabled).toBe(true); expect(writes).toHaveLength(0);
  });
});
