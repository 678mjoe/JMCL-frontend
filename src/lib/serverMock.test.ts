import { describe, expect, test } from "bun:test";
import { CoreSession } from "./rpc";
import { resetMockFixture, replaceMockServerLog, rotateMockServerLog } from "./mockTransport";
import {
  createServerMockState,
  dispatchServerMockRequest,
  SERVER_MOCK_METHODS,
} from "./serverMock";

const directory = "/mock/jmcl/servers";

async function openDefault(): Promise<CoreSession> {
  resetMockFixture("default");
  return CoreSession.open();
}

async function errorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return String((error as { code?: string }).code);
  }
  throw new Error("expected a stable RPC error");
}

function dispatchErrorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return String((error as { code?: string }).code);
  }
  throw new Error("expected a stable RPC error");
}

describe("server mock scenarios and lifecycle", () => {
  test("provides default and empty server lists with reset isolation", async () => {
    const session = await openDefault();
    expect((await session.serverList(directory)).servers.map((server) => server.id)).toEqual([
      "fabric-lab",
      "java-incompatible",
      "running-demo",
      "stale-demo",
      "survival",
      "vanilla-server",
    ]);

    resetMockFixture("empty");
    expect((await (await CoreSession.open()).serverList(directory)).servers).toEqual([]);

    resetMockFixture("default");
    expect((await (await CoreSession.open()).serverGet(directory, "survival")).installed).toBe(true);
  });

  test("preserves the global errors scenario behavior", async () => {
    resetMockFixture("errors");
    const session = await CoreSession.open().catch(() => null);
    expect(session).toBeNull();
    resetMockFixture("default");
    await expect((await CoreSession.open()).serverList(directory)).resolves.toBeDefined();
  });

  test("drives the complete create, install, start, log, command, stop, and delete flow", async () => {
    const session = await openDefault();
    await session.serverCreate(directory, "new-server", "1.21.4", {
      name: "New Server",
      fabric_loader: "0.16.10",
      accept_eula: false,
    });
    expect(await errorCode(() => session.serverInstall(directory, "new-server", { accept_eula: false } as never))).toBe("EULA_NOT_ACCEPTED");

    const events: unknown[] = [];
    const install = await session.serverInstall(directory, "new-server", { accept_eula: true }, (event) => {
      if (event.kind === "event") events.push(event.data);
    });
    expect(install).toMatchObject({ stage: "server.install", id: "new-server", properties_created: true });
    expect(events.map((event) => (event as { event: string }).event)).toEqual(["started", "progress"]);
    expect((await session.serverGet(directory, "new-server")).installed).toBe(true);
    expect((await session.serverList(directory)).servers.find((server) => server.id === "new-server")).toMatchObject({
      installed: true,
      accept_eula: true,
    });

    const started = await session.serverStart(directory, "new-server");
    expect(started).toMatchObject({ stage: "server.start", running: true, pid: expect.any(Number) });
    expect(await session.serverStatus(directory, "new-server")).toMatchObject({ running: true, stale_state: false });
    const initial = await session.serverLogs(directory, "new-server");
    expect(initial.text).toContain("Done");
    const command = "say hello";
    await expect(session.serverCommand(directory, "new-server", command)).resolves.toMatchObject({ accepted: true });
    const resumed = await session.serverLogs(directory, "new-server", {
      cursor: initial.next_cursor,
      file_id: initial.file_id,
    });
    expect(resumed.reset).toBe(false);
    expect(resumed.text).toContain(command);
    expect(await session.serverStop(directory, "new-server")).toMatchObject({ running: false, termination: "graceful" });
    expect(await session.serverStatus(directory, "new-server")).toMatchObject({ running: false, pid: null });
    await session.serverDelete(directory, "new-server");
    expect((await session.serverList(directory)).servers.some((server) => server.id === "new-server")).toBe(false);
  });

  test("clears stale-demo's stale flag after its first explicit status", async () => {
    const session = await openDefault();
    expect(await session.serverStatus(directory, "stale-demo")).toMatchObject({ running: false, stale_state: true });
    expect(await session.serverStatus(directory, "stale-demo")).toMatchObject({ running: false, stale_state: false });
  });

  test("keeps Java incompatibility deterministic and EULA-gated", async () => {
    const session = await openDefault();
    expect(await errorCode(() => session.serverInstall(directory, "java-incompatible", { accept_eula: false } as never))).toBe("EULA_NOT_ACCEPTED");
    expect(await errorCode(() => session.serverInstall(directory, "java-incompatible", { accept_eula: true }))).toBe("JAVA_INCOMPATIBLE");
    expect((await session.serverGet(directory, "java-incompatible")).installed).toBe(false);
  });

  test("closes numeric and boolean parameter boundaries before mutating state", () => {
    const validCases: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, workers: 1 } },
      { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, workers: 32 } },
      { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, retries: 0 } },
      { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, retries: 5 } },
      { method: "server.stop", params: { directory, id: "running-demo", grace_ms: 0 } },
      { method: "server.stop", params: { directory, id: "running-demo", grace_ms: 120000 } },
      { method: "server.restart", params: { directory, id: "running-demo", grace_ms: 0 } },
      { method: "server.restart", params: { directory, id: "running-demo", grace_ms: 120000 } },
      ...(["server.mods.install", "server.datapacks.install"] as const).flatMap((method) => [
        { method, params: { directory, id: "survival", project: `boundary-${method}`, workers: 1 } },
        { method, params: { directory, id: "survival", project: `boundary-${method}-max`, workers: 32 } },
        { method, params: { directory, id: "survival", project: `boundary-${method}-zero`, retries: 0 } },
        { method, params: { directory, id: "survival", project: `boundary-${method}-retry`, retries: 5 } },
      ]),
      ...(["server.mods.set-version", "server.datapacks.set-version"] as const).flatMap((method) => [
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "boundary-v1", workers: 1 } },
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "boundary-v2", workers: 32 } },
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "boundary-v3", retries: 0 } },
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "boundary-v4", retries: 5 } },
      ]),
    ];
    for (const { method, params } of validCases) {
      expect(() => dispatchServerMockRequest(createServerMockState("default"), method, params)).not.toThrow();
    }

    const invalidCases: Array<{ method: string; params: Record<string, unknown> }> = [
      ...(["workers", "retries"] as const).flatMap((name) => [
        { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, [name]: -1 } },
        { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, [name]: 1.5 } },
        { method: "server.install", params: { directory, id: "fabric-lab", accept_eula: true, [name]: name === "workers" ? 33 : 6 } },
      ]),
      ...(["server.stop", "server.restart"] as const).flatMap((method) => [
        { method, params: { directory, id: "running-demo", grace_ms: -1 } },
        { method, params: { directory, id: "running-demo", grace_ms: 1.5 } },
        { method, params: { directory, id: "running-demo", grace_ms: 120001 } },
        { method, params: { directory, id: "running-demo", grace_ms: Number.NaN } },
        { method, params: { directory, id: "running-demo", grace_ms: Number.POSITIVE_INFINITY } },
      ]),
      ...(["server.mods.install", "server.datapacks.install"] as const).flatMap((method) => [
        { method, params: { directory, id: "survival", project: `invalid-${method}`, provider: "other" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-provider`, provider: 7 } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-deps`, with_dependencies: "yes" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-key`, provider: "modrinth", api_key: "key" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-cf`, provider: "curseforge" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-empty-key`, api_key: "" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-empty-store`, store_directory: "" } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-workers`, workers: -1 } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-fraction`, retries: 1.5 } },
        { method, params: { directory, id: "survival", project: `invalid-${method}-over`, workers: 33 } },
      ]),
      ...(["server.mods.set-version", "server.datapacks.set-version"] as const).flatMap((method) => [
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "invalid-v1", workers: -1 } },
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "invalid-v2", retries: 1.5 } },
        { method, params: { directory, id: "survival", project: method.includes("mods") ? "sodium" : "terralith", version_id: "invalid-v3", retries: 6 } },
      ]),
      { method: "server.worlds.restore", params: { directory, id: "survival", backup: "world-20260920-120000.zip", replace: "yes" } },
    ];
    for (const { method, params } of invalidCases) {
      const state = createServerMockState("default");
      const before = structuredClone(state);
      let error: unknown;
      try {
        dispatchServerMockRequest(state, method, params);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toMatchObject({ kind: "rpc", code: "INVALID_PARAMS" });
      expect(state).toEqual(before);
    }
  });
});

