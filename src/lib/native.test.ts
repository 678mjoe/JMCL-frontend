import { describe, expect, test } from "bun:test";
import { appDataDirectories } from "./native";

describe("native app-data directories", () => {
  test("includes the mock server directory", async () => {
    await expect(appDataDirectories()).resolves.toEqual({
      instancesDir: "/mock/jmcl/instances",
      storeDir: "/mock/jmcl/store",
      serversDir: "/mock/jmcl/servers",
    });
  });
});
