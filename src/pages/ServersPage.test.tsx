import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServersPage } from "./ServersPage";
import { ServersContext, type ServersContextValue } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import { LauncherProvider } from "@/lib/launcher";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";

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
    coreStatus: "ready",
    coreError: null,
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
});