describe("server mock Batch 2 core validation bounds", () => {
  test("validates server ids for create and every target operation before state access", () => {
    const validIds = ["a", "9", "a".repeat(64), "a.b_c-9"];
    for (const id of validIds) {
      const state = createServerMockState("empty");
      expect(() => dispatchServerMockRequest(state, "server.create", {
        directory,
        id,
        version_id: "1.21.4",
      })).not.toThrow();
      expect(state.servers[`${directory}\0${id}`]).toBeDefined();
    }

    const invalidIds = [
      "../escape",
      "Upper",
      "a/b",
      "a.",
      "a".repeat(65),
      "con",
      "prn.foo",
      "aux",
      "nul",
      "com1.server",
      "com9.server",
      "lpt1.server",
      "lpt9.server",
    ];
    for (const id of invalidIds) {
      const state = createServerMockState("empty");
      const before = structuredClone(state);
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, "server.create", {
        directory,
        id,
        version_id: "1.21.4",
      }))).toBe("INVALID_PARAMS");
      expect(state).toEqual(before);
    }

    const targetMethods: Array<[string, Record<string, unknown>]> = [
      ["server.get", {}],
      ["server.delete", {}],
      ["server.install", { accept_eula: true }],
      ["server.start", {}],
      ["server.stop", {}],
      ["server.restart", {}],
      ["server.status", {}],
      ["server.logs", {}],
      ["server.command", { command: "list" }],
      ["server.rcon.command", { password: "p", command: "list" }],
      ["server.query", {}],
      ["server.properties.get", {}],
      ["server.properties.set", { properties: { motd: "x" } }],
      ["server.worlds.list", {}],
      ["server.worlds.get", { world: "world" }],
      ["server.worlds.rename", { world: "world", new_name: "renamed" }],
      ["server.worlds.delete", { world: "world" }],
      ["server.worlds.backup", {}],
      ["server.worlds.backups", {}],
      ["server.worlds.restore", { backup: "world-20260920-120000.zip" }],
      ["server.worlds.backups.delete", { backup: "world-20260920-120000.zip" }],
      ["server.mods.list", {}],
      ["server.mods.install", { project: "sodium" }],
      ["server.mods.set-version", { project: "sodium", version_id: "v2" }],
      ["server.mods.enable", { project: "sodium" }],
      ["server.mods.disable", { project: "sodium" }],
      ["server.mods.remove", { project: "sodium" }],
      ["server.mods.adopt", {}],
      ["server.datapacks.list", {}],
      ["server.datapacks.install", { project: "terralith" }],
      ["server.datapacks.set-version", { project: "terralith", version_id: "v2" }],
      ["server.datapacks.enable", { project: "terralith" }],
      ["server.datapacks.disable", { project: "terralith" }],
      ["server.datapacks.remove", { project: "terralith" }],
      ["server.datapacks.adopt", {}],
    ];
    for (const [method, extra] of targetMethods) {
      const state = createServerMockState("default");
      const before = structuredClone(state);
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, method, {
        directory,
        id: "../escape",
        ...extra,
      }))).toBe("INVALID_PARAMS");
      expect(state).toEqual(before);
    }
  });

  test("bounds server commands by well-formed UTF-8 bytes and control characters", () => {
    const validCommands = [
      "a",
      "a".repeat(4095),
      `${"你".repeat(1364)}a`,
    ];
    for (const command of validCommands) {
      const state = createServerMockState("default");
      expect(() => dispatchServerMockRequest(state, "server.command", {
        directory,
        id: "running-demo",
        command,
      })).not.toThrow();
    }

    const invalidCommands = [
      "",
      "a".repeat(4096),
      "你".repeat(1366),
      "a\0b",
      "a\rb",
      "a\nb",
      "\ud800",
      "\udc00",
    ];
    for (const command of invalidCommands) {
      const state = createServerMockState("default");
      const before = structuredClone(state);
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, "server.command", {
        directory,
        id: "running-demo",
        command,
      }))).toBe("INVALID_PARAMS");
      expect(state).toEqual(before);
    }
  });

  test("bounds RCON fields and max_bytes without rejecting CR/LF", () => {
    const maxPassword = "p".repeat(4095);
    const maxCommand = "c".repeat(4095);
    for (const params of [
      { password: maxPassword, command: maxCommand },
      { password: "p\r\n", command: "list\r\n" },
      { password: "p", command: "list", max_bytes: 1 },
      { password: "p", command: "list", max_bytes: 262144 },
    ]) {
      const state = createServerMockState("default");
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, "server.rcon.command", {
        directory,
        id: "running-demo",
        ...params,
      }))).toBe("SERVER_RCON_DISABLED");
    }

    const invalidParams = [
      { password: "", command: "list" },
      { password: "p".repeat(4096), command: "list" },
      { password: "unique-RCON-secret\0", command: "list" },
      { password: "\ud800", command: "list" },
      { password: "p", command: "" },
      { password: "p", command: "c".repeat(4096) },
      { password: "p", command: "list\0" },
      { password: "p", command: "\udc00" },
      { password: "p", command: "list", max_bytes: 0 },
      { password: "p", command: "list", max_bytes: 262145 },
      { password: "p", command: "list", max_bytes: 1.5 },
      { password: "p", command: "list", max_bytes: Number.NaN },
    ];
    for (const params of invalidParams) {
      const state = createServerMockState("default");
      const before = structuredClone(state);
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, "server.rcon.command", {
        directory,
        id: "running-demo",
        ...params,
      }))).toBe("INVALID_PARAMS");
      if (params.password === "unique-RCON-secret\0") {
        expect(JSON.stringify(state)).not.toContain("unique-RCON-secret");
      }
      expect(state).toEqual(before);
    }
  });

  test("validates the resulting properties merge at exact byte and entry limits", () => {
    const exactKey = `${"键".repeat(85)}a`;
    const exactValue = `${"你".repeat(21845)}a`;
    expect(new TextEncoder().encode(exactKey).length).toBe(256);
    expect(new TextEncoder().encode(exactValue).length).toBe(65536);
    const exactState = createServerMockState("default");
    expect(() => dispatchServerMockRequest(exactState, "server.properties.set", {
      directory,
      id: "survival",
      properties: { [exactKey]: exactValue, empty: "" },
    })).not.toThrow();
    expect(exactState.servers[`${directory}\0survival`].properties?.[exactKey]).toBe(exactValue);

    const atLimit = Object.fromEntries(Array.from({ length: 1018 }, (_, index) => [`key-${index}`, ""]));
    const atLimitState = createServerMockState("default");
    expect(() => dispatchServerMockRequest(atLimitState, "server.properties.set", {
      directory,
      id: "survival",
      properties: atLimit,
    })).not.toThrow();
    expect(Object.keys(atLimitState.servers[`${directory}\0survival`].properties!)).toHaveLength(1024);

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { ["k".repeat(257)]: "x" },
      { "bad\0key": "x" },
      { "bad\rkey": "x" },
      { "bad\nkey": "x" },
      { "bad\ud800key": "x" },
      { good: "v".repeat(65537) },
      { good: "bad\0value" },
      { good: "bad\ud800value" },
      { good: 7 },
      { good: null },
      Object.fromEntries(Array.from({ length: 1019 }, (_, index) => [`key-${index}`, ""])),
    ];
    for (const properties of invalidInputs) {
      const state = createServerMockState("default");
      const before = structuredClone(state);
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, "server.properties.set", {
        directory,
        id: "survival",
        properties,
      }))).toBe("INVALID_PARAMS");
      expect(state).toEqual(before);
    }
  });
});

