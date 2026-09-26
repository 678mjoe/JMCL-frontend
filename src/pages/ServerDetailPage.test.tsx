import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerDetailPage } from "./ServerDetailPage";
import { ServersContext, type ServersContextValue } from "@/lib/servers";
import { SettingsProvider } from "@/lib/settings";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = {
  id: "demo", name: "Demo", version_id: "1.21.4", fabric_loader: null,
  neoforge_version: null, forge_version: null, source: "bmclapi",
  accept_eula: false, java_path: null, installed: false,
};

function detailMarkup(overrides: Partial<ServersContextValue> = {}) {
  const value: ServersContextValue = {
    manifests: [server], cache: createEmptyServerStatusCache(), loading: false,
    listError: null, statusErrors: {}, pendingStatus: new Set(), directory: "/mock/servers",
    refreshList: async () => {}, refreshServerStatus: async () => {}, recordCreated: async () => {},
    coreStatus: "ready", coreError: null, ...overrides,
  };
  return renderToStaticMarkup(
    <SettingsProvider>
      <ServersContext.Provider value={value}>
        <ServerDetailPage serverId="demo" onBack={() => {}} />
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
    expect(markup).not.toContain("最后已知状态");
  });
});
