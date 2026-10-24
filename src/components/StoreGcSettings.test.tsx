import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider, useSettings } from "@/lib/settings";
import type { StoreGcParams, StoreGcSession } from "@/lib/storeGc";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
const { StoreGcSettings } = await import("./StoreGcSettings");
let root: Root | undefined;
const button = (text: string) => [...dom.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const fill = async (id: string, value: string) => { await act(async () => { const input = dom.document.getElementById(id) as unknown as HTMLInputElement; input.value = value; const key = Object.getOwnPropertyNames(input).find((k) => k.startsWith("__reactProps$"))!; (input as unknown as Record<string, { onChange: (e: { currentTarget: HTMLInputElement; target: HTMLInputElement; nativeEvent: object }) => void }>)[key].onChange({ currentTarget: input, target: input, nativeEvent: {} }); }); };
let staleConfirmationDuringLayout: boolean | null = null;
function ScopeChange() { const { settings, update } = useSettings(); useLayoutEffect(() => { if (settings.storeDir === "/synthetic/new") staleConfirmationDuringLayout = !!dom.document.getElementById("store-gc-confirm"); }, [settings.storeDir]); return <button onClick={() => update({ storeDir: "/synthetic/new" })}>Change store</button>; }
async function setup(action?: (p: StoreGcParams) => Promise<unknown>) {
  staleConfirmationDuringLayout = null;
  const calls: StoreGcParams[] = []; let closes = 0;
  const openSession = async (): Promise<StoreGcSession> => ({ storeGc: async (p) => {
    calls.push(p); if (action) return action(p);
    return { dry_run: p.dry_run, min_age_seconds: p.min_age_seconds, summary: { objects_scanned: 4, objects_eligible: 1, objects_deleted: p.dry_run ? 0 : 1, bytes_eligible: 42, bytes_deleted: p.dry_run ? 0 : 42, objects_linked: 1, objects_young: 1, objects_ignored: 1, objects_busy: 0, errors: 0 } };
  }, close: async () => { closes++; } });
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en", storeDir: "/synthetic/store", instancesDir: "/synthetic/instances", serversDir: "/synthetic/servers" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<StrictMode><SettingsProvider><ScopeChange /><StoreGcSettings openSession={openSession} /></SettingsProvider></StrictMode>));
  return { calls, get closes() { return closes; } };
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("store cleanup settings", () => {
  test("preview precedes named destructive action, cancellation and fresh execution", async () => {
    const h = await setup(); expect(h.calls).toHaveLength(0); expect(button("Delete eligible store objects")).toBeUndefined();
    await click("Preview cleanup (no deletion)"); expect(h.calls[0].dry_run).toBe(true); expect(button("Delete eligible store objects").disabled).toBe(true);
    await fill("store-gc-confirm", "store"); expect(button("Delete eligible store objects").disabled).toBe(true);
    await fill("store-gc-confirm", "/synthetic/store"); await click("Cancel cleanup"); expect(button("Delete eligible store objects")).toBeUndefined();
    await click("Preview cleanup (no deletion)"); expect(dom.document.getElementById("store-gc-confirm")?.getAttribute("value")).not.toBe("/synthetic/store");
    await fill("store-gc-confirm", "/synthetic/store"); await click("Delete eligible store objects");
    expect(h.calls.map((p) => p.dry_run)).toEqual([true, true, false]); expect(h.closes).toBe(3);
    expect(dom.document.body.textContent).toContain("Cleanup completed"); expect(button("Delete eligible store objects")).toBeUndefined();
  });
  test("age and configured store changes invalidate preview", async () => {
    const h = await setup(); await click("Preview cleanup (no deletion)"); await fill("store-gc-age", "0");
    expect(button("Delete eligible store objects")).toBeUndefined(); await click("Preview cleanup (no deletion)"); expect(h.calls[1].min_age_seconds).toBe(0);
    await fill("store-gc-confirm", "/synthetic/store"); await click("Change store"); expect(staleConfirmationDuringLayout).toBe(false); expect(button("Delete eligible store objects")).toBeUndefined();
    await click("Preview cleanup (no deletion)"); expect(h.calls[2].store_directory).toBe("/synthetic/new"); expect(button("Delete eligible store objects").disabled).toBe(true);
  });
  test("partial outcome displays uncertainty without diagnostic leakage", async () => {
    await setup(async () => { throw { code: "STORE_GC_PARTIAL", message: "PRIVATE" }; }); await click("Preview cleanup (no deletion)");
    expect(dom.document.body.textContent).toContain("number deleted is unknown"); expect(dom.document.body.textContent).not.toContain("PRIVATE"); expect(dom.document.querySelector("dl")).toBeNull(); expect(button("Delete eligible store objects")).toBeUndefined();
  });
});
