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
import { LauncherContext } from "@/lib/launcher";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = {
  id: "demo", name: "Demo", version_id: "1.21.4", fabric_loader: null,
  neoforge_version: null, forge_version: null, source: "bmclapi",
  accept_eula: false, java_path: null, installed: false,
};
const operations: OperationsContextValue = { operationFor: () => undefined, install: async () => true, start: async () => true, stop: async () => true, restart: async () => true, delete: async () => true };

function detailMarkup(overrides: Partial<ServersContextValue> = {}, operationContext: OperationsContextValue = operations) {
  const value: ServersContextValue = {
    manifests: [server], cache: createEmptyServerStatusCache(), loading: false,
    listError: null, statusErrors: {}, pendingStatus: new Set(), directory: "/mock/servers",
    refreshList: async () => {}, refreshServerStatus: async () => {}, recordCreated: async () => {},
    captureOperationScope: () => null, isOperationScopeCurrent: () => false,
    recordInstalled: async () => false, recordStarted: async () => false, recordStopped: async () => false,
    recordLifecycleError: async () => false, recordDeleted: async () => false,
    prepareEndpointDeletion: async () => {},
    cleanupEndpointCache: async () => {},
    endpointId: "local",
    coreStatus: "ready", coreError: null, openSession: async () => { throw new Error("not expected in static test"); }, ...overrides,
  };
  return renderToStaticMarkup(
    <LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession: async () => { throw new Error("not expected in static test"); } }}>
    <SettingsProvider>
      <ServersContext.Provider value={value}>
        <OperationsContext.Provider value={operationContext}>
          <ServerDetailPage serverId="demo" onBack={() => {}} />
        </OperationsContext.Provider>
      </ServersContext.Provider>
    </SettingsProvider>,
    </LauncherContext.Provider>,
  );
}

describe("ServerDetailPage", () => {
  test("keeps remote core, list, status and operation diagnostics out of the UI", () => {
    const core = detailMarkup({ endpointId: "ssh-remote", coreStatus: "error", coreError: "SSH_HOST_KEY_UNKNOWN: user@PRIVATE_HOST" });
    expect(core).toContain("未知主机密钥");
    expect(core).not.toContain("PRIVATE_HOST");

    const list = detailMarkup({ endpointId: "ssh-remote", listError: "SSH_DISCONNECTED: PRIVATE_HOST" });
    expect(list).toContain("连接已断开");
    expect(list).not.toContain("PRIVATE_HOST");

    const operationContext = { ...operations, operationFor: () => ({ kind: "start" as const, pending: false, stage: "running" as const, progress: null, error: "SSH_DISCONNECTED: PRIVATE_HOST" }) };
    const detail = detailMarkup({ endpointId: "ssh-remote", statusErrors: { demo: "PRIVATE_HOST" } }, operationContext);
    expect(detail).toContain("状态刷新失败");
    expect(detail).toContain("连接已断开");
    expect(detail).not.toContain("PRIVATE_HOST");
  });

  test("shows no-record copy for unknown status and visible BMCLAPI attribution", () => {
    const markup = detailMarkup();
    expect(markup).toContain("未知（未检查）");
    expect(markup).toContain("尚无状态记录");
    expect(markup).toContain("BMCLAPI");
    expect(markup).toContain("最后已知状态");
  });

  test("uses the selected endpoint cache state when local and remote conflict", () => {
    const base = createEmptyServerStatusCache();
    const stopped = { state: "stopped" as const, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, checked_at_ms: 100, last_stale_cleanup_at_ms: null };
    const running = { ...stopped, state: "running" as const, pid: 42, supervisor_pid: 41, java_path: "/remote/java", started_at_ms: 50 };
    const markup = detailMarkup({
      endpointId: "ssh-remote",
      manifests: [{ ...server, installed: true }],
      cache: { ...base, scopes: {
        local: { directory: "/mock/servers", servers: { demo: stopped } },
        "ssh-remote": { directory: "/mock/servers", servers: { demo: running } },
      } },
    });
    expect(markup).toContain("最后已知：运行中");
    expect(markup).toContain("/remote/java");
    expect(markup).toContain("停止</button>");
    expect(markup).not.toContain("启动</button>");
  });

  test("created server exposes install and delete, while unknown installed server only refreshes", () => {
    const created = detailMarkup();
    expect(created).toContain(">安装</button>");
    expect(created).toContain("删除服务器");
    expect(created).not.toContain("打开控制台");
    const unknown = detailMarkup({ manifests: [{ ...server, installed: true }] });
    expect(unknown).toContain("刷新状态");
    expect(unknown).not.toContain("启动</button>");
    expect(unknown).not.toContain("删除服务器</button>");
    expect(unknown).not.toContain("打开控制台");
  });

  test("stopped and running states expose only matrix lifecycle actions and stale cleanup copy", () => {
    const base = createEmptyServerStatusCache();
    const stopped = { state: "stopped" as const, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, checked_at_ms: 100, last_stale_cleanup_at_ms: 90 };
    const stoppedMarkup = detailMarkup({ manifests: [{ ...server, installed: true }], cache: { ...base, scopes: { local: { directory: "/mock/servers", servers: { demo: stopped } } } } });
    expect(stoppedMarkup).toContain("启动</button>");
    expect(stoppedMarkup).toContain("打开控制台");
    expect(stoppedMarkup).toContain("删除服务器</button>");
    expect(stoppedMarkup).toContain("检测到过期运行状态");
    const running = { ...stopped, state: "running" as const, pid: 42, supervisor_pid: 41, java_path: "/java", started_at_ms: 50, last_stale_cleanup_at_ms: null };
    const runningMarkup = detailMarkup({ manifests: [{ ...server, installed: true }], cache: { ...base, scopes: { local: { directory: "/mock/servers", servers: { demo: running } } } } });
    expect(runningMarkup).toContain("停止</button>");
    expect(runningMarkup).toContain("打开控制台");
    expect(runningMarkup).not.toContain(">发送命令</button>");
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
        prepareEndpointDeletion: async () => {},
        cleanupEndpointCache: async () => {},
        coreStatus: "ready", coreError: null, endpointId: "local", openSession: async () => { throw new Error("not expected in static test"); },
      };
      return <LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession: async () => { throw new Error("not expected in static test"); } }}><SettingsProvider><ServersContext.Provider value={{ ...value, openSession: async () => { throw new Error("not expected in static test"); } }}><OperationsContext.Provider value={operations}><ServerDetailPage serverId="demo" onBack={() => {}} /></OperationsContext.Provider></ServersContext.Provider></SettingsProvider></LauncherContext.Provider>;
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