describe("server mock byte logs, properties, and remote facilities", () => {
  test("resumes byte cursors, keeps UTF-8 valid, bounds output, and resets after rotation", async () => {
    const session = await openDefault();
    const first = await session.serverLogs(directory, "running-demo", { max_bytes: 5 });
    expect(first.truncated).toBe(true);
    expect(new TextEncoder().encode(first.text).length).toBeLessThanOrEqual(5);

    await session.serverCommand(directory, "running-demo", "say 你好");
    const resumed = await session.serverLogs(directory, "running-demo", {
      cursor: first.next_cursor,
      file_id: first.file_id,
      max_bytes: 100,
    });
    expect(resumed.reset).toBe(false);
    expect(resumed.text).toContain("你好");
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(resumed.text))).not.toThrow();
    expect(new TextEncoder().encode(resumed.text).length).toBeLessThanOrEqual(100);

    const oldFileId = resumed.file_id;
    rotateMockServerLog(directory, "running-demo", "rotated-日本\n");
    const rotated = await session.serverLogs(directory, "running-demo", {
      cursor: resumed.next_cursor,
      file_id: oldFileId,
    });
    expect(rotated.reset).toBe(true);
    expect(rotated.file_id).not.toBe(oldFileId);
    expect(rotated.text).toContain("日本");
    expect(rotated.next_cursor).toBeGreaterThanOrEqual(rotated.start_cursor);
  });

  test("resets a cursor that points inside a UTF-8 code point", async () => {
    const session = await openDefault();
    replaceMockServerLog(directory, "running-demo", "你a");
    const result = await session.serverLogs(directory, "running-demo", {
      cursor: 1,
      file_id: (await session.serverLogs(directory, "running-demo")).file_id,
    });
    expect(result.reset).toBe(true);
    expect(result.text).toBe("你a");
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(result.text))).not.toThrow();
  });

  test("reads an empty log as an exhausted zero-length stream", async () => {
    const session = await openDefault();
    replaceMockServerLog(directory, "running-demo", "");
    await expect(session.serverLogs(directory, "running-demo")).resolves.toMatchObject({
      text: "",
      start_cursor: 0,
      next_cursor: 0,
      eof: true,
      reset: false,
    });
  });

  test("redacts properties passwords, merges only while stopped, and never retains the opaque value", async () => {
    const secret = "opaque-local-rcon-value";
    const state = createServerMockState("default");
    const stateResult = dispatchServerMockRequest<{ properties: Record<string, string> }>(state, "server.properties.set", {
      directory,
      id: "survival",
      properties: { motd: "Changed", "rcon.password": secret },
    });
    expect(stateResult.properties["rcon.password"]).toBe("<redacted>");
    expect(JSON.stringify(state)).not.toContain(secret);

    const session = await openDefault();
    await expect(session.serverPropertiesSet(directory, "survival", { motd: "Changed", "rcon.password": secret })).resolves.toMatchObject({
      properties: { motd: "Changed", "rcon.password": "<redacted>" },
    });
    await session.serverStart(directory, "survival");
    expect(await errorCode(() => session.serverPropertiesSet(directory, "survival", { motd: "blocked" }))).toBe("SERVER_ALREADY_RUNNING");
    await session.serverStop(directory, "survival");
    const get = await session.serverPropertiesGet(directory, "survival");
    expect(get.properties["rcon.password"]).toBe("<redacted>");

    const diagnostics: string[] = [];
    let rconFailure: unknown;
    try {
      await session.request("server.rcon.command", {
        directory,
        id: "running-demo",
        password: secret,
        command: "list",
      }, (event) => {
        if (event.kind === "diagnostic") diagnostics.push(event.data);
      });
    } catch (error) {
      rconFailure = error;
    }
    expect(rconFailure).toMatchObject({ code: "SERVER_RCON_DISABLED" });
    expect(JSON.stringify(rconFailure)).not.toContain(secret);
    expect(diagnostics.join("\n")).not.toContain(secret);
  });

  test("returns stable disabled errors for RCON and Query", async () => {
    const session = await openDefault();
    expect(await errorCode(() => session.serverRconCommand(directory, "running-demo", "opaque-password", "list"))).toBe("SERVER_RCON_DISABLED");
    expect(await errorCode(() => session.serverQuery(directory, "running-demo"))).toBe("SERVER_QUERY_DISABLED");
  });
});

