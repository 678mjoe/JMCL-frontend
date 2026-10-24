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
