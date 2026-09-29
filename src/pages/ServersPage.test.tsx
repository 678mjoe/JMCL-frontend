import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServersPage } from "./ServersPage";
import { ServersContext, type ServersContextValue } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import { LauncherProvider } from "@/lib/launcher";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = { id: "demo", name: "Demo", version_id: "1.21.4", fabric_loader: null, neoforge_version: null, forge_version: null, source: "official", accept_eula: false, java_path: null, installed: false };

function pageMarkup(overrides: Partial<ServersContextValue> = {}) {
  const value: ServersContextValue = {
    manifests: [],
    cache: createEmptyServerStatusCache(),
    loading: false,
    listError: null,
    statusErrors: {},
    pendingStatus: new Set(),
    directory: "/mock/jmcl/servers",
    refreshList: async () => {},
    refreshServerStatus: async () => {},
    recordCreated: async () => {},
    captureOperationScope: () => null,
    isOperationScopeCurrent: () => false,
    recordInstalled: async () => false,
    recordStarted: async () => false,
    recordStopped: async () => false,
    recordLifecycleError: async () => false,
    recordDeleted: async () => false,
    prepareEndpointDeletion: async () => {},
    cleanupEndpointCache: async () => {},
    coreStatus: "ready",
    coreError: null,
    endpointId: "local",
    openSession: async () => { throw new Error("not expected in static test"); },
    ...overrides,
  };
  return renderToStaticMarkup(
    <SettingsProvider>
      <LauncherProvider>
        <ServersContext.Provider value={value}>
          <ServersPage onOpenDetail={() => {}} />
        </ServersContext.Provider>
      </LauncherProvider>
    </SettingsProvider>,
  );
}

describe("ServersPage states", () => {
  test("keeps empty and list-error states distinct", () => {
    const empty = pageMarkup();
    const error = pageMarkup({ listError: "server.list failed" });

    expect(empty).toContain("还没有服务器");
    expect(empty).not.toContain("服务器列表加载失败");
    expect(error).toContain("服务器列表加载失败");
    expect(error).not.toContain("还没有服务器");
  });

  test("renders the selected endpoint cache state when local and remote conflict", () => {
    const base = createEmptyServerStatusCache();
    const status = (state: "running" | "stopped") => ({ state, pid: state === "running" ? 42 : null, supervisor_pid: state === "running" ? 41 : null, java_path: null, started_at_ms: null, checked_at_ms: 100, last_stale_cleanup_at_ms: null });
    const markup = pageMarkup({
      endpointId: "ssh-remote",
      manifests: [server],
      cache: { ...base, scopes: {
        local: { directory: "/mock/jmcl/servers", servers: { demo: status("stopped") } },
        "ssh-remote": { directory: "/mock/jmcl/servers", servers: { demo: status("running") } },
      } },
    });
    expect(markup).toContain("最后已知：运行中");
    expect(markup).not.toContain("最后已知：已停止");
  });
});
