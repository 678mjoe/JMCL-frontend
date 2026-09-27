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
