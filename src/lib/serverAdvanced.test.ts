import { describe, expect, test } from "bun:test";
import { ServerAdvancedController, type ServerAdvancedSession, validatePropertyChanges } from "./serverAdvanced";
import { ServerOperationsController, type ServerOperationsRpc } from "./serverOperations";
import { ServerLogController } from "./serverLogController";
import { serverTargetBusy } from "./serverTargetLock";
import type { ServerOperationScope } from "./servers";
import type { ServerManifest, ServerProperties, ServerPropertiesResult, ServerQueryResult, ServerStatus } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const status = (running = false): ServerStatus => ({ stage: "server.status", id: "demo", running, stale_state: false, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, uptime_ms: null });
const manifest: ServerManifest = { id: "demo", name: "Demo", version_id: "1.21.4", installed: true, accept_eula: true, source: "official", fabric_loader: null, neoforge_version: null, forge_version: null, java_path: null };
const queryResult = (mode: "basic" | "full"): ServerQueryResult => ({ stage: "server.query", mode, hostname: "Fixture", game_type: "SMP", map: "world", version: mode === "basic" ? null : "1.21.4", players: 2, max_players: 20, host_port: 25565, host_ip: "127.0.0.1", plugins: mode === "basic" ? null : "", player_names: mode === "basic" ? [] : ["Alex", "Steve"] });
let nextId = 0;
function harness(overrides: Partial<ServerAdvancedSession> = {}, opening?: () => Promise<ServerAdvancedSession>) {
  const initialScope: ServerOperationScope = { endpointId: `advanced-test-${++nextId}`, kind: "local", directory: "/fixtures", sourceRevision: 1 };
  let currentScope = initialScope;
  let opens = 0, closes = 0;
  const calls: string[] = [];
  const changes: ServerProperties[] = [];
  let stored: ServerProperties = { "max-players": "020", "online-mode": "false", "extension.unknown": " untouched ", "rcon.password": "<redacted>" };
  const session: ServerAdvancedSession = {
    close: async () => { closes++; },
    serverStatus: async () => { calls.push("status"); return status(false); },
    serverPropertiesGet: async () => { calls.push("get"); return { stage: "server.properties.get", id: "demo", properties: { ...stored } }; },
    serverPropertiesSet: async (_directory, _id, delta) => { calls.push("set"); changes.push(delta); stored = { ...stored, ...delta }; return { stage: "server.properties.set", id: "demo", properties: { ...stored } }; },
    serverRconCommand: async (_directory, _id, _password, _command) => { calls.push("rcon"); return { stage: "server.rcon.command", text: "Fixture response", truncated: false }; },
    serverQuery: async (_directory, _id, mode = "full") => { calls.push(`query:${mode}`); return queryResult(mode); },
    ...overrides,
  };
  const isScopeCurrent = (scope: ServerOperationScope) => JSON.stringify(scope) === JSON.stringify(currentScope);
  const controllerFor = (scope = currentScope) => new ServerAdvancedController({ id: "demo", scope, isScopeCurrent, openSession: async () => { opens++; return opening ? opening() : session; } });
  const controller = controllerFor();
  return { controller, controllerFor, session, initialScope, isScopeCurrent, calls, changes, setScope: (scope: ServerOperationScope) => { currentScope = scope; }, get scope() { return currentScope; }, get opens() { return opens; }, get closes() { return closes; }, get stored() { return stored; } };
}
function lifecycle(h: ReturnType<typeof harness>, overrides: Partial<ServerOperationsRpc> = {}) {
  const calls: string[] = [];
  const rpc: ServerOperationsRpc = {
    close: async () => {}, install: async () => {}, get: async () => ({ stage: "server.get", ...manifest }),
    start: async () => { calls.push("start"); return { stage: "server.start", id: "demo", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/fixture/java" }; },
    stop: async () => ({ stage: "server.stop", id: "demo", running: false, termination: "graceful", pid: 1 }),
    restart: async () => ({ stage: "server.restart", id: "demo", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/fixture/java" }), delete: async () => {}, ...overrides,
  };
  const controller = new ServerOperationsController({ openSession: async () => rpc, directory: {
    captureOperationScope: () => h.scope, isOperationScopeCurrent: h.isScopeCurrent,
    recordInstalled: async () => true, recordStarted: async () => true, recordStopped: async () => true, recordLifecycleError: async () => true, recordDeleted: async () => true,
  } });
  return { controller, calls };
}

describe("server advanced controls", () => {
  test("password property case variants are rejected, including redaction markers", () => {
    for (const key of ["rcon.password", "RCON.PASSWORD", "Rcon.Password"]) {
      expect(() => validatePropertyChanges({ [key]: "<redacted>" })).toThrow();
      expect(() => validatePropertyChanges({ [key]: "explicit-secret" })).toThrow();
    }
  });
  test("properties preserve string values and unknown fields by sending only explicit deltas", async () => {
    const h = harness();
    expect(await h.controller.loadProperties()).toBe(true);
    expect(h.controller.getSnapshot().properties?.properties["max-players"]).toBe("020");
    expect(await h.controller.saveProperties({ "max-players": "0010", "custom.new": "false", motd: "" })).toBe(true);
    expect(h.calls).toEqual(["get", "status", "set"]);
    expect(h.changes).toEqual([{ "max-players": "0010", "custom.new": "false", motd: "" }]);
    expect(h.stored["extension.unknown"]).toBe(" untouched ");
    expect(h.controller.getSnapshot().properties?.properties["rcon.password"]).toBe("<redacted>");
    expect(h.closes).toBe(2);
  });

  test("redacts even an accidentally unredacted property response and never writes password markers", async () => {
    const h = harness({ serverPropertiesGet: async () => ({ stage: "server.properties.get", id: "demo", properties: { "rcon.password": "fixture-private-value" } }) });
    await h.controller.loadProperties();
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-private-value");
    for (const value of ["<redacted>", "replacement", ""]) expect(await h.controller.saveProperties({ "rcon.password": value })).toBe(false);
    expect(h.changes).toEqual([]);
    expect(h.opens).toBe(1);
  });

  test("rejects invalid property keys, multiline values and implicit coercion before opening", async () => {
    const h = harness();
    for (const delta of [{}, { "": "x" }, { "a=b": "x" }, { "a:b": "x" }, { "bad key": "x" }, { "bad\0key": "x" }, { motd: "a\0b" }, { motd: "a\nb" }, { numeric: 1 } as unknown as ServerProperties]) {
      expect(await h.controller.saveProperties(delta)).toBe(false);
      expect(h.controller.getSnapshot().error).toBe("INVALID_PARAMS");
    }
    expect(h.opens).toBe(0);
    expect(validatePropertyChanges({ "custom.key": "  unchanged  " })).toEqual({ "custom.key": "  unchanged  " });
  });

  test("fresh authoritative status rejects a write if server is now running", async () => {
    const h = harness({ serverStatus: async () => status(true) });
    expect(await h.controller.saveProperties({ motd: "new" })).toBe(false);
    expect(h.controller.getSnapshot().error).toBe("SERVER_ALREADY_RUNNING");
    expect(h.changes).toEqual([]);
  });

  test("unknown and failed status fail closed, with safe explicit retry", async () => {
    let fail = true;
    const h = harness({ serverStatus: async () => { if (fail) throw { code: "SERVER_STATUS_FAILED", message: "private payload" }; return status(false); } });
    expect(await h.controller.saveProperties({ motd: "retained edit" })).toBe(false);
    expect(h.controller.getSnapshot().error).toBe("SERVER_STATUS_FAILED");
    expect(h.changes).toEqual([]);
    fail = false;
    expect(await h.controller.saveProperties({ motd: "retained edit" })).toBe(true);
    const malformed = harness({ serverStatus: async () => ({ ...status(false), running: undefined } as unknown as ServerStatus) });
    expect(await malformed.controller.saveProperties({ motd: "new" })).toBe(false);
    expect(malformed.changes).toEqual([]);
    expect(malformed.controller.getSnapshot().error).toBe("SERVER_STATUS_FAILED");
  });

  test("reads preserve the previous draft source after property RPC failure and recover manually", async () => {
    let bad = false;
    const h = harness({ serverPropertiesSet: async () => { if (bad) throw { code: "SERVER_PROPERTIES_INVALID" }; return { stage: "server.properties.set", id: "demo", properties: { motd: "new" } }; } });
    await h.controller.loadProperties();
    const previous = h.controller.getSnapshot().properties;
    bad = true;
    expect(await h.controller.saveProperties({ motd: "new" })).toBe(false);
    expect(h.controller.getSnapshot().properties).toBe(previous);
    bad = false;
    expect(await h.controller.saveProperties({ motd: "new" })).toBe(true);
    expect(h.controller.getSnapshot().error).toBeNull();
  });

  test("RCON sends one immediate bounded loopback-contract request without retaining its password", async () => {
    let invoked = false;
    const h = harness({ serverStatus: async () => status(true), serverRconCommand: async (directory, id, password, command, maxBytes) => {
      invoked = true;
      expect([directory, id, command, maxBytes]).toEqual(["/fixtures", "demo", "list", 262144]);
      expect(password).toBe("fixture-secret");
      return { stage: "server.rcon.command", text: "Two players", truncated: true };
    } });
    expect(await h.controller.rcon(" list ", "fixture-secret")).toBe(true);
    expect(invoked).toBe(true);
    expect(h.controller.getSnapshot().rcon).toMatchObject({ text: "Two players", truncated: true });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-secret");
    h.controller.cancel();
    expect(h.controller.getSnapshot().rcon).toBeNull();
  });

  test("empty and multiline RCON input is rejected without opening", async () => {
    const h = harness();
    expect(await h.controller.rcon("", "fixture-secret")).toBe(false);
    expect(await h.controller.rcon("say one\nstop", "fixture-secret")).toBe(false);
    expect(await h.controller.rcon("list", "")).toBe(false);
    expect(await h.controller.rcon("list\0", "fixture-secret")).toBe(false);
    expect(h.opens).toBe(0);
  });

  test("RCON and Query require live non-stale running status", async () => {
    for (const result of [status(false), { ...status(true), stale_state: true }, { ...status(true), running: undefined }]) {
      const h = harness({ serverStatus: async () => result as ServerStatus });
      expect(await h.controller.rcon("list", "fixture-secret")).toBe(false);
      expect(await h.controller.query("full")).toBe(false);
      expect(h.calls).toEqual([]);
    }
  });

  test("Query preserves normalized basic/full nulls, counts, lists and mode", async () => {
    const h = harness({ serverStatus: async () => status(true) });
    for (const mode of ["basic", "full"] as const) {
      expect(await h.controller.query(mode)).toBe(true);
      expect(h.controller.getSnapshot().query).toEqual(queryResult(mode));
    }
    expect(h.calls).toEqual(["query:basic", "query:full"]);
    expect(await h.controller.query("invalid" as never)).toBe(false);
    expect(h.opens).toBe(2);
  });

  test("stable error routing never retains diagnostics or unknown attacker-controlled codes", async () => {
    for (const code of ["SERVER_RCON_DISABLED", "SERVER_QUERY_DISABLED", "SERVER_RCON_AUTH_FAILED", "SERVER_RCON_UNAVAILABLE", "SERVER_QUERY_UNAVAILABLE", "SERVER_RCON_PROTOCOL_ERROR", "SERVER_QUERY_PROTOCOL_ERROR", "JAVA_NOT_FOUND", "JAVA_INCOMPATIBLE", "SSH_DISCONNECTED", "fixture-secret"]) {
      let attempts = 0;
      const h = harness({ serverStatus: async () => status(true), serverRconCommand: async () => { attempts++; throw { code, message: "fixture-secret private-host raw-request" }; } });
      expect(await h.controller.rcon("list", "fixture-secret")).toBe(false);
      expect(h.controller.getSnapshot().error).toBe(code === "fixture-secret" ? "UNKNOWN" : code);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-secret");
      expect(attempts).toBe(1);
      expect(h.controller.getSnapshot().pending).toBe(false);
    }
  });

  test("cancel while opening closes the late session without status or secret dispatch", async () => {
    const opening = deferred<ServerAdvancedSession>();
    const h = harness({}, () => opening.promise);
    const request = h.controller.rcon("list", "fixture-secret");
    h.controller.cancel();
    expect(serverTargetBusy(h.scope, "demo")).toBe(true);
    expect(await h.controllerFor().rcon("list", "another-fixture")).toBe(false);
    opening.resolve(h.session);
    expect(await request).toBe(false);
    expect(h.calls).toEqual([]);
    expect(h.closes).toBe(1);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
  });

  test("cancel while status is pending never dispatches a password or property mutation", async () => {
    for (const method of ["rcon", "properties"] as const) {
      const gate = deferred<ServerStatus>();
      const h = harness({ serverStatus: () => gate.promise });
      const request = method === "rcon" ? h.controller.rcon("list", "fixture-secret") : h.controller.saveProperties({ motd: "new" });
      await flush(); h.controller.cancel(); gate.resolve(status(method === "rcon"));
      expect(await request).toBe(false);
      expect(h.calls).toEqual([]);
      expect(h.changes).toEqual([]);
      expect(h.controller.getSnapshot()).toMatchObject({ pending: false, properties: null, rcon: null, error: null });
    }
  });

  test("source revision switches discard old responses and block revisited target until settlement", async () => {
    const gate = deferred<ServerPropertiesResult>();
    const h = harness({ serverPropertiesGet: () => gate.promise });
    const request = h.controller.loadProperties(); await flush();
    h.setScope({ ...h.scope, sourceRevision: 2 });
    const replacement = h.controllerFor();
    expect(await replacement.saveProperties({ motd: "new" })).toBe(false);
    expect(replacement.getSnapshot().error).toBe("BUSY");
    gate.resolve({ stage: "server.properties.get", id: "demo", properties: { motd: "stale" } });
    expect(await request).toBe(false);
    expect(h.controller.getSnapshot().properties).toBeNull();
    expect(replacement.getSnapshot().properties).toBeNull();
    expect(await replacement.saveProperties({ motd: "new" })).toBe(true);
  });

  test("scope switch during status prevents a subsequent physical mutation", async () => {
    const gate = deferred<ServerStatus>();
    const h = harness({ serverStatus: () => gate.promise });
    const request = h.controller.saveProperties({ motd: "new" }); await flush();
    h.setScope({ ...h.scope, endpointId: "different-fixture" });
    gate.resolve(status(false));
    expect(await request).toBe(false);
    expect(h.changes).toEqual([]);
  });

  test("repeated clicks and cancel do not release an already dispatched mutation", async () => {
    const gate = deferred<ServerPropertiesResult>();
    let writes = 0;
    const h = harness({ serverPropertiesSet: () => { writes++; return gate.promise; } });
    const request = h.controller.saveProperties({ motd: "first" }); await flush();
    expect(await h.controller.saveProperties({ motd: "second" })).toBe(false);
    h.controller.cancel();
    const replacement = h.controllerFor();
    expect(await replacement.saveProperties({ motd: "third" })).toBe(false);
    expect(writes).toBe(1);
    gate.resolve({ stage: "server.properties.set", id: "demo", properties: { motd: "first" } });
    expect(await request).toBe(false);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
    expect(h.controller.getSnapshot().properties).toBeNull();
  });

  test("shared lock excludes lifecycle during advanced requests across revisions", async () => {
    const gate = deferred<ServerPropertiesResult>();
    const h = harness({ serverPropertiesSet: () => gate.promise });
    const request = h.controller.saveProperties({ motd: "first" }); await flush();
    h.setScope({ ...h.scope, sourceRevision: 2 });
    const other = lifecycle(h);
    expect(await other.controller.start(manifest)).toBe(false);
    expect(other.calls).toEqual([]);
    gate.resolve({ stage: "server.properties.set", id: "demo", properties: { motd: "first" } });
    await request;
    expect(await other.controller.start(manifest)).toBe(true);
  });

  test("lifecycle lock blocks advanced operations and is independent across endpoints", async () => {
    const gate = deferred<void>();
    const h = harness();
    const other = lifecycle(h, { stop: async () => { await gate.promise; return { stage: "server.stop", id: "demo", running: false, termination: "graceful", pid: 1 }; } });
    const request = other.controller.stop(manifest); await flush();
    expect(await h.controller.saveProperties({ motd: "blocked" })).toBe(false);
    expect(h.opens).toBe(0);
    h.setScope({ ...h.scope, endpointId: `${h.scope.endpointId}-other` });
    expect(await h.controllerFor().saveProperties({ motd: "independent" })).toBe(true);
    gate.resolve(); await request;
  });

  test("FIFO command and advanced requests share the same physical target lock", async () => {
    const gate = deferred<void>();
    const h = harness();
    const logs = new ServerLogController({ serverId: "demo", captureScope: () => h.scope, isScopeCurrent: h.isScopeCurrent, setTimer: () => 1, clearTimer: () => {}, openSession: async () => ({
      close: async () => {}, serverLogs: async () => ({ stage: "server.logs", id: "demo", text: "", file_id: 1, start_cursor: 0, next_cursor: 0, eof: true, reset: false, truncated: false }),
      serverCommand: async () => { await gate.promise; return { stage: "server.command", id: "demo", accepted: true, pid: 1 }; },
    }) });
    await logs.open(); logs.setRunning(true);
    const command = logs.submitCommand("list"); await flush();
    expect(await h.controller.saveProperties({ motd: "blocked" })).toBe(false);
    expect(h.opens).toBe(0);
    gate.resolve(); expect(await command).toBe(true);
    expect(await h.controller.saveProperties({ motd: "allowed" })).toBe(true);
    await logs.close();
  });

  test("locks include session cleanup, including after successful terminal result", async () => {
    const cleanup = deferred<void>();
    const h = harness({ close: () => cleanup.promise });
    const request = h.controller.saveProperties({ motd: "new" }); await flush();
    expect(serverTargetBusy(h.scope, "demo")).toBe(true);
    expect(await lifecycle(h).controller.start(manifest)).toBe(false);
    cleanup.resolve(); expect(await request).toBe(true);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
  });

  test("cleanup failure does not replace a confirmed mutation result or leak diagnostics", async () => {
    const h = harness({ close: async () => { throw new Error("fixture-secret cleanup diagnostic"); } });
    expect(await h.controller.saveProperties({ motd: "confirmed" })).toBe(true);
    expect(h.controller.getSnapshot()).toMatchObject({ properties: { properties: { motd: "confirmed" } }, pending: false, error: null });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-secret");
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
  });

  test("cancel closes once and waits for both mutation and shared close promise before unlock", async () => {
    const mutation = deferred<ServerPropertiesResult>();
    const cleanup = deferred<void>();
    let closes = 0;
    const h = harness({ serverPropertiesSet: () => mutation.promise, close: () => { closes++; return cleanup.promise; } });
    const request = h.controller.saveProperties({ motd: "new" }); await flush();
    h.controller.cancel(); h.controller.cancel();
    expect(closes).toBe(1);
    mutation.resolve({ stage: "server.properties.set", id: "demo", properties: { motd: "new" } });
    await flush();
    expect(serverTargetBusy(h.scope, "demo")).toBe(true);
    expect(await lifecycle(h).controller.start(manifest)).toBe(false);
    cleanup.resolve(); expect(await request).toBe(false);
    expect(closes).toBe(1);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
    expect(h.controller.getSnapshot().properties).toBeNull();
  });
});
