import { describe, expect, test } from "bun:test";
import { CoreSession } from "./rpc";
import {
  createMockFixture,
  initializeMockFixture,
  mockRequest,
  resetMockFixture,
} from "./mockTransport";

describe("mock transport scenarios", () => {
  test("builds the first fixture from the URL-selected empty scenario", () => {
    const globals = globalThis as typeof globalThis & { location?: Location };
    const previousLocation = globals.location;
    Object.defineProperty(globals, "location", {
      configurable: true,
      value: { search: "?jmclMockScenario=empty" },
    });

    try {
      const initial = initializeMockFixture();
      expect(initial.scenario).toBe("empty");
      expect(initial.fixture).toEqual(createMockFixture("empty"));
      expect(initial.fixture.instances).toEqual([]);
      expect(initial.fixture.accounts).toEqual([]);
      expect(initial.fixture.runtimes).toEqual([]);
    } finally {
      if (previousLocation === undefined) Reflect.deleteProperty(globals, "location");
      else globals.location = previousLocation;
    }
  });

  test("runs the Minecraft refresh exchange with the core method and rotated shape", async () => {
    resetMockFixture("default");
    const session = await CoreSession.open();
    const result = await session.authMinecraftRefreshExchange(
      "mock-client-id",
      "old-refresh-token",
    );

    expect(result).toEqual({
      state: "authenticated",
      refresh_token: "mock-refresh-token-rotated",
      session: {
        player_name: "MockSteve",
        uuid: "mock-player-uuid",
        access_token: "mock-access-token",
        xuid: "123456789",
      },
    });
  });

  test("performs the core.version handshake through public CoreSession.open", async () => {
    resetMockFixture("default");
    await expect(CoreSession.open()).resolves.toMatchObject({
      core: { name: "jmcl-core", protocol: 1 },
    });

    resetMockFixture("errors");
    await expect(CoreSession.open()).rejects.toMatchObject({
      code: "MOCK_SCENARIO_ERROR",
    });
  });

  test("provides isolated default, empty, and deterministic error fixtures", async () => {
    resetMockFixture("default");
    expect(
      (await mockRequest<{ instances: unknown[] }>("instance.list", {}))
        .instances,
    ).toHaveLength(5);
    expect(
      (await mockRequest<{ accounts: unknown[] }>("account.microsoft.list", {}))
        .accounts,
    ).toHaveLength(1);
    expect(
      (await mockRequest<{ runtimes: unknown[] }>("java.runtime.list", {}))
        .runtimes,
    ).toHaveLength(1);

    resetMockFixture("empty");
    expect(
      (await mockRequest<{ instances: unknown[] }>("instance.list", {}))
        .instances,
    ).toEqual([]);
    expect(
      (await mockRequest<{ accounts: unknown[] }>("account.microsoft.list", {}))
        .accounts,
    ).toEqual([]);
    expect(
      (await mockRequest<{ runtimes: unknown[] }>("java.runtime.list", {}))
        .runtimes,
    ).toEqual([]);
    expect(
      (
        await mockRequest<{ worlds: unknown[] }>("worlds.list", {
          directory: "/mock/instances/none/.minecraft",
        })
      ).worlds,
    ).toEqual([]);

    resetMockFixture("errors");
    await expect(mockRequest("instance.list", {})).rejects.toMatchObject({
      code: "MOCK_SCENARIO_ERROR",
    });

    resetMockFixture("default");
    expect(
      (await mockRequest<{ instances: unknown[] }>("instance.list", {}))
        .instances,
    ).toHaveLength(5);
  });

  test("persists account and managed Java mutations across list calls", async () => {
    resetMockFixture("default");
    const session = await CoreSession.open();
    const exchange = await session.authMinecraftExchange(
      "mock-client-id",
      "mock-access-token",
    );
    const account = {
      id: exchange.session.uuid,
      player_name: exchange.session.player_name,
      client_id: "mock-client-id",
      xuid: exchange.session.xuid,
    };
    await session.accountSave(account);
    expect((await session.accountList()).accounts).toContainEqual(account);
    await session.accountDelete(account.id);
    expect((await session.accountList()).accounts).not.toContainEqual(account);

    const installed = await mockRequest<{ name: string }>(
      "java.runtime.install",
      { major: 17 },
    );
    expect(
      (
        await mockRequest<{ runtimes: { name: string }[] }>(
          "java.runtime.list",
          {},
        )
      ).runtimes,
    ).toContainEqual(expect.objectContaining({ name: installed.name }));
    await mockRequest("java.runtime.remove", { runtime: installed.name });
    expect(
      (await mockRequest<{ runtimes: unknown[] }>("java.runtime.list", {}))
        .runtimes,
    ).not.toContainEqual(expect.objectContaining({ name: installed.name }));
  });

  test("forwards managed-runtime launch events in the real stage/progress wire shape", async () => {
    resetMockFixture("default");
    const session = await CoreSession.open();
    const events: Record<string, unknown>[] = [];
    await session.launchExecute(
      "1.21.4",
      "/mock/jmcl/instances/vanilla-1214/.minecraft",
      {
        player_name: "MockSteve",
        uuid: "mock-player-uuid",
        access_token: "mock-access-token",
      },
      {},
      (event) => {
        if (event.kind === "event") events.push(event.data);
      },
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "stage", stage: "download" }),
        expect.objectContaining({
          event: "progress",
          progress: expect.objectContaining({
            bytes_processed: 1024,
            bytes_total: 2048,
          }),
        }),
      ]),
    );
  });

  test("enforces worlds errors and replace semantics through public wrappers", async () => {
    resetMockFixture("default");
    const session = await CoreSession.open();
    const directory = "/mock/jmcl/instances/vanilla-1214/.minecraft";
    await expect(session.worldsGet(directory, "missing")).rejects.toMatchObject({
      code: "WORLD_NOT_FOUND",
    });
    await expect(session.worldsDelete(directory, "missing")).rejects.toMatchObject({
      code: "WORLD_NOT_FOUND",
    });
    await expect(session.worldsDelete(directory, "Locked Server World")).rejects.toMatchObject({
      code: "WORLD_LOCKED",
    });
    await expect(
      session.worldsExport(directory, "missing", "/tmp/missing.zip"),
    ).rejects.toMatchObject({ code: "WORLD_NOT_FOUND" });
    await expect(
      session.worldsExport(directory, "Locked Server World", "/tmp/locked.zip"),
    ).rejects.toMatchObject({ code: "WORLD_LOCKED" });
    await expect(session.worldsBackup(directory, "missing")).rejects.toMatchObject({
      code: "WORLD_NOT_FOUND",
    });
    await expect(
      session.worldsBackup(directory, "Locked Server World"),
    ).rejects.toMatchObject({ code: "WORLD_LOCKED" });
    await expect(
      session.worldsBackupsDelete(directory, "missing-backup.zip"),
    ).rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });
    await expect(
      session.worldsImport(directory, "/tmp/world.zip", { name: "Survival" }),
    ).rejects.toMatchObject({ code: "WORLD_EXISTS" });
    await expect(
      session.worldsRestore(directory, "missing-backup.zip"),
    ).rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });
    await expect(
      session.worldsImport(directory, "/tmp/world.zip", {
        name: "Survival",
        replace: true,
      }),
    ).resolves.toMatchObject({ world: { name: "Survival" } });
    await expect(
      session.worldsRestore(directory, "Survival-20260920-120000.zip", {
        name: "Survival",
        replace: true,
      }),
    ).resolves.toMatchObject({ world: { name: "Survival" } });
  });
});
