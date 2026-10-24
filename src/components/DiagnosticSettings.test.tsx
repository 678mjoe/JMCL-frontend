import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { DiagnosticSettings } from "./DiagnosticSettings";
import type { DiagnosticTransport } from "@/lib/diagnostics";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
const status = { enabled: true, available: true, max_file_bytes: 262144, max_files: 4, dropped: 0 };
const record = { version: 1, timestamp_ms: 1, level: "info", event: "app_started" };
function transport(overrides: Partial<DiagnosticTransport> = {}): DiagnosticTransport { return { status: async () => status, read: async () => ({ records: [record], skipped: 0 }), setEnabled: async enabled => ({ ...status, enabled }), clear: async () => {}, export: async () => true, ...overrides }; }
async function mount(api?: DiagnosticTransport) { localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" })); const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement); await act(async () => root!.render(<SettingsProvider><DiagnosticSettings transport={api} /></SettingsProvider>)); }
const button = (text: string) => Array.from(dom.document.querySelectorAll("button")).find(b => b.textContent === text)!;
const click = async (text: string) => act(async () => { button(text).click(); });
test("browser unavailable means no writes or false success", async () => {
  await mount(); expect(dom.document.body.textContent).toContain("browser preview does not write logs");
  expect(button("Enable recording").disabled).toBe(true); expect(button("Export logs…").disabled).toBe(true);
});
test("clear confirmation and cancellation; native setting is authoritative", async () => {
  let cleared = 0, enabled = false; const changes: boolean[] = [];
  await mount(transport({ status: async () => ({ ...status, enabled }), setEnabled: async value => { changes.push(value); enabled = value; }, clear: async () => { cleared++; } }));
  expect(dom.document.body.textContent).toContain("Recording disabled"); expect(button("Export logs…").disabled).toBe(false);
  await click("Clear logs…"); await click("Cancel"); expect(cleared).toBe(0);
  await click("Clear logs…"); await click("Confirm clear"); expect(cleared).toBe(1);
  await click("Enable recording"); expect(changes).toEqual([true]); expect(dom.document.body.textContent).toContain("Recording enabled");
});
test("filtering and hostile bridge output never render secrets", async () => {
  const secret = "SECRET_ACCESS_TOKEN_PASSWORD";
  await mount(transport({ read: async () => ({ records: [record, { ...record, level: "error", event: "frontend_error", method: secret }, { ...record, event: secret }], skipped: 0 }) }));
  expect(dom.document.body.textContent).not.toContain(secret);
  const select = dom.document.querySelector("select")!;
  await act(async () => { select.value = "error"; select.dispatchEvent(new dom.Event("change", { bubbles: true })); });
  expect(dom.document.body.textContent).not.toContain("app_started"); expect(dom.document.body.textContent).toContain("frontend_error");
});
test("double export starts only one dialog; cancelled export is not success", async () => {
  let calls = 0; let finish!: (value: boolean) => void;
  await mount(transport({ export: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
  await act(async () => { button("Export logs…").click(); button("Export logs…").click(); });
  expect(calls).toBe(1); expect(button("Clear logs…").disabled).toBe(true);
  await act(async () => finish(false)); expect(dom.document.body.textContent).toContain("Export cancelled"); expect(dom.document.body.textContent).not.toContain("Logs exported");
});
test("failed operation shows generic error and recovers on refresh", async () => {
  await mount(transport({ export: async () => { throw new Error("SECRET_PASSWORD"); } }));
  await click("Export logs…"); expect(dom.document.body.textContent).not.toContain("SECRET_PASSWORD"); expect(dom.document.body.textContent).toContain("Could not complete");
  expect(button("Clear logs…").disabled).toBe(true); await click("Refresh logs"); expect(dom.document.querySelector('[role="alert"]')).toBeNull();
});
test("late request after navigation cannot update remounted view", async () => {
  let finish!: (value: unknown) => void;
  await mount(transport({ status: () => new Promise(resolve => { finish = resolve; }) }));
  await act(async () => root!.unmount()); root = undefined; dom.document.body.replaceChildren();
  await mount(transport({ status: async () => ({ ...status, enabled: false }) }));
  await act(async () => finish(status)); expect(dom.document.body.textContent).toContain("Recording disabled");
});
test("export remains locked across navigation until native dialog closes", async () => {
  let calls = 0; let finish!: (value: boolean) => void;
  const api = transport({ export: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  await mount(api); await click("Export logs…");
  await act(async () => root!.unmount()); root = undefined; dom.document.body.replaceChildren();
  await mount(api); expect(button("Export logs…").disabled).toBe(true); expect(button("Clear logs…").disabled).toBe(true);
  await act(async () => finish(false)); expect(button("Export logs…").disabled).toBe(false); expect(calls).toBe(1);
  expect(dom.document.body.textContent).not.toContain("Logs exported");
});
test("enabled logging can be disabled when storage is unavailable", async () => {
  let enabled = true; const changes: boolean[] = [];
  await mount(transport({ status: async () => ({ ...status, available: false, enabled }), setEnabled: async value => { changes.push(value); enabled = value; } }));
  expect(button("Disable recording").disabled).toBe(false); expect(button("Export logs…").disabled).toBe(true);
  await click("Disable recording"); expect(changes).toEqual([false]); expect(button("Enable recording").disabled).toBe(true);
});
test("read failure preserves authoritative status for safe disable; persistence error is not success", async () => {
  let reject = true; let enabled = true; const changes: boolean[] = [];
  await mount(transport({ status: async () => ({ ...status, enabled }), read: async () => { throw new Error("SECRET_READ_ERROR"); }, setEnabled: async value => { changes.push(value); if (reject) throw new Error("SECRET_PERSIST_ERROR"); enabled = value; } }));
  expect(button("Disable recording").disabled).toBe(false); await click("Disable recording");
  expect(changes).toEqual([false]); expect(dom.document.body.textContent).not.toContain("SECRET_"); expect(button("Disable recording").disabled).toBe(false);
  reject = false; await click("Disable recording"); expect(changes).toEqual([false, false]); expect(button("Enable recording").disabled).toBe(true);
  expect(dom.document.body.textContent).toContain("Recording disabled"); expect(dom.document.body.textContent).toContain("Could not complete");
});
test("one refresh rechecks status after a repaired native storage read", async () => {
  let available = false; let reads = 0;
  await mount(transport({ status: async () => ({ ...status, available }), read: async () => { reads++; available = true; return { records: [record], skipped: 0 }; } }));
  expect(reads).toBe(1); expect(button("Export logs…").disabled).toBe(false); expect(dom.document.body.textContent).toContain("app_started");
});
test("specific login stage and safe failure category render without untrusted details", async () => {
  const secret = "SECRET_DEVICE_CODE_TOKEN_ENDPOINT";
  await mount(transport({ read: async () => ({ records: [
    { ...record, level: "error", event: "core_request", method: "auth", operation: "auth.microsoft.device.begin", failure: "network", outcome: "error", message: secret },
    { ...record, level: "error", event: "core_request", method: "auth", operation: secret, failure: secret },
  ], skipped: 0 }) }));
  expect(dom.document.body.textContent).toContain("auth.microsoft.device.begin · error · network");
  expect(dom.document.body.textContent).not.toContain(secret);
});