describe("server mock worlds and content", () => {
  test("rejects same-name world renames through the public wrapper", async () => {
    const session = await openDefault();

    await expect(session.serverWorldsRename(directory, "survival", "world", "world"))
      .rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name).sort()).toEqual([
      "world",
      "world_nether",
      "world_the_end",
    ]);
  });

  test("rejects malformed optional backup parameters without creating a backup", async () => {
    const session = await openDefault();
    const before = await session.serverWorldsBackups(directory, "survival");

    const malformed = [
      { world: 123 },
      { world: null },
      { world: "" },
      { label: 123 },
      { label: null },
      { label: "unsafe/label" },
      { label: "x".repeat(65) },
    ];
    for (const opts of malformed) {
      await expect(session.serverWorldsBackup(directory, "survival", opts as never))
        .rejects.toMatchObject({ code: "INVALID_PARAMS" });
    }

    expect(await session.serverWorldsBackups(directory, "survival")).toEqual(before);
    await expect(session.serverWorldsBackup(directory, "survival", { world: undefined, label: undefined }))
      .resolves.toMatchObject({ stage: "server.worlds.backup" });
  });

  test("renames and deletes the base world with existing dimension siblings", async () => {
    const session = await openDefault();
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name).sort()).toEqual([
      "world",
      "world_nether",
      "world_the_end",
    ]);

    await session.serverWorldsRename(directory, "survival", "world", "renamed");
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name).sort()).toEqual([
      "renamed",
      "renamed_nether",
      "renamed_the_end",
    ]);
    expect((await session.serverPropertiesGet(directory, "survival")).properties["level-name"]).toBe("renamed");

    await session.serverWorldsDelete(directory, "survival", "renamed");
    expect((await session.serverWorldsList(directory, "survival")).worlds).toEqual([]);
  });

  test("backs up and restores the exact archived world set, including a custom base", () => {
    const state = createServerMockState("default");
    const server = state.servers[`${directory}\0survival`];
    server.properties!["level-name"] = "custom-base";
    server.worlds = server.worlds.map((world, index) => ({
      ...world,
      name: ["custom-base", "custom-base_nether", "custom-base_the_end"][index],
      level_name: ["custom-base", "custom-base_nether", "custom-base_the_end"][index],
    }));

    const backup = dispatchServerMockRequest<{ backup: string }>(state, "server.worlds.backup", {
      directory,
      id: "survival",
      label: "custom",
    });
    expect(dispatchServerMockRequest<{ backups: Array<{ world: string | null }> }>(state, "server.worlds.backups", { directory, id: "survival" }).backups[0].world).toBe("custom-base");

    dispatchServerMockRequest(state, "server.worlds.rename", { directory, id: "survival", world: "custom-base", new_name: "renamed-base" });
    expect(server.worlds.map((world) => world.name).sort()).toEqual(["renamed-base", "renamed-base_nether", "renamed-base_the_end"]);
    dispatchServerMockRequest(state, "server.worlds.delete", { directory, id: "survival", world: "renamed-base" });
    dispatchServerMockRequest(state, "server.worlds.restore", { directory, id: "survival", backup: backup.backup });
    expect(server.worlds.map((world) => world.name).sort()).toEqual(["custom-base", "custom-base_nether", "custom-base_the_end"]);
  });

  test("targeting a dimension sibling does not invent or rename other siblings", async () => {
    const session = await openDefault();
    await session.serverWorldsRename(directory, "survival", "world_nether", "custom-nether");
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name).sort()).toEqual([
      "custom-nether",
      "world",
      "world_the_end",
    ]);
    await session.serverWorldsDelete(directory, "survival", "custom-nether");
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name).sort()).toEqual([
      "world",
      "world_the_end",
    ]);
  });

  test("round-trips world rename, backup, delete, restore, and backup deletion", async () => {
    const session = await openDefault();
    await session.serverWorldsRename(directory, "survival", "world", "survival-world");
    expect((await session.serverWorldsGet(directory, "survival", "survival-world")).world.name).toBe("survival-world");
    const backup = await session.serverWorldsBackup(directory, "survival", { world: "survival-world", label: "roundtrip" });
    expect(backup.backup).toEndWith(".zip");
    expect((await session.serverWorldsBackups(directory, "survival")).backups[0].file).toBe(backup.backup);
    await session.serverWorldsDelete(directory, "survival", "survival-world");
    expect((await session.serverWorldsList(directory, "survival")).worlds).toEqual([]);
    await session.serverWorldsRestore(directory, "survival", backup.backup);
    expect((await session.serverWorldsList(directory, "survival")).worlds.map((world) => world.name)).toContain("survival-world");
    await session.serverWorldsBackupsDelete(directory, "survival", backup.backup);
    expect((await session.serverWorldsBackups(directory, "survival")).backups.map((item) => item.file)).not.toContain(backup.backup);
  });

  test("keeps canonical content paths across project and file toggles", async () => {
    const session = await openDefault();
    const modInstall = await session.serverModsInstall(directory, "survival", "toggle-mod");
    const modFile = modInstall.installed[0].file;
    expect((await session.serverModsDisable(directory, "survival", { project: "toggle-mod" })).entry?.file).toBe(modFile);
    expect((await session.serverModsList(directory, "survival")).entries.find((entry) => entry.file === modFile)?.enabled).toBe(false);
    expect((await session.serverModsEnable(directory, "survival", { file: modFile })).entry?.file).toBe(modFile);

    const packInstall = await session.serverDatapacksInstall(directory, "survival", "toggle-pack");
    const packFile = packInstall.installed[0].file;
    expect(packFile.startsWith("datapacks/")).toBe(true);
    expect((await session.serverDatapacksDisable(directory, "survival", { project: "toggle-pack" })).entry?.file).toBe(packFile);
    expect((await session.serverDatapacksEnable(directory, "survival", { file: packFile })).entry?.file).toBe(packFile);
  });

  test("requires exactly one selector and supports remote slugs only", async () => {
    const session = await openDefault();
    await expect(session.serverModsDisable(directory, "survival", { project: "sodium", file: "mods/sodium.jar" } as never)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(session.serverModsDisable(directory, "survival", {} as never)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(session.serverModsDisable(directory, "survival", { project: "manual" })).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
    await expect(session.serverModsDisable(directory, "survival", { project: "sodium" })).resolves.toMatchObject({ changed: true });

    try {
      dispatchServerMockRequest(createServerMockState("default"), "server.mods.disable", {
        directory,
        id: "missing-server",
        project: "sodium",
        file: "mods/sodium.jar",
      });
      throw new Error("expected a stable RPC error");
    } catch (error) {
      expect(error).toMatchObject({ kind: "rpc", code: "INVALID_PARAMS" });
    }
  });

  test("validates set-version selectors through both public wrappers", async () => {
    const session = await openDefault();
    const cases = [
      () => session.serverModsSetVersion(directory, "survival", undefined as never, "v2"),
      () => session.serverModsSetVersion(directory, "survival", 123 as never, "v2"),
      () => session.serverModsSetVersion(directory, "survival", "", "v2"),
      () => session.serverModsSetVersion(directory, "survival", "sodium", undefined as never),
      () => session.serverModsSetVersion(directory, "survival", "sodium", 123 as never),
      () => session.serverModsSetVersion(directory, "survival", "sodium", ""),
      () => session.serverModsSetVersion(directory, "survival", "sodium", "v2", { file: "mods/sodium.jar" } as never),
      () => session.serverModsSetVersion(directory, "survival", "missing-project", "v2"),
      () => session.serverModsSetVersion(directory, "survival", "manual", "v2"),
      () => session.serverDatapacksSetVersion(directory, "survival", undefined as never, "v2"),
      () => session.serverDatapacksSetVersion(directory, "survival", "terralith", "", { file: "datapacks/terralith.zip" } as never),
    ];

    for (const action of cases.slice(0, 7)) {
      await expect(action()).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    }
    for (const action of cases.slice(7, 9)) {
      await expect(action()).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
    }
    await expect(cases[9]()).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(cases[10]()).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  test("rejects malformed dispatcher string fields before lookup or mutation", () => {
    const cases: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: "server.create", params: { directory, id: "audit-create", version_id: 1214 } },
      { method: "server.create", params: { directory, id: "", version_id: "1.21.4" } },
      { method: "server.create", params: { directory, id: "audit-create", version_id: "1.21.4", name: 7 } },
      { method: "server.start", params: { directory, id: 7 } },
      { method: "server.command", params: { directory, id: "running-demo", command: 7 } },
      { method: "server.command", params: { directory, id: "running-demo" } },
      { method: "server.worlds.get", params: { directory, id: "survival", world: 7 } },
      { method: "server.worlds.rename", params: { directory, id: "survival", world: "world", new_name: 7 } },
      { method: "server.worlds.backups.delete", params: { directory, id: "survival", backup: "" } },
      { method: "server.mods.install", params: { directory, id: "survival", project: 7 } },
      { method: "server.mods.enable", params: { directory, id: "survival", project: "" } },
      { method: "server.mods.disable", params: { directory, id: "survival", project: 7, file: "mods/sodium.jar" } },
      { method: "server.mods.set-version", params: { directory, id: "survival", project: "sodium", version_id: "v2", file: 7 } },
      { method: "server.datapacks.set-version", params: { directory, id: "survival", project: "terralith", version_id: "v2", file: "datapacks/terralith.zip" } },
    ];

    for (const { method, params } of cases) {
      expect(dispatchErrorCode(() => dispatchServerMockRequest(createServerMockState("default"), method, params)))
        .toBe("INVALID_PARAMS");
    }
  });

  test("set-version accepts only remote project ids or slugs", () => {
    for (const method of ["server.mods.set-version", "server.datapacks.set-version"]) {
      const state = createServerMockState("default");
      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, method, {
        directory,
        id: "survival",
        project: "sodium",
        version_id: "v2",
        file: "wrong-selector",
      }))).toBe("INVALID_PARAMS");

      expect(dispatchErrorCode(() => dispatchServerMockRequest(state, method, {
        directory,
        id: "survival",
        project: "unknown-project",
        version_id: "v2",
      }))).toBe("CONTENT_NOT_FOUND");
    }
  });

  test("keeps server datapack files root-relative through list, install, and adopt", async () => {
    const session = await openDefault();
    const initial = await session.serverDatapacksList(directory, "survival");
    expect([...initial.entries.map((entry) => entry.file), ...initial.unmanaged].every((file) => file.startsWith("datapacks/") && !file.startsWith("world/"))).toBe(true);
    const installed = await session.serverDatapacksInstall(directory, "survival", "root-relative-pack");
    expect(installed.installed[0].file.startsWith("datapacks/")).toBe(true);
    const adopted = await session.serverDatapacksAdopt(directory, "survival");
    expect(adopted.adopted.every((entry) => entry.file.startsWith("datapacks/") && !entry.file.startsWith("world/"))).toBe(true);
  });

  test("allows vanilla stopped mod mutations but still requires a loader to install", async () => {
    const session = await openDefault();
    await expect(session.serverModsDisable(directory, "vanilla-server", { file: "mods/manual.jar" })).resolves.toMatchObject({ changed: true });
    await expect(session.serverModsEnable(directory, "vanilla-server", { file: "mods/manual.jar" })).resolves.toMatchObject({ changed: true });
    await expect(session.serverModsSetVersion(directory, "vanilla-server", "manual", "manual-v2")).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
    await expect(session.serverModsRemove(directory, "vanilla-server", { file: "mods/manual.jar" })).resolves.toMatchObject({ removed: { file: "mods/manual.jar" } });
    await expect(session.serverModsAdopt(directory, "vanilla-server")).resolves.toMatchObject({ adopted: [expect.objectContaining({ file: "mods/unmanaged.jar" })] });
    await expect(session.serverModsInstall(directory, "vanilla-server", "loader-required")).rejects.toMatchObject({ code: "SERVER_LOADER_REQUIRED" });
  });

  test("round-trips server mods and datapacks without client-only selectors", async () => {
    const session = await openDefault();
    await session.serverModsInstall(directory, "survival", "lithium", { version_id: "lithium-v1" });
    expect((await session.serverModsList(directory, "survival")).entries.map((entry) => entry.source.project_id)).toContain("lithium");
    await session.serverModsDisable(directory, "survival", { project: "lithium" });
    await session.serverModsEnable(directory, "survival", { project: "lithium" });
    await session.serverModsSetVersion(directory, "survival", "lithium", "lithium-v2");
    await session.serverModsRemove(directory, "survival", { project: "lithium" });
    const adoptedMod = await session.serverModsAdopt(directory, "survival");
    expect(adoptedMod.adopted.length).toBeGreaterThan(0);

    await session.serverDatapacksInstall(directory, "survival", "incendium", { version_id: "incendium-v1" });
    await session.serverDatapacksDisable(directory, "survival", { project: "incendium" });
    await session.serverDatapacksEnable(directory, "survival", { project: "incendium" });
    await session.serverDatapacksSetVersion(directory, "survival", "incendium", "incendium-v2");
    await session.serverDatapacksRemove(directory, "survival", { project: "incendium" });
    const adoptedPack = await session.serverDatapacksAdopt(directory, "survival");
    expect(adoptedPack.adopted.length).toBeGreaterThan(0);
    expect((await session.serverDatapacksList(directory, "survival")).entries.every((entry) => entry.kind === "datapack")).toBe(true);
  });
});

