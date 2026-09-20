import { describe, expect, test } from "bun:test";
import { launchExecuteParams } from "./rpc";

describe("launch.execute wire params", () => {
  test("keeps instance, loader, Java, and source fields at the top level", () => {
    const auth = {
      player_name: "Player",
      uuid: "0123456789abcdef0123456789abcdef",
      access_token: "offline",
    };
    const params = launchExecuteParams("1.21.1", "/instances/fabric/.minecraft", auth, {
      source: "bmclapi",
      store_directory: "/store",
      fabric_loader: "0.16.10",
      java_override: "/java/bin/java",
      options: { resolution_width: 1280, resolution_height: 720 },
    });

    expect(params).toEqual({
      id: "1.21.1",
      directory: "/instances/fabric/.minecraft",
      auth,
      source: "bmclapi",
      store_directory: "/store",
      fabric_loader: "0.16.10",
      java_override: "/java/bin/java",
      options: { resolution_width: 1280, resolution_height: 720 },
    });
    expect(params.options).not.toMatchObject({
      source: expect.anything(),
      store_directory: expect.anything(),
      fabric_loader: expect.anything(),
      java_override: expect.anything(),
    });
  });
});