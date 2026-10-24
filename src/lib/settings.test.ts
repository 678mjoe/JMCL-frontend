import { describe, expect, test } from "bun:test";
import { mergeStoredSettings } from "./settings";

describe("settings migration", () => {
  test("adds local endpoint selection while preserving existing settings", () => {
    const settings = mergeStoredSettings({ theme: "dark", serversDir: "/existing/servers" });
    expect(settings.selectedServerEndpointId).toBe("local");
    expect(settings.serversDir).toBe("/existing/servers");
    expect(settings.theme).toBe("dark");
  });
});

 test("malformed individual preferences do not crash startup or erase valid legacy values", () => {
  const settings = mergeStoredSettings({ theme: 1, language: null, instancesDir: [], storeDir: "/keep", javaOverrides: null, activeAccountId: {}, launchOptions: { version: 999 } });
  expect(settings.theme).toBe("system"); expect(settings.language).toBe("zh"); expect(settings.instancesDir).toBe(""); expect(settings.storeDir).toBe("/keep"); expect(settings.javaOverrides).toEqual({}); expect(settings.activeAccountId).toBeNull(); expect(settings.launchOptions).toEqual({version:1,instances:{}});
 });