describe("server mock dispatcher inventory", () => {
  test("handles every documented server method intentionally", () => {
    expect(SERVER_MOCK_METHODS).toHaveLength(37);
    const expectedErrors = new Set([
      "INVALID_PARAMS",
      "EULA_NOT_ACCEPTED",
      "JAVA_INCOMPATIBLE",
      "SERVER_NOT_INSTALLED",
      "SERVER_NOT_RUNNING",
      "SERVER_LOGS_NOT_FOUND",
      "SERVER_RCON_DISABLED",
      "SERVER_QUERY_DISABLED",
      "WORLD_EXISTS",
    ]);
    const base = { directory, id: "survival" };
    const params: Record<string, Record<string, unknown>> = {
      "server.create": { directory, id: "inventory-new", version_id: "1.21.4" },
      "server.list": { directory },
      "server.get": base,
      "server.delete": { directory, id: "fabric-lab" },
      "server.install": { directory, id: "java-incompatible", accept_eula: true },
      "server.start": { directory, id: "fabric-lab" },
      "server.stop": base,
      "server.restart": base,
      "server.status": base,
      "server.logs": { directory, id: "fabric-lab" },
      "server.command": base,
      "server.rcon.command": { directory, id: "running-demo", password: "opaque", command: "list" },
      "server.query": { directory, id: "running-demo" },
      "server.properties.get": base,
      "server.properties.set": { ...base, properties: { motd: "inventory" } },
      "server.worlds.list": base,
      "server.worlds.get": { ...base, world: "world" },
      "server.worlds.rename": { ...base, world: "world", new_name: "inventory-world" },
      "server.worlds.delete": { ...base, world: "world" },
      "server.worlds.backup": base,
      "server.worlds.backups": base,
      "server.worlds.restore": { ...base, backup: "world-20260920-120000.zip" },
      "server.worlds.backups.delete": { ...base, backup: "world-20260920-120000.zip" },
      "server.mods.list": base,
      "server.mods.install": { ...base, project: "inventory-mod" },
      "server.mods.set-version": { ...base, project: "sodium", version_id: "inventory-v2" },
      "server.mods.enable": { ...base, project: "sodium" },
      "server.mods.disable": { ...base, project: "sodium" },
      "server.mods.remove": { ...base, project: "sodium" },
      "server.mods.adopt": base,
      "server.datapacks.list": base,
      "server.datapacks.install": { ...base, project: "inventory-pack" },
      "server.datapacks.set-version": { ...base, project: "terralith", version_id: "inventory-v2" },
      "server.datapacks.enable": { ...base, project: "terralith" },
      "server.datapacks.disable": { ...base, project: "terralith" },
      "server.datapacks.remove": { ...base, project: "terralith" },
      "server.datapacks.adopt": base,
    };
    for (const method of SERVER_MOCK_METHODS) {
      const state = createServerMockState("default");
      try {
        dispatchServerMockRequest(state, method, params[method]);
      } catch (error) {
        const code = String((error as { code?: string }).code);
        expect(expectedErrors.has(code)).toBe(true);
      }
    }
  });

  test("fails unknown server methods instead of returning generic success", () => {
    expect(() => dispatchServerMockRequest(createServerMockState("default"), "server.unknown", {})).toThrow();
    try {
      dispatchServerMockRequest(createServerMockState("default"), "server.unknown", {});
    } catch (error) {
      expect(error).toMatchObject({ kind: "rpc", code: "METHOD_NOT_FOUND" });
    }
  });
});
