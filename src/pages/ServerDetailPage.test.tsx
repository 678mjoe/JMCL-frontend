import { describe, expect, jest, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerDetailPage } from "./ServerDetailPage";
import { ServersContext, type ServersContextValue } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";
import { OperationsContext, type OperationsContextValue } from "@/lib/serverOperations";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = {
  id: "demo", name: "Demo", version_id: "1.21.4", fabric_loader: null,
  neoforge_version: null, forge_version: null, source: "bmclapi",
  accept_eula: false, java_path: null, installed: false,
};
const operations: OperationsContextValue = { operationFor: () => undefined, install: async () => true, start: async () => true, stop: async () => true, restart: async () => true, delete: async () => true };

function detailMarkup(overrides: Partial<ServersContextValue> = {}) {
  const value: ServersContextValue = {
    manifests: [server], cache: createEmptyServerStatusCache(), loading: false,
    listError: null, statusErrors: {}, pendingStatus: new Set(), directory: "/mock/servers",
    refreshList: async () => {}, refreshServerStatus: async () => {}, recordCreated: async () => {},
    captureOperationScope: () => null, isOperationScopeCurrent: () => false,
    recordInstalled: async () => false, recordStarted: async () => false, recordStopped: async () => false,
    recordLifecycleError: async () => false, recordDeleted: async () => false,
    coreStatus: "ready", coreError: null, ...overrides,
  };
  return renderToStaticMarkup(
    <SettingsProvider>
      <ServersContext.Provider value={value}>
        <OperationsContext.Provider value={operations}>
          <ServerDetailPage serverId="demo" onBack={() => {}} />
        </OperationsContext.Provider>
      </ServersContext.Provider>
    </SettingsProvider>,
  );
}

describe("ServerDetailPage", () => {
  test("shows no-record copy for unknown status and visible BMCLAPI attribution", () => {
    const markup = detailMarkup();
    expect(markup).toContain("未知（未检查）");
    expect(markup).toContain("尚无状态记录");
    expect(markup).toContain("BMCLAPI");
    expect(markup).toContain("最后已知状态");
  });

  test("created server exposes install and delete, while unknown installed server only refreshes", () => {
    const created = detailMarkup();
    expect(created).toContain(">安装</button>");
    expect(created).toContain("删除服务器");
    const unknown = detailMarkup({ manifests: [{ ...server, installed: true }] });
    expect(unknown).toContain("刷新状态");
    expect(unknown).not.toContain("启动</button>");
    expect(unknown).not.toContain("删除服务器</button>");
  });

  test("stopped and running states expose only matrix lifecycle actions and stale cleanup copy", () => {
    const base = createEmptyServerStatusCache();
    const stopped = { state: "stopped" as const, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, checked_at_ms: 100, last_stale_cleanup_at_ms: 90 };
    const stoppedMarkup = detailMarkup({ manifests: [{ ...server, installed: true }], cache: { ...base, scopes: { local: { directory: "/mock/servers", servers: { demo: stopped } } } } });
    expect(stoppedMarkup).toContain("启动</button>");
    expect(stoppedMarkup).toContain("删除服务器</button>");
    expect(stoppedMarkup).toContain("检测到过期运行状态");
    const running = { ...stopped, state: "running" as const, pid: 42, supervisor_pid: 41, java_path: "/java", started_at_ms: 50, last_stale_cleanup_at_ms: null };
    const runningMarkup = detailMarkup({ manifests: [{ ...server, installed: true }], cache: { ...base, scopes: { local: { directory: "/mock/servers", servers: { demo: running } } } } });
    expect(runningMarkup).toContain("停止</button>");
    expect(runningMarkup).toContain("重启</button>");
    expect(runningMarkup).not.toContain("删除服务器</button>");
    expect(runningMarkup).toContain("/java");
  });

  test("running uptime advances and its timer stops when the server stops", async () => {
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
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const base = createEmptyServerStatusCache();
    const running = { state: "running" as const, pid: 42, supervisor_pid: 41, java_path: "/java", started_at_ms: 10_000, checked_at_ms: 15_000, last_stale_cleanup_at_ms: null };
    const stopped = { ...running, state: "stopped" as const, pid: null, supervisor_pid: null, started_at_ms: null };
    const renderPage = (status: typeof running | typeof stopped) => {
      const cache = { ...base, scopes: { local: { directory: "/mock/servers", servers: { demo: status } } } };
      const value: ServersContextValue = {
        manifests: [{ ...server, installed: true }], cache, loading: false,
        listError: null, statusErrors: {}, pendingStatus: new Set(), directory: "/mock/servers",
        refreshList: async () => {}, refreshServerStatus: async () => {}, recordCreated: async () => {},
        captureOperationScope: () => null, isOperationScopeCurrent: () => false,
        recordInstalled: async () => false, recordStarted: async () => false, recordStopped: async () => false,
        recordLifecycleError: async () => false, recordDeleted: async () => false,
        coreStatus: "ready", coreError: null,
      };
      return <SettingsProvider><ServersContext.Provider value={value}><OperationsContext.Provider value={operations}><ServerDetailPage serverId="demo" onBack={() => {}} /></OperationsContext.Provider></ServersContext.Provider></SettingsProvider>;
    };

    jest.useFakeTimers({ now: 15_000 });
    const intervalSpy = jest.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    try {
      await act(async () => root.render(renderPage(running)));
      expect(container.textContent).toContain("0:00:05");
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(container.textContent).toContain("0:00:07");
      await act(async () => root.render(renderPage(stopped)));
      expect(intervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalSpy.mock.results[0]?.value);
    } finally {
      await act(async () => root.unmount());
      jest.useRealTimers();
      jest.restoreAllMocks();
      dom.happyDOM.abort();
    }
  });
});
