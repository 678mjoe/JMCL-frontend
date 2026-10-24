import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsProvider } from "@/lib/settings";
const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, MouseEvent: dom.MouseEvent, HTMLInputElement: dom.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
const { CurseForgeSettings, validCurseForgeKey } = await import("./CurseForgeSettings");
let root: Root | undefined;
const button = (text: string) => [...dom.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const fill = async (value: string) => { await act(async () => { const input = dom.document.querySelector("input") as unknown as HTMLInputElement; input.value = value; const key = Object.getOwnPropertyNames(input).find((k) => k.startsWith("__reactProps$"))!; (input as unknown as Record<string, { onChange: (e: { target: HTMLInputElement; currentTarget: HTMLInputElement; nativeEvent: object }) => void }>)[key].onChange({ target: input, currentTarget: input, nativeEvent: {} }); }); };
async function setup(credentials: { status: () => Promise<boolean>; save: (key: string) => Promise<void>; remove: () => Promise<void> }) {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({ language: "en" }));
  const host = dom.document.createElement("div"); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><CurseForgeSettings credentials={credentials} /></SettingsProvider>));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });
describe("CurseForge explicit credential choice", () => {
  test("accepts only the Core printable ASCII nonspace key bounds", () => {
    for (const value of ["", "a b", "\n", "密钥", "a".repeat(513)]) expect(validCurseForgeKey(value)).toBe(false);
    expect(validCurseForgeKey("a".repeat(512))).toBe(true);
  });
  test("save is explicit and single-flight; input clears immediately and is never persisted", async () => {
    let calls = 0; let saved = false; let finish!: () => void;
    await setup({ status: async () => saved, save: async (key) => { expect(key).toBe("synthetic-key"); calls++; await new Promise<void>((resolve) => { finish = resolve; }); saved = true; }, remove: async () => { saved = false; } });
    await fill("synthetic-key"); expect(calls).toBe(0); expect(dom.document.querySelector("input")?.type).toBe("password");
    await act(async () => { button("Save key in OS credential store").click(); button("Save key in OS credential store").click(); });
    expect(calls).toBe(1); expect(dom.document.querySelector("input")?.value).toBe(""); expect(JSON.stringify(localStorage)).not.toContain("synthetic-key");
    await act(async () => finish()); expect(dom.document.body.textContent).toContain("API key saved");
    await click("Remove saved key"); expect(dom.document.body.textContent).toContain("No API key saved");
  });
  test("native diagnostics never enter UI and failed save clears input", async () => {
    await setup({ status: async () => false, save: async () => { throw new Error("PRIVATE synthetic-key"); }, remove: async () => {} });
    await fill("synthetic-key"); await click("Save key in OS credential store");
    expect(dom.document.body.textContent).toContain("Could not access the OS credential store"); expect(dom.document.body.textContent).not.toContain("PRIVATE"); expect(dom.document.querySelector("input")?.value).toBe("");
  });
  test("late initial status cannot overwrite a newer save", async () => {
    let finish!: (value: boolean) => void; let reads = 0;
    await setup({ status: () => ++reads === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(true), save: async () => {}, remove: async () => {} });
    await fill("synthetic-key"); await click("Save key in OS credential store"); await act(async () => finish(false));
    expect(dom.document.body.textContent).toContain("API key saved");
  });
});
