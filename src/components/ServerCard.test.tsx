import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerCard } from "./ServerCard";
import { SettingsProvider } from "@/lib/settings";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = {
  id: "demo",
  name: "Demo",
  version_id: "1.21.4",
  fabric_loader: "0.16.10",
  neoforge_version: null,
  forge_version: null,
  source: "official",
  accept_eula: false,
  java_path: null,
  installed: true,
};

describe("ServerCard", () => {
  test("labels cached lifecycle state as last known and shows its check time", () => {
    const markup = renderToStaticMarkup(
      <SettingsProvider>
        <ServerCard
          server={server}
          cachedStatus={{
            state: "running",
            pid: 42,
            supervisor_pid: 7,
            java_path: "/mock/java",
            started_at_ms: 100,
            checked_at_ms: 1_700_000_000_000,
            last_stale_cleanup_at_ms: null,
          }}
          pending={false}
          onRefreshStatus={() => {}}
          onOpen={() => {}}
        />
      </SettingsProvider>,
    );

    expect(markup).toContain("最后已知：运行中");
    expect(markup).toContain("最后检查");
    expect(markup).toContain("Fabric 0.16.10");
  });

  test("renders unknown without implying a live status", () => {
    const markup = renderToStaticMarkup(
      <SettingsProvider>
        <ServerCard server={server} pending={false} onRefreshStatus={() => {}} onOpen={() => {}} />
      </SettingsProvider>,
    );
    expect(markup).toContain("未知（未检查）");
    expect(markup).toContain("尚无状态记录");
    expect(markup).not.toContain("最后已知状态");
  });

  test("shows BMCLAPI attribution", () => {
    const markup = renderToStaticMarkup(
      <SettingsProvider>
        <ServerCard server={{ ...server, source: "bmclapi" }} pending={false} onRefreshStatus={() => {}} onOpen={() => {}} />
      </SettingsProvider>,
    );
    expect(markup).toContain("BMCLAPI");
  });

  test("labels created cache records locally and includes their cache time", () => {
    const markup = renderToStaticMarkup(
      <SettingsProvider>
        <ServerCard server={server} cachedStatus={{
          state: "created", pid: null, supervisor_pid: null, java_path: null,
          started_at_ms: null, checked_at_ms: 1_700_000_000_000, last_stale_cleanup_at_ms: null,
        }} pending={false} onRefreshStatus={() => {}} onOpen={() => {}} />
      </SettingsProvider>,
    );
    expect(markup).toContain("本地创建");
    expect(markup).toContain("缓存时间");
    expect(markup).not.toContain("最后检查");
  });
});
