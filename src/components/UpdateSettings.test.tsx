import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
import { UpdateSettings } from "./UpdateSettings";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  dom.document.body.replaceChildren();
  localStorage.clear();
});
test("settings expose an unavailable updater, never a working update action", async () => {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", updatesEnabled: true, updateEndpoint: "https://untrusted.invalid" }));
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><UpdateSettings /></SettingsProvider>));
  const button = dom.document.querySelector("button")!;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Check for updates");
  expect(dom.document.body.textContent).toContain("Automatic updates unavailable");
  expect(dom.document.body.textContent).toContain("does not check, download, or install");
  await act(async () => { button.click(); button.click(); });
  expect(button.disabled).toBe(true);
  expect(dom.document.body.textContent).not.toContain("up to date");
});

import { createUpdateController, unconfiguredUpdate, type UpdateAction, type UpdatePhase, type UpdateSnapshot } from "@/lib/updates";
const snapshot = (phase: UpdatePhase): UpdateSnapshot => ({ ...unconfiguredUpdate, phase, channel: "synthetic", version: "0.2.0" });
async function mount(controller: ReturnType<typeof createUpdateController>) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><UpdateSettings controller={controller} /></SettingsProvider>));
}
const button = (text: string) => Array.from(dom.document.querySelectorAll("button")).find(b => b.textContent === text)!;
const click = async (text: string) => act(async () => { button(text).click(); });
test("check/download/install each require confirmation; cancel does not invoke transport", async () => {
  let phase: UpdatePhase = "idle"; const actions: UpdateAction[] = [];
  const controller = createUpdateController({ status: async () => snapshot(phase), action: async action => {
    actions.push(action); phase = ({ check: "available", download: "downloaded", install: "installed", discard: "idle", restart: "installed" } as const)[action]; return snapshot(phase);
  } });
  await mount(controller);
  await click("Check for updates"); expect(actions).toEqual([]);
  await click("Cancel"); expect(actions).toEqual([]);
  await click("Check for updates"); await click("Confirm: Check for updates"); expect(actions).toEqual(["check"]);
  await click("Download update"); expect(actions).toEqual(["check"]);
  await click("Cancel"); expect(actions).toEqual(["check"]);
  await click("Download update"); await click("Confirm: Download update"); expect(actions).toEqual(["check", "download"]);
  await click("Install update"); expect(dom.document.body.textContent).toContain("Windows exits"); expect(actions).toHaveLength(2);
  await click("Confirm: Install update"); expect(actions).toEqual(["check", "download", "install"]);
  await click("Restart launcher"); await click("Cancel"); expect(actions).toHaveLength(3);
});
test("remount recovers native busy state, no cancellation or implicit action", async () => {
  const actions: UpdateAction[] = [];
  const controller = createUpdateController({ status: async () => snapshot("downloading"), action: async action => { actions.push(action); return snapshot("downloaded"); } });
  await mount(controller);
  expect(button("Check for updates").disabled).toBe(true);
  expect(dom.document.body.textContent).toContain("Leaving Settings does not cancel");
  expect(button("Cancel")).toBeUndefined(); expect(button("Install update")).toBeUndefined();
  await act(async () => root!.unmount()); root = undefined;
  await mount(controller); expect(actions).toEqual([]);
  expect(button("Check for updates").disabled).toBe(true);
});
test("stale install confirmation disappears if native status changes", async () => {
  let phase: UpdatePhase = "downloaded"; let actions = 0;
  const controller = createUpdateController({ status: async () => snapshot(phase), action: async () => { actions++; return snapshot("installed"); } });
  await mount(controller); await click("Install update");
  phase = "error"; await act(async () => controller.refresh());
  expect(button("Confirm: Install update")).toBeUndefined(); expect(actions).toBe(0);
});
