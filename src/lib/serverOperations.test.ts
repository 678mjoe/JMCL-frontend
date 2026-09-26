import { describe, expect, test } from "bun:test";
import { ServerOperationsController, type ServerOperationsRpc } from "./serverOperations";
import { createEmptyServerStatusCache, type ServerStatusCacheV1 } from "./serverStatusCache";
import type { ServerLifecycleStartResult, ServerManifest } from "./types";

const manifest: ServerManifest = { id: "alpha", name: "Alpha", version_id: "1.21.4", fabric_loader: null, neoforge_version: null, forge_version: null, source: "official", accept_eula: false, java_path: null, installed: false };
const installed = { ...manifest, installed: true, accept_eula: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function harness(overrides: Partial<ServerOperationsRpc> = {}) {
  let cache: ServerStatusCacheV1 = createEmptyServerStatusCache();
  const calls: string[] = [];
  const rpc = {
    install: async (_d, id, options, event) => { calls.push(`install:${id}:${options.accept_eula}`); event?.({ event: "progress", source: "official", progress: { files_completed: 1, files_total: 1, bytes_verified: 10, bytes_total: 10, bytes_processed: 10, bytes_transferred: 10 } }); return { stage: "server.install", id, version_id: "1.21.4", source: "official", java: { path: "/java", version: "21", major_version: 21, vendor: "test" }, properties_created: true, files_total: 1, files_downloaded: 1, files_cached: 0, files_hard_linked: 0, files_copied: 0, bytes_verified: 10, bytes_transferred: 10 }; },
    get: async (_d, id) => { calls.push(`get:${id}`); return { stage: "server.get", ...installed }; },
    start: async (_d, id) => { calls.push(`start:${id}`); return { stage: "server.start", id, running: true, pid: 44, supervisor_pid: 43, started_at_ms: 1000, java_path: "/java" }; },
    stop: async (_d, id) => { calls.push(`stop:${id}`); return { stage: "server.stop", id, running: false, termination: "graceful", pid: 44 }; },
    restart: async (_d, id) => { calls.push(`restart:${id}`); return { stage: "server.restart", id, running: true, pid: 45, supervisor_pid: 43, started_at_ms: 2000, java_path: "/java2" }; },
    delete: async (_d, id) => { calls.push(`delete:${id}`); return { stage: "server.delete", id, deleted: true }; },
    ...overrides,
  } as Omit<ServerOperationsRpc, "close">;
  const records: string[] = [];
  let currentScope = { directory: "/servers", sourceRevision: 1 };
  let forcedCurrent: boolean | null = null;
  const directory = {
    captureOperationScope: () => currentScope,
    isOperationScopeCurrent: (scope: { directory: string; sourceRevision: number }) => forcedCurrent ?? (scope.directory === currentScope.directory && scope.sourceRevision === currentScope.sourceRevision),
    recordInstalled: async (_m: ServerManifest) => { records.push("installed"); return true; },
    recordStarted: async (_id: string, _r: unknown) => { records.push("started"); return true; },
    recordStopped: async (_id: string) => { records.push("stopped"); return true; },
    recordLifecycleError: async (_id: string, code: string) => { records.push(`error:${code}`); return true; },
    recordDeleted: async (_id: string) => { records.push("deleted"); return true; },
  };
  let closeCount = 0;
  const controller = new ServerOperationsController({
    openSession: async () => ({ ...rpc, close: async () => { closeCount += 1; } }),
    directory,
    storeDirectory: "/store",
  });
  return { controller, calls, records, setScope: (scope: { directory: string; sourceRevision: number }) => { currentScope = scope; forcedCurrent = null; }, setScopeCurrent: (current: boolean) => { forcedCurrent = current; }, get closeCount() { return closeCount; }, cache: () => cache };
}

describe("ServerOperationsController", () => {
  test("installs accepted EULA on a dedicated session, reads manifest once and waits in finishing stage", async () => {
    let finish!: () => void;
    const h = harness({ install: async (_d, id, _opts, event) => { event?.({ event: "progress", source: "official", progress: { files_completed: 1, files_total: 1, bytes_verified: 1, bytes_total: 1, bytes_processed: 1, bytes_transferred: 1 } }); await new Promise<void>((resolve) => { finish = resolve; }); return { stage: "server.install", id, version_id: "1.21.4", source: "official", java: {} as never, properties_created: true, files_total: 1, files_downloaded: 1, files_cached: 0, files_hard_linked: 0, files_copied: 0, bytes_verified: 1, bytes_transferred: 1 }; } });
    const promise = h.controller.install(manifest, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.calls).toEqual([]);
    expect(h.controller.operationFor("alpha")?.stage).toBe("finishing");
    finish(); await promise;
    expect(h.calls).toEqual(["get:alpha"]);
    expect(h.records).toEqual(["installed"]);
    expect(h.closeCount).toBe(1);
  });

  test("prevents first install without consent and allows repair without another consent", async () => {
    const h = harness();
    await expect(h.controller.install(manifest, false)).rejects.toThrow();
    expect(h.calls).toEqual([]);
    await h.controller.install(installed, false);
    expect(h.calls).toEqual(["install:alpha:true", "get:alpha"]);
  });

  test("same server is exclusive while different servers run independently", async () => {
    const releases: (() => void)[] = [];
    const h = harness({ start: async (_d, id) => { h.calls.push(`start:${id}`); await new Promise<void>((resolve) => { releases.push(resolve); }); return { stage: "server.start", id, running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/j" }; } });
    const a = { ...installed, id: "alpha" }, b = { ...installed, id: "beta" };
    const first = h.controller.start(a);
    await Promise.resolve(); await Promise.resolve();
    const duplicate = await h.controller.start(a);
    expect(duplicate).toBe(false);
    const other = h.controller.start(b);
    await Promise.resolve(); await Promise.resolve();
    expect(h.calls).toEqual(["start:alpha", "start:beta"]);
    releases.forEach((release) => release()); await Promise.all([first, other]);
  });

  test("every lifecycle mutation uses exactly one RPC and records its terminal transition", async () => {
    const h = harness();
    await h.controller.start(installed);
    await h.controller.stop(installed);
    await h.controller.restart(installed);
    expect(h.calls).toEqual(["start:alpha", "stop:alpha", "restart:alpha"]);
    expect(h.records).toEqual(["started", "stopped", "started"]);
    expect(h.closeCount).toBe(3);
  });

  test("closes dedicated session on RPC failure and records stable lifecycle error", async () => {
    const h = harness({ start: async () => { throw Object.assign(new Error("display only"), { code: "SERVER_ALREADY_RUNNING" }); } });
    await expect(h.controller.start(installed)).rejects.toThrow("display only");
    expect(h.records).toEqual(["error:SERVER_ALREADY_RUNNING"]);
    expect(h.closeCount).toBe(1);
  });

  test("does not record lifecycle error when opening the session fails before an RPC attempt", async () => {
    const h = harness();
    const controller = new ServerOperationsController({
      openSession: async () => { throw new Error("session unavailable"); },
      directory: {
        captureOperationScope: () => ({ directory: "/servers", sourceRevision: 1 }),
        isOperationScopeCurrent: () => true,
        recordInstalled: async () => true,
        recordStarted: async () => true,
        recordStopped: async () => true,
        recordLifecycleError: async (_id, code) => { h.records.push(`error:${code}`); return true; },
        recordDeleted: async () => true,
      },
    });
    await expect(controller.start(installed)).rejects.toThrow("session unavailable");
    expect(h.records).toEqual([]);
  });

  test("records unknown lifecycle error after an uncertain lifecycle RPC failure", async () => {
    const h = harness({ start: async () => { throw new Error("connection lost"); } });
    await expect(h.controller.start(installed)).rejects.toThrow("connection lost");
    expect(h.records).toEqual(["error:UNKNOWN"]);
  });

  test("delete records removal only after one successful RPC", async () => {
    const h = harness();
    await h.controller.delete(installed);
    expect(h.calls).toEqual(["delete:alpha"]);
    expect(h.records).toEqual(["deleted"]);
  });

  test("does not report success or invoke RPC after the directory source changes", async () => {
    const h = harness();
    h.setScopeCurrent(false);
    await expect(h.controller.delete(installed)).resolves.toBe(false);
    expect(h.calls).toEqual([]);
    expect(h.closeCount).toBe(1);
  });

  test("same ID in a new source has no visible old pending state and starts independently", async () => {
    const first = deferred<ServerLifecycleStartResult>();
    const second = deferred<ServerLifecycleStartResult>();
    let starts = 0;
    const h = harness({ start: async (_d, _id) => (++starts === 1 ? first.promise : second.promise) });
    const oldAction = h.controller.start(installed);
    await Promise.resolve(); await Promise.resolve();
    expect(h.controller.operationFor("alpha")?.pending).toBe(true);
    h.setScope({ directory: "/next", sourceRevision: 2 });
    expect(h.controller.operationFor("alpha")).toBeUndefined();
    const newAction = h.controller.start(installed);
    await Promise.resolve(); await Promise.resolve();
    expect(starts).toBe(2);
    expect(h.controller.operationFor("alpha")).toMatchObject({ pending: true, kind: "start" });
    second.resolve({ stage: "server.start", id: "alpha", running: true, pid: 2, supervisor_pid: 3, started_at_ms: 4, java_path: "/new" });
    await newAction;
    first.resolve({ stage: "server.start", id: "alpha", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/old" });
    await oldAction;
    expect(h.controller.operationFor("alpha")).toMatchObject({ pending: false, kind: "start", error: null });
    expect(h.records).toEqual(["started"]);
  });

  test("old scope failure cannot replace a new scope operation state", async () => {
    const first = deferred<ServerLifecycleStartResult>();
    const second = deferred<ServerLifecycleStartResult>();
    let starts = 0;
    const h = harness({ start: async () => (++starts === 1 ? first.promise : second.promise) });
    const oldAction = h.controller.start(installed).catch(() => false);
    await Promise.resolve(); await Promise.resolve();
    h.setScope({ directory: "/next", sourceRevision: 2 });
    const newAction = h.controller.start(installed);
    await Promise.resolve(); await Promise.resolve();
    second.resolve({ stage: "server.start", id: "alpha", running: true, pid: 2, supervisor_pid: 3, started_at_ms: 4, java_path: "/new" });
    await newAction;
    first.reject(new Error("old scope failed"));
    await oldAction;
    expect(h.controller.operationFor("alpha")).toMatchObject({ pending: false, error: null });
  });

  test("an old in-flight result cannot mutate the directory cache after a source switch", async () => {
    const result = deferred<ServerLifecycleStartResult>();
    const h = harness({ start: async () => result.promise });
    const oldAction = h.controller.start(installed);
    await Promise.resolve(); await Promise.resolve();
    h.setScope({ directory: "/next", sourceRevision: 2 });
    result.resolve({ stage: "server.start", id: "alpha", running: true, pid: 1, supervisor_pid: 2, started_at_ms: 3, java_path: "/old" });
    await oldAction;
    expect(h.records).toEqual([]);
    expect(h.controller.operationFor("alpha")).toBeUndefined();
  });
});
