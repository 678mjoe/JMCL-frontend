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
  IS_REACT_ACT_ENVIRONMENT: true,
});

function waitForBodyText(text: string): Promise<void> {
  if (dom.document.body.textContent?.includes(text)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const observer = new dom.MutationObserver(() => {
      if (dom.document.body.textContent?.includes(text)) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }
    });
    observer.observe(dom.document.body, { childList: true, subtree: true, characterData: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for app text: ${text}; current body: ${dom.document.body.textContent}`));
    }, 3000);
  });
}

describe("mock transport React integration", () => {
  let root: Root;

  beforeAll(async () => {
    const { writeEndpointMockConfig } = await import("./lib/endpointMock");
    const { validateEndpointConfig } = await import("./lib/endpoints");
    writeEndpointMockConfig(validateEndpointConfig({ version: 1, endpoints: [
      { id: "local", kind: "local", label: "Local" },
      { id: "123e4567-e89b-42d3-a456-426614174000", kind: "ssh", label: "Remote without directory", destination: "user@example.test" },
      { id: "123e4567-e89b-42d3-a456-426614174001", kind: "ssh", label: "Remote with directory", destination: "user@example.test", serversDirectory: "/srv/jmcl/servers" },
    ] }));
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    root = createRoot(
      (dom.document.getElementById("root") ??
        dom.document.body) as unknown as HTMLElement,
    );
    React.act(() => { root.render(React.createElement(App)); });
    await waitForBodyText("Vanilla 1.21.4");
  });

  afterAll(() => root?.unmount());

  test("loads the fixture without Tauri internals", () => {
    expect(dom.document.body.textContent).toContain("Vanilla 1.21.4");
    expect(dom.document.body.textContent).toContain("Fabric");
    expect(dom.document.body.textContent).not.toContain("Core error");
  });

  test("keeps primary navigation and account/core status available in a responsive shell", () => {
    const shell = dom.document.querySelector("body > div")!;
    const sidebar = dom.document.querySelector("aside")!;
    const nav = dom.document.querySelector("nav")!;
    const main = dom.document.querySelector("main")!;

    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("sm:flex-row");
    expect(sidebar.className).toContain("w-full");
    expect(sidebar.className).toContain("sm:w-52");
    expect(sidebar.className).toContain("sm:border-r");
    expect(nav.getAttribute("aria-label")).toBe("Primary navigation");
    expect(nav.className).toContain("flex-row");
    expect(nav.className).toContain("sm:flex-1");
    expect(nav.className).toContain("sm:flex-col");
    expect(nav.querySelector("button")?.getAttribute("aria-current")).toBe("page");
    expect(main.className).toContain("min-w-0");
    expect(main.className).toContain("min-h-0");
    expect(main.className).toContain("flex-1");
    expect(main.className).toContain("overflow-y-auto");

    for (const label of ["实例", "服务器", "Java", "设置"]) {
      const button = [...nav.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
      expect(button).toBeDefined();
      expect(button?.getAttribute("aria-label") ?? button?.textContent?.trim()).toContain(label);
      expect(button?.tagName).toBe("BUTTON");
    }
    expect(dom.document.body.textContent).toContain("离线模式");
    expect(dom.document.body.textContent).toContain("选择账户");
    expect(dom.document.body.textContent).toContain("核心已连接");
  });

  test("navigates by controls, blocks a missing remote directory, and returns to Local", async () => {
    const { endpointMockRequestCounts, endpointMockOpenSessionCount } = await import("./lib/endpointMock");
    const serversNav = [...dom.document.querySelectorAll("button")].find((button) => button.textContent?.includes("服务器"));
    expect(serversNav).toBeDefined();
    await (await import("react")).act(async () => { serversNav!.click(); });
    await waitForBodyText("服务器端点");
    const select = dom.document.querySelector("#server-endpoint") as unknown as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.textContent)).toEqual(["Local", "Remote without directory", "Remote with directory"]);
    await (await import("react")).act(async () => {
      select!.value = "123e4567-e89b-42d3-a456-426614174000";
      select!.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
      await waitForBodyText("需要远程服务器目录");
    });
    expect(dom.document.body.textContent).toContain("打开设置");
    expect(endpointMockRequestCounts()).toEqual({ list: 0, status: 0 });
    const settingsButton = [...dom.document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "打开设置");
    await (await import("react")).act(async () => { settingsButton!.click(); });
    await waitForBodyText("服务器端点");
    const serversAgain = [...dom.document.querySelectorAll("button")].find((button) => button.textContent?.includes("服务器"));
    await (await import("react")).act(async () => { serversAgain!.click(); });
    const localSelect = dom.document.querySelector("#server-endpoint") as unknown as HTMLSelectElement | null;
    await (await import("react")).act(async () => {
      localSelect!.value = "123e4567-e89b-42d3-a456-426614174001";
      localSelect!.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
      await waitForBodyText("Fabric Lab");
    });
    expect(endpointMockRequestCounts()).toEqual({ list: 1, status: 0 });
    expect(endpointMockOpenSessionCount()).toBe(1);
    await (await import("react")).act(async () => {
      localSelect!.value = "local";
      localSelect!.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
      await waitForBodyText("Vanilla Server");
    });
    expect(localSelect?.value).toBe("local");
    expect(endpointMockOpenSessionCount()).toBe(0);
  });
});
