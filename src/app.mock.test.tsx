import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";

const dom = new Window({ url: "http://localhost/" });
const globals = globalThis as typeof globalThis & Record<string, unknown>;
Object.assign(globals, {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  localStorage: dom.localStorage,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  SVGElement: dom.SVGElement,
  Node: dom.Node,
  Text: dom.Text,
  Event: dom.Event,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("mock transport React integration", () => {
  let root: Root;

  beforeAll(async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    root = createRoot(
      (dom.document.getElementById("root") ??
        dom.document.body) as unknown as HTMLElement,
    );
    root.render(React.createElement(App));
    await wait(450);
  });

  afterAll(() => root?.unmount());

  test("loads the fixture without Tauri internals", () => {
    expect(dom.document.body.textContent).toContain("Vanilla 1.21.4");
    expect(dom.document.body.textContent).toContain("Fabric");
    expect(dom.document.body.textContent).not.toContain("Core error");
  });
});
