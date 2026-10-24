import { describe, expect, test } from "bun:test";
import { ServerWorldsController, type ServerWorldsSession } from "./serverWorlds";
import { ServerAdvancedController, type ServerAdvancedSession } from "./serverAdvanced";
import { ServerOperationsController, type ServerOperationsRpc } from "./serverOperations";
import { ServerLogController } from "./serverLogController";
import { serverTargetBusy } from "./serverTargetLock";
import type { ServerOperationScope } from "./servers";
import type { ServerManifest, ServerStatus, ServerWorldEntry, ServerWorldListResult, ServerWorldDeleteResult } from "./types";

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const status = (running = false): ServerStatus => ({ stage: "server.status", id: "demo", running, stale_state: false, pid: null, supervisor_pid: null, java_path: null, started_at_ms: null, uptime_ms: null });
const world: ServerWorldEntry = { name: "world", level_name: "Fixture", version_name: "1.21.4", version_id: 4189, game_mode: "survival", hardcore: false, cheats: false, difficulty: 2, last_played_ms: 10, size_bytes: 100, has_icon: false, locked: false, version_relation: "same" };
const manifest: ServerManifest = { id: "demo", name: "Demo", version_id: "1.21.4", installed: true, accept_eula: true, source: "official", fabric_loader: null, neoforge_version: null, forge_version: null, java_path: null };
let nextId = 0;
function harness(overrides: Partial<ServerWorldsSession> = {}, opening?: () => Promise<ServerWorldsSession>, refreshStatus?: () => Promise<void>) {
  const initialScope: ServerOperationScope = { endpointId: `world-test-${++nextId}`, kind: "ssh", directory: "/synthetic", sourceRevision: 1 };
  let scope = initialScope, opens = 0, closes = 0, refreshes = 0;
  const calls: string[] = [];
  const mutations: unknown[][] = [];
  const session: ServerWorldsSession = {
    close: async () => { closes++; },
    serverStatus: async () => { calls.push("status"); return status(); },
    serverPropertiesGet: async () => { calls.push("properties"); return { stage: "server.properties.get", id: "demo", properties: { "level-name": "world", "rcon.password": "fixture-must-not-retain" } }; },
    serverWorldsList: async (...args) => { calls.push("list"); expect(args).toEqual(["/synthetic", "demo", "1.21.4"]); return { stage: "server.worlds.list", id: "demo", worlds: [{ ...world }] }; },
    serverWorldsBackups: async () => { calls.push("backups"); return { stage: "server.worlds.backups", id: "demo", backups: [{ file: "fixture.zip", world: null, created_ms: 20, size_bytes: 80 }] }; },
    serverWorldsGet: async (...args) => { calls.push("get"); expect(args).toEqual(["/synthetic", "demo", "world", "1.21.4"]); return { stage: "server.worlds.get", id: "demo", world: { ...world }, icon_png_base64: null }; },
    serverWorldsRename: async (...args) => { calls.push("rename"); mutations.push(args); return { stage: "server.worlds.rename", renamed: { old_name: args[2], new_name: args[3] } }; },
    serverWorldsDelete: async (...args) => { calls.push("delete"); mutations.push(args); return { stage: "server.worlds.delete", deleted: args[2] }; },
    serverWorldsBackup: async (...args) => { calls.push("backup"); mutations.push(args); return { stage: "server.worlds.backup", backup: "fixture.zip" }; },
    serverWorldsRestore: async (...args) => { calls.push("restore"); mutations.push(args); return { stage: "server.worlds.restore", restored: "world" }; },
    ...overrides,
  };
  const isScopeCurrent = (value: ServerOperationScope) => JSON.stringify(value) === JSON.stringify(scope);
  const controllerFor = () => new ServerWorldsController({ id: "demo", version: "1.21.4", scope, isScopeCurrent, openSession: async () => { opens++; return opening ? opening() : session; }, refreshStatus: () => { refreshes++; return refreshStatus ? refreshStatus() : Promise.resolve(); } });
  return { controller: controllerFor(), controllerFor, session, initialScope, isScopeCurrent, calls, mutations, setScope: (value: ServerOperationScope) => { scope = value; }, get scope() { return scope; }, get opens() { return opens; }, get closes() { return closes; }, get refreshes() { return refreshes; } };
}
function lifecycle(h: ReturnType<typeof harness>, overrides: Partial<ServerOperationsRpc> = {}) {
  const rpc: ServerOperationsRpc = {
    close: async () => {}, install: async () => {}, get: async () => ({ stage: "server.get", ...manifest }),
    start: async () => ({ stage: "server.start", id: "demo", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/synthetic/java" }),
    stop: async () => ({ stage: "server.stop", id: "demo", running: false, termination: "graceful", pid: 1 }),
    restart: async () => ({ stage: "server.restart", id: "demo", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/synthetic/java" }), delete: async () => {}, ...overrides,
  };
  return new ServerOperationsController({ openSession: async () => rpc, directory: { captureOperationScope: () => h.scope, isOperationScopeCurrent: h.isScopeCurrent, recordInstalled: async () => true, recordStarted: async () => true, recordStopped: async () => true, recordLifecycleError: async () => true, recordDeleted: async () => true } });
}
const actions = [
  (c: ServerWorldsController) => c.rename("world", "renamed", "world"),
  (c: ServerWorldsController) => c.deleteWorld("world", "world"),
  (c: ServerWorldsController) => c.backup(),
  (c: ServerWorldsController) => c.restore("fixture.zip", true, "fixture.zip"),
];

describe("server world controller safety", () => {
  test("reads metadata and details while running without retaining properties or passwords", async () => {
    const h = harness({ serverStatus: async () => status(true) });
    expect(await h.controller.load()).toBe(true);
    expect(h.controller.getSnapshot()).toMatchObject({ worlds: [world], baseWorld: "world", status: { running: true }, error: null });
    expect(await h.controller.get("world")).toBe(true);
    expect(h.controller.getSnapshot().detail?.world).toEqual(world);
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-must-not-retain");
    expect(h.closes).toBe(2);
    expect(h.mutations).toEqual([]);
  });
  for (const [label, authority, code] of [
    ["running", status(true), "SERVER_ALREADY_RUNNING"],
    ["unknown", { ...status(), running: undefined } as unknown as ServerStatus, "SERVER_STATUS_FAILED"],
    ["wrong target", { ...status(), id: "other" }, "INVALID_PARAMS"],
  ] as const) test(`all mutations reject ${label} authoritative status`, async () => {
    for (const action of actions) {
      const h = harness({ serverStatus: async () => authority });
      expect(await action(h.controller)).toBe(false);
      expect(h.mutations).toHaveLength(0);
      expect(h.controller.getSnapshot().error).toBe(code);
      expect(h.refreshes).toBe(1);
    }
  });
  test("failed status and connection errors cannot dispatch mutations or retain raw diagnostics", async () => {
    for (const code of ["SERVER_STATUS_FAILED", "SSH_DISCONNECTED", "fixture-private-code"]) {
      const h = harness({ serverStatus: async () => { throw { code, message: "fixture-private-diagnostic" }; } });
      expect(await h.controller.backup()).toBe(false);
      expect(h.mutations).toHaveLength(0);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("fixture-private");
      expect(h.controller.getSnapshot().status).toBeNull();
    }
  });
  test("each mutation gets fresh authority then refreshes world/backup/base/status lists", async () => {
    const h = harness();
    for (const action of actions) {
      h.calls.length = 0;
      expect(await action(h.controller)).toBe(true);
      expect(h.calls[0]).toBe("status");
      expect(h.calls.slice(-4)).toEqual(["list", "backups", "properties", "status"]);
      expect(h.controller.getSnapshot().pending).toBe(false);
    }
    expect(h.refreshes).toBe(4);
    expect(h.mutations).toEqual([["/synthetic", "demo", "world", "renamed"], ["/synthetic", "demo", "world"], ["/synthetic", "demo", {}], ["/synthetic", "demo", "fixture.zip", true]]);
  });
  test("whole-world backup omits world and restore preserves explicit replace false/true", async () => {
    const h = harness();
    await h.controller.backup("before-upgrade");
    await h.controller.restore("fixture.zip", false, "fixture.zip");
    await h.controller.restore("fixture.zip", true, "fixture.zip");
    expect(h.mutations).toEqual([["/synthetic", "demo", { label: "before-upgrade" }], ["/synthetic", "demo", "fixture.zip", false], ["/synthetic", "demo", "fixture.zip", true]]);
  });
  test("names, exact confirmation and path-free identifiers are required", async () => {
    const h = harness();
    const invalid = [() => h.controller.rename("world", "new", "World"), () => h.controller.rename("world", "world", "world"), () => h.controller.deleteWorld("world", ""), () => h.controller.restore("fixture.zip", true, "world"), () => h.controller.restore("fixture.zip", undefined as unknown as boolean, "fixture.zip")];
    for (const name of ["", ".", "..", "nested/world", "nested\\world", "bad\0name", "bad\nname"]) invalid.push(() => h.controller.rename("world", name, "world"), () => h.controller.deleteWorld(name, name), () => h.controller.restore(name, true, name));
    for (const action of invalid) { expect(await action()).toBe(false); expect(h.controller.getSnapshot().error).toBe("INVALID_PARAMS"); }
    expect(h.mutations).toHaveLength(0);
  });
  test("WORLD_EXISTS and WORLD_LOCKED refresh lists without an automatic retry or overwrite", async () => {
    for (const code of ["WORLD_EXISTS", "WORLD_LOCKED", "BACKUP_NOT_FOUND", "WORLD_NOT_FOUND"]) {
      let attempts = 0;
      const h = harness({ serverWorldsRestore: async () => { attempts++; throw { code, message: "private fixture path" }; } });
      expect(await h.controller.restore("fixture.zip", false, "fixture.zip")).toBe(false);
      expect(attempts).toBe(1);
      expect(h.controller.getSnapshot()).toMatchObject({ error: code, worlds: [world], backups: [{ file: "fixture.zip" }], pending: false });
      expect(h.refreshes).toBe(1);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private fixture");
    }
  });
  test("failed refresh clears stale lists and does not turn a confirmed mutation into failure", async () => {
    let failed = false;
    const h = harness({ serverWorldsList: async () => { if (failed) throw { code: "WORLD_LIST_FAILED" }; return { stage: "server.worlds.list", id: "demo", worlds: [world] }; }, serverWorldsDelete: async () => { failed = true; return { stage: "server.worlds.delete", deleted: "world" }; } });
    await h.controller.load();
    expect(await h.controller.deleteWorld("world", "world")).toBe(true);
    expect(h.controller.getSnapshot()).toMatchObject({ worlds: null, refreshError: "WORLD_LIST_FAILED", error: null, baseWorld: "world" });
  });
  test("wrong target reads and wrong detail names never enter the snapshot", async () => {
    const h = harness({ serverWorldsList: async () => ({ stage: "server.worlds.list", id: "other", worlds: [world] }), serverWorldsBackups: async () => ({ stage: "server.worlds.backups", id: "other", backups: [] }), serverPropertiesGet: async () => ({ stage: "server.properties.get", id: "other", properties: { "level-name": "private" } }), serverWorldsGet: async () => ({ stage: "server.worlds.get", id: "demo", world: { ...world, name: "other" }, icon_png_base64: null }) });
    await h.controller.load();
    expect(h.controller.getSnapshot()).toMatchObject({ worlds: null, backups: null, baseWorld: null, refreshError: "INVALID_PARAMS" });
    expect(await h.controller.get("world")).toBe(false);
    expect(h.controller.getSnapshot().detail).toBeNull();
  });
  test("cancel while opening prevents status and mutation and closes the eventual session", async () => {
    const gate = deferred<ServerWorldsSession>();
    const h = harness({}, () => gate.promise);
    const request = h.controller.backup(); h.controller.cancel();
    gate.resolve(h.session);
    expect(await request).toBe(false);
    expect(h.calls).toEqual([]); expect(h.closes).toBe(1); expect(h.mutations).toEqual([]);
  });
  test("cancel or source revision changes during status prevent mutation dispatch", async () => {
    for (const mode of ["cancel", "endpoint", "revision"]) {
      const gate = deferred<ServerStatus>();
      const h = harness({ serverStatus: () => gate.promise });
      const request = h.controller.deleteWorld("world", "world"); await flush();
      if (mode === "cancel") h.controller.cancel();
      else h.setScope({ ...h.scope, ...(mode === "endpoint" ? { endpointId: "other" } : { sourceRevision: 2 }) });
      gate.resolve(status()); expect(await request).toBe(false);
      expect(h.mutations).toEqual([]); expect(h.refreshes).toBe(0);
    }
  });
  test("late read responses after source switch cannot populate metadata or run later refreshes", async () => {
    const gate = deferred<ServerWorldListResult>();
    const h = harness({ serverWorldsList: () => gate.promise });
    const request = h.controller.load(); await flush();
    h.setScope({ ...h.scope, sourceRevision: 2 });
    gate.resolve({ stage: "server.worlds.list", id: "demo", worlds: [world] });
    expect(await request).toBe(false);
    expect(h.controller.getSnapshot().worlds).toBeNull(); expect(h.calls).toEqual([]); expect(h.refreshes).toBe(0);
  });
  test("repeat, cancel, away/back and lifecycle cannot unlock a dispatched mutation before cleanup", async () => {
    const mutation = deferred<ServerWorldDeleteResult>(); const cleanup = deferred<void>(); let closes = 0, writes = 0;
    const h = harness({ serverWorldsDelete: () => { writes++; return mutation.promise; }, close: () => { closes++; return cleanup.promise; } });
    const request = h.controller.deleteWorld("world", "world"); await flush();
    expect(await h.controller.backup()).toBe(false);
    h.controller.cancel(); h.controller.cancel(); await flush();
    h.setScope({ ...h.scope, endpointId: "other" }); h.setScope({ ...h.initialScope, sourceRevision: 3 });
    expect(await h.controllerFor().backup()).toBe(false);
    expect(await lifecycle(h).start(manifest)).toBe(false);
    mutation.resolve({ stage: "server.worlds.delete", deleted: "world" }); await flush();
    expect(serverTargetBusy(h.scope, "demo")).toBe(true); expect(writes).toBe(1); expect(closes).toBe(1);
    cleanup.resolve(); expect(await request).toBe(false);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false); expect(h.controller.getSnapshot().worlds).toBeNull();
  });
  test("cancel during post-mutation refresh returns false and discards late lists", async () => {
    const gate = deferred<ServerWorldListResult>();
    const h = harness({ serverWorldsList: () => gate.promise });
    const request = h.controller.backup(); await flush(); h.controller.cancel();
    gate.resolve({ stage: "server.worlds.list", id: "demo", worlds: [world] });
    expect(await request).toBe(false);
    expect(h.controller.getSnapshot().worlds).toBeNull(); expect(h.refreshes).toBe(0);
  });
  test("lifecycle exclusion is bidirectional and other endpoints are independent", async () => {
    const gate = deferred<void>();
    const h = harness(); const other = lifecycle(h, { stop: async () => { await gate.promise; return { stage: "server.stop", id: "demo", running: false, termination: "graceful", pid: 1 }; } });
    const request = other.stop(manifest); await flush();
    expect(await h.controller.backup()).toBe(false); expect(h.opens).toBe(0);
    h.setScope({ ...h.scope, endpointId: `${h.scope.endpointId}-other` });
    expect(await h.controllerFor().backup()).toBe(true);
    gate.resolve(); await request;
  });
  test("properties and FIFO share the same physical mutation lock", async () => {
    const h = harness(); const gate = deferred<void>();
    const advanced = new ServerAdvancedController({ id: "demo", scope: h.scope, isScopeCurrent: h.isScopeCurrent, openSession: async () => ({ close: async () => {}, serverStatus: async () => status(), serverPropertiesSet: async () => { await gate.promise; return { stage: "server.properties.set", id: "demo", properties: { motd: "fixture" } }; } } as unknown as ServerAdvancedSession) });
    const property = advanced.saveProperties({ motd: "fixture" }); await flush();
    expect(await h.controller.backup()).toBe(false); expect(h.opens).toBe(0);
    gate.resolve(); expect(await property).toBe(true);
    const commandGate = deferred<void>();
    const logs = new ServerLogController({ serverId: "demo", captureScope: () => h.scope, isScopeCurrent: h.isScopeCurrent, setTimer: () => 1, clearTimer: () => {}, openSession: async () => ({ close: async () => {}, serverLogs: async () => ({ stage: "server.logs", id: "demo", text: "", file_id: 1, start_cursor: 0, next_cursor: 0, eof: true, reset: false, truncated: false }), serverCommand: async () => { await commandGate.promise; return { stage: "server.command", id: "demo", accepted: true, pid: 1 }; } }) });
    await logs.open(); logs.setRunning(true); const command = logs.submitCommand("list"); await flush();
    expect(await h.controller.backup()).toBe(false); expect(h.opens).toBe(0);
    commandGate.resolve(); expect(await command).toBe(true); await logs.close();
    expect(await h.controller.backup()).toBe(true);
  });
  test("world mutation blocks properties and FIFO before either can dispatch", async () => {
    const h = harness();
    let writes = 0, commands = 0;
    const logs = new ServerLogController({ serverId: "demo", captureScope: () => h.scope, isScopeCurrent: h.isScopeCurrent, setTimer: () => 1, clearTimer: () => {}, openSession: async () => ({ close: async () => {}, serverLogs: async () => ({ stage: "server.logs", id: "demo", text: "", file_id: 1, start_cursor: 0, next_cursor: 0, eof: true, reset: false, truncated: false }), serverCommand: async () => { commands++; return { stage: "server.command", id: "demo", accepted: true, pid: 1 }; } }) });
    await logs.open(); logs.setRunning(true);
    const gate = deferred<ServerWorldDeleteResult>();
    h.session.serverWorldsDelete = () => gate.promise;
    const request = h.controller.deleteWorld("world", "world"); await flush();
    const advanced = new ServerAdvancedController({ id: "demo", scope: h.scope, isScopeCurrent: h.isScopeCurrent, openSession: async () => { writes++; throw new Error("must not open"); } });
    expect(await advanced.saveProperties({ motd: "fixture" })).toBe(false);
    expect(await logs.submitCommand("list")).toBe(false);
    expect(writes).toBe(0); expect(commands).toBe(0);
    gate.resolve({ stage: "server.worlds.delete", deleted: "world" }); expect(await request).toBe(true);
    await logs.close();
  });
  test("revision switch during successful cleanup suppresses success until the physical lock settles", async () => {
    const gate = deferred<void>();
    const h = harness({ close: () => gate.promise });
    const request = h.controller.backup(); await flush();
    expect(serverTargetBusy(h.scope, "demo")).toBe(true);
    h.setScope({ ...h.scope, sourceRevision: 2 });
    expect(await h.controllerFor().backup()).toBe(false);
    gate.resolve(); expect(await request).toBe(false);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
  });
  test("authoritative stopped with stale process state is usable, never inferred from a cached running flag", async () => {
    const h = harness({ serverStatus: async () => ({ ...status(false), stale_state: true }) });
    expect(await h.controller.backup()).toBe(true);
    expect(h.mutations).toHaveLength(1);
  });
  test("synchronous provider refresh failure still closes and releases a confirmed mutation", async () => {
    const h = harness({}, undefined, () => { throw new Error("private provider error"); });
    expect(await h.controller.backup()).toBe(true);
    expect(h.closes).toBe(1); expect(serverTargetBusy(h.scope, "demo")).toBe(false);
    expect(h.controller.getSnapshot()).toMatchObject({ error: null, refreshError: "UNKNOWN", pending: false });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private provider error");
  });
  test("cleanup rejection releases lock without leaking diagnostics or undoing confirmed result", async () => {
    const h = harness({ close: async () => { throw new Error("private-cleanup"); } });
    expect(await h.controller.backup()).toBe(true);
    expect(serverTargetBusy(h.scope, "demo")).toBe(false);
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private-cleanup");
  });
});
