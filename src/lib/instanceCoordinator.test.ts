import { describe, expect, test } from "bun:test";
import {
  InstanceBusyError,
  InstanceOperationCoordinator,
  instanceMutationKey,
  instanceMutationKeyFromGameDirectory,
} from "./instanceCoordinator";
import { resetMockFixture } from "./mockTransport";
import { CoreSession } from "./rpc";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("InstanceOperationCoordinator", () => {
  test("keys an instance by its root and id across slash styles", () => {
    expect(instanceMutationKey("C:\\JMCL\\instances", "alpha")).toBe(
      "C:/JMCL/instances/alpha",
    );
    expect(
      instanceMutationKeyFromGameDirectory("C:\\JMCL\\instances\\alpha\\.minecraft"),
    ).toBe("C:/JMCL/instances/alpha");
    expect(
      instanceMutationKeyFromGameDirectory("/srv//jmcl/instances/./temp/../alpha/.minecraft/"),
    ).toBe("/srv/jmcl/instances/alpha");
    expect(
      instanceMutationKeyFromGameDirectory("C:\\JMCL\\instances\\temp\\..\\alpha\\.minecraft"),
    ).toBe("C:/JMCL/instances/alpha");
  });
  test("releases after success and exception", async () => {
    const coordinator = new InstanceOperationCoordinator();
    await coordinator.run("alpha", "install", async () => "ok");
    expect(coordinator.isBusy("alpha")).toBe(false);
    await expect(coordinator.run("alpha", "delete", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(coordinator.isBusy("alpha")).toBe(false);
  });

  test("rejects a same-instance conflict but runs different instances concurrently", async () => {
    const coordinator = new InstanceOperationCoordinator();
    let alphaFinished = false;
    const alpha = coordinator.run("alpha", "launch", async () => {
      await wait(25);
      alphaFinished = true;
    });
    await expect(coordinator.run("alpha", "content-install", async () => undefined)).rejects.toBeInstanceOf(InstanceBusyError);
    const beta = coordinator.run("beta", "install", async () => undefined);
    await beta;
    expect(alphaFinished).toBe(false);
    await alpha;
    expect(coordinator.operationFor("alpha")).toBeUndefined();
  });

  test("public mutation wrappers coordinate one game directory but not equal ids in different roots", async () => {
    resetMockFixture("default");
    const firstSession = await CoreSession.open();
    const secondSession = await CoreSession.open();
    const sameDirectory = "/one/instances/alpha/.minecraft";
    const first = firstSession.installExecute("1.21.4", { directory: sameDirectory });
    await expect(
      secondSession.installPrepare("1.21.4", { directory: sameDirectory }),
    ).rejects.toBeInstanceOf(InstanceBusyError);
    await first;

    const auth = {
      player_name: "MockSteve",
      uuid: "mock-player-uuid",
      access_token: "mock-access-token",
    };
    const launch = firstSession.launchExecute("1.21.4", sameDirectory, auth);
    await expect(
      secondSession.installExecute("1.21.4", { directory: sameDirectory }),
    ).rejects.toBeInstanceOf(InstanceBusyError);
    await launch;

    const modpack = firstSession.modpackInstall(
      "/one/instances",
      "alpha",
      "/tmp/alpha.zip",
    );
    await expect(
      secondSession.installExecute("1.21.4", { directory: sameDirectory }),
    ).rejects.toBeInstanceOf(InstanceBusyError);
    await modpack;

    await expect(
      Promise.all([
        firstSession.installExecute("1.21.4", {
          directory: "/one/instances/alpha/.minecraft",
        }),
        secondSession.installExecute("1.21.4", {
          directory: "C:\\two\\instances\\alpha\\.minecraft",
        }),
      ]),
    ).resolves.toHaveLength(2);
    await Promise.all([firstSession.close(), secondSession.close()]);
  });
});
