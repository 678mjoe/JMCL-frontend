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

test("download preferences validate independently against Core integer bounds", () => {
  expect(mergeStoredSettings({}).downloadWorkers).toBe(8);
  expect(mergeStoredSettings({}).downloadRetries).toBe(2);
  for (const value of [null, "4", NaN, Infinity, -1, 0, 1.5, 33]) expect(mergeStoredSettings({ downloadWorkers: value, downloadRetries: 0 }).downloadWorkers).toBe(8);
  for (const value of [null, "2", NaN, Infinity, -1, 1.5, 6]) expect(mergeStoredSettings({ downloadWorkers: 32, downloadRetries: value }).downloadRetries).toBe(2);
  const settings = mergeStoredSettings({ downloadWorkers: 32, downloadRetries: 0, storeDir: "/kept" });
  expect([settings.downloadWorkers, settings.downloadRetries, settings.storeDir]).toEqual([32, 0, "/kept"]);
});
