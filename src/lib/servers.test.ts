import { describe, expect, test } from "bun:test";
import {
  createServerController,
  type ServerControllerRpc,
} from "./servers";
import {
  createEmptyServerStatusCache,
  reduceServerCreated,
  type ServerStatusCacheV1,
} from "./serverStatusCache";
import type { ServerManifest, ServerStatus } from "./types";

const directory = "/mock/jmcl/servers";

function manifest(id: string, overrides: Partial<ServerManifest> = {}): ServerManifest {
  return {
    id,
    name: id,
    version_id: "1.21.4",
    fabric_loader: null,
    neoforge_version: null,
    forge_version: null,
    source: "official",
    accept_eula: false,
    java_path: null,
    installed: false,
    ...overrides,
  };
}

function status(id: string, running = false): ServerStatus {
  return {
    stage: "server.status",
    id,
    running,
    stale_state: false,
    pid: running ? 42 : null,
    supervisor_pid: running ? 7 : null,
    java_path: running ? "/mock/java" : null,
    started_at_ms: running ? 100 : null,
    uptime_ms: running ? 500 : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeRpc(
  listServers: ServerManifest[] = [manifest("keep"), manifest("new")],
): ServerControllerRpc & {
  calls: string[];
  cache: ServerStatusCacheV1;
} {
  const calls: string[] = [];
  let cache = reduceServerCreated(
    reduceServerCreated(createEmptyServerStatusCache(), "local", directory, "keep", 1),
    "local",
    directory,
    "deleted",
    1,
  );
  return {
    calls,
    get cache() {
      return cache;
    },
    set cache(next: ServerStatusCacheV1) {
      cache = next;
    },
    list: async () => {
      calls.push("list");
      return { stage: "server.list", servers: listServers };
    },
    status: async (_directory, id) => {
      calls.push(`status:${id}`);
      return status(id, true);
    },
    readCache: async () => {
      calls.push("read-cache");
      return cache;
    },
    writeCache: async (next) => {
      calls.push("write-cache");
      cache = next;
    },
  };
}

describe("server directory controller", () => {
  test("startup lists once, reconciles cache, and never asks for status", async () => {
    const rpc = fakeRpc();
    const controller = createServerController(rpc, { now: () => 10 });

    await controller.start({ sessionKey: "session-a", directory });

    expect(rpc.calls.filter((call) => call === "list")).toHaveLength(1);
    expect(rpc.calls.some((call) => call.startsWith("status:"))).toBe(false);
    expect(controller.getSnapshot().manifests.map((item) => item.id)).toEqual(["keep", "new"]);
    expect(controller.getSnapshot().cache.scopes.local.servers.deleted).toBeUndefined();
    expect(controller.getSnapshot().cache.scopes.local.servers.new).toBeUndefined();
  });

  test("refreshList is one list request and zero status requests", async () => {
    const rpc = fakeRpc();
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "session-b", directory });
    rpc.calls.length = 0;

    await controller.refreshList();

    expect(rpc.calls.filter((call) => call === "list")).toHaveLength(1);
    expect(rpc.calls.some((call) => call.startsWith("status:"))).toBe(false);
  });

  test("list reconciliation preserves status cache and deduplicates manifest IDs", async () => {
    const rpc = fakeRpc([manifest("listed", { installed: true })]);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "list-cache-dedupe", directory });
    await controller.recordStarted("listed", { stage: "server.start", id: "listed", running: true, pid: 77, supervisor_pid: 78, java_path: "/java", started_at_ms: 79 }, controller.captureOperationScope()!);
    rpc.list = async () => ({ stage: "server.list", servers: [manifest("listed"), manifest("listed", { name: "Listed again" })] });
    await controller.refreshList();
    expect(controller.getSnapshot().manifests).toHaveLength(1);
    expect(controller.getSnapshot().cache.scopes.local.servers.listed).toMatchObject({ state: "running", pid: 77 });
  });

  test("a list started before delete cannot restore the deleted manifest", async () => {
    const listed = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const rpc = fakeRpc([manifest("deleted")]);
    let calls = 0;
    rpc.list = async () => (++calls === 1 ? { stage: "server.list", servers: [manifest("deleted")] } : listed.promise);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "list-delete", directory });
    const refresh = controller.refreshList();
    const scope = controller.captureOperationScope()!;
    await controller.recordDeleted("deleted", scope);
    expect(controller.getSnapshot().loading).toBe(false);
    listed.resolve({ stage: "server.list", servers: [manifest("deleted"), manifest("keep")] });
    await refresh;
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual([]);
  });

  test.each(["create", "install"] as const)("a list started before %s cannot undo the manifest transition", async (transition) => {
    const listed = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const rpc = fakeRpc([]);
    let calls = 0;
    rpc.list = async () => (++calls === 1 ? { stage: "server.list", servers: [] } : listed.promise);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: `list-${transition}`, directory });
    const refresh = controller.refreshList();
    if (transition === "create") await controller.recordCreated(manifest("created"));
    else await controller.recordInstalled(manifest("installed", { installed: true }), controller.captureOperationScope()!);
    expect(controller.getSnapshot().loading).toBe(false);
    listed.resolve({ stage: "server.list", servers: [] });
    await refresh;
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual([transition === "create" ? "created" : "installed"]);
  });

  test("source switch makes old list success, error, and finally inert", async () => {
    const old = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const newList = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const rpc = fakeRpc([]);
    let listCount = 0;
    rpc.list = async () => {
      const call = ++listCount;
      if (call === 2) return old.promise;
      if (call === 4) return newList.promise;
      return { stage: "server.list", servers: [manifest(call === 1 ? "old-startup" : "new-startup")] };
    };
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "list-source-a", directory });
    const oldRefresh = controller.refreshList();
    await controller.start({ sessionKey: "list-source-b", directory: "/other" });
    const newRefresh = controller.refreshList();
    old.resolve({ stage: "server.list", servers: [manifest("old-list")] });
    await oldRefresh;
    expect(controller.getSnapshot().loading).toBe(true);
    newList.resolve({ stage: "server.list", servers: [manifest("new-list")] });
    await newRefresh;
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual(["new-list"]);
    expect(controller.getSnapshot().listError).toBeNull();
  });

  test("old list error after source switch cannot clear the new list loading state", async () => {
    const oldError = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const current = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const rpc = fakeRpc([]);
    let calls = 0;
    rpc.list = async () => {
      const call = ++calls;
      if (call === 2) return oldError.promise;
      if (call === 4) return current.promise;
      return { stage: "server.list", servers: [] };
    };
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "list-error-source-a", directory });
    const oldRefresh = controller.refreshList();
    await controller.start({ sessionKey: "list-error-source-b", directory: "/other" });
    const newRefresh = controller.refreshList();
    oldError.reject(new Error("old source error"));
    await oldRefresh;
    expect(controller.getSnapshot().loading).toBe(true);
    expect(controller.getSnapshot().listError).toBeNull();
    current.resolve({ stage: "server.list", servers: [manifest("current")] });
    await newRefresh;
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual(["current"]);
  });

  test("only newest overlapping explicit list refresh updates state", async () => {
    const older = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const newer = deferred<{ stage: "server.list"; servers: ServerManifest[] }>();
    const rpc = fakeRpc([]);
    let listCount = 0;
    rpc.list = async () => (++listCount === 1 ? { stage: "server.list", servers: [] } : listCount === 2 ? older.promise : newer.promise);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "list-overlap", directory });
    const first = controller.refreshList();
    const second = controller.refreshList();
    newer.resolve({ stage: "server.list", servers: [manifest("newer")] });
    await second;
    older.resolve({ stage: "server.list", servers: [manifest("older")] });
    await first;
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual(["newer"]);
    expect(controller.getSnapshot().loading).toBe(false);
  });

  test("a StrictMode-style startup effect replay shares one settled list", async () => {
    const rpc = fakeRpc();
    const controller = createServerController(rpc);
    await Promise.all([
      controller.start({ sessionKey: "strict-session", directory }),
      controller.start({ sessionKey: "strict-session", directory }),
    ]);

    expect(rpc.calls.filter((call) => call === "list")).toHaveLength(1);
  });

  test("refreshServerStatus performs one status request and persists the reducer result", async () => {
    const rpc = fakeRpc([manifest("keep", { installed: true })]);
    const controller = createServerController(rpc, { now: () => 20 });
    await controller.start({ sessionKey: "session-c", directory });
    rpc.calls.length = 0;

    await controller.refreshServerStatus("keep");

    expect(rpc.calls).toEqual(["status:keep", "write-cache"]);
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("running");
  });

  test("discards a status response started before a lifecycle transition, then permits a fresh refresh", async () => {
    const first = deferred<ServerStatus>();
    const rpc = fakeRpc([manifest("keep", { installed: true })]);
    rpc.status = async () => first.promise;
    const controller = createServerController(rpc, { now: () => 21 });
    await controller.start({ sessionKey: "status-transition", directory });
    const refresh = controller.refreshServerStatus("keep");
    await Promise.resolve();
    await controller.recordStarted("keep", { stage: "server.start", id: "keep", running: true, pid: 88, supervisor_pid: 89, java_path: "/new", started_at_ms: 90 }, controller.captureOperationScope()!);
    first.resolve(status("keep", false));
    await refresh;
    expect(controller.getSnapshot().cache.scopes.local.servers.keep).toMatchObject({ state: "running", pid: 88 });

    rpc.status = async () => status("keep", false);
    await controller.refreshServerStatus("keep");
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("stopped");
  });

  test("authoritative transition immediately clears old status pending and error state", async () => {
    const old = deferred<ServerStatus>();
    const rpc = fakeRpc([manifest("keep", { installed: true })]);
    let calls = 0;
    rpc.status = async () => {
      calls += 1;
      if (calls === 1) throw new Error("previous failure");
      if (calls === 2) return old.promise;
      return status("keep", true);
    };
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "status-transition-clear", directory });
    await controller.refreshServerStatus("keep");
    expect(controller.getSnapshot().statusErrors.keep).toBe("previous failure");
    const first = controller.refreshServerStatus("keep");
    await Promise.resolve();
    await controller.recordStopped("keep", controller.captureOperationScope()!);
    expect(controller.getSnapshot().pendingStatus.has("keep")).toBe(false);
    expect(controller.getSnapshot().statusErrors.keep).toBeUndefined();
    await controller.refreshServerStatus("keep");
    old.resolve(status("keep", false));
    await first;
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("running");
    expect(controller.getSnapshot().pendingStatus.has("keep")).toBe(false);
  });

  test("source change discards old status response and error without clearing current pending state", async () => {
    const oldResponse = deferred<ServerStatus>();
    const oldError = deferred<ServerStatus>();
    const fresh = deferred<ServerStatus>();
    const rpc = fakeRpc([manifest("keep", { installed: true }), manifest("error", { installed: true })]);
    const seen: Record<string, number> = {};
    rpc.status = async (_directory, id) => {
      seen[id] = (seen[id] ?? 0) + 1;
      if (id === "keep") return seen[id] === 1 ? oldResponse.promise : fresh.promise;
      return oldError.promise;
    };
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "status-source-a", directory });
    const oldResponseRefresh = controller.refreshServerStatus("keep");
    const oldErrorRefresh = controller.refreshServerStatus("error");
    await Promise.resolve();
    await controller.start({ sessionKey: "status-source-b", directory: "/other" });
    const newSourceCache = controller.getSnapshot().cache;
    const newRefresh = controller.refreshServerStatus("keep");
    await Promise.resolve();
    oldResponse.resolve(status("keep", true));
    oldError.reject(new Error("old source failure"));
    await Promise.all([oldResponseRefresh, oldErrorRefresh]);
    expect(controller.getSnapshot().pendingStatus.has("keep")).toBe(true);
    expect(controller.getSnapshot().statusErrors.error).toBeUndefined();
    expect(controller.getSnapshot().cache).toEqual(newSourceCache);
    fresh.resolve(status("keep", true));
    await newRefresh;
    expect(controller.getSnapshot().statusErrors.error).toBeUndefined();
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("running");
  });

  test("only the newest overlapping status request can update response, error, or pending state", async () => {
    const older = deferred<ServerStatus>();
    const newer = deferred<ServerStatus>();
    const rpc = fakeRpc([manifest("keep", { installed: true })]);
    let requests = 0;
    rpc.status = async () => (++requests === 1 ? older.promise : newer.promise);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "overlapping-status", directory });
    const first = controller.refreshServerStatus("keep");
    const second = controller.refreshServerStatus("keep");
    await Promise.resolve();
    expect(requests).toBe(2);
    newer.resolve(status("keep", true));
    await second;
    expect(controller.getSnapshot().pendingStatus.has("keep")).toBe(false);
    older.resolve(status("keep", false));
    await first;
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("running");
    expect(controller.getSnapshot().statusErrors.keep).toBeUndefined();
  });

  test("concurrent cache changes are persisted in order and creation is cached", async () => {
    const rpc = fakeRpc([]);
    const writes: ServerStatusCacheV1[] = [];
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => (releaseFirst = resolve));
    let writeCount = 0;
    const controller = createServerController(rpc, { now: () => 30 });
    await controller.start({ sessionKey: "session-d", directory });
    rpc.writeCache = async (next) => {
      writes.push(next);
      writeCount += 1;
      if (writeCount === 1) await firstWrite;
      rpc.cache = next;
    };
    writes.length = 0;

    const first = controller.recordCreated(manifest("first"));
    const second = controller.recordCreated(manifest("second"));
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes).toHaveLength(2);
    expect(Object.keys(writes[1].scopes.local.servers)).toEqual(["first", "second"]);
  });

  test("cache write failure does not reject creation or prevent later writes", async () => {
    const rpc = fakeRpc([]);
    const writes: ServerStatusCacheV1[] = [];
    let shouldFail = true;
    const controller = createServerController(rpc, { now: () => 40 });
    await controller.start({ sessionKey: "cache-failure-create", directory });
    rpc.writeCache = async (next) => {
      writes.push(next);
      if (shouldFail) {
        shouldFail = false;
        throw new Error("disk unavailable");
      }
      rpc.cache = next;
    };

    await expect(controller.recordCreated(manifest("created"))).resolves.toBeUndefined();
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toContain("created");
    expect(controller.getSnapshot().cache.scopes.local.servers.created.state).toBe("created");

    await expect(controller.recordCreated(manifest("later"))).resolves.toBeUndefined();
    expect(writes).toHaveLength(2);
    expect(Object.keys(writes[1].scopes.local.servers)).toContain("later");
  });

  test("cache write failure does not become a status error or undo the result", async () => {
    const rpc = fakeRpc([manifest("keep", { installed: true })]);
    const controller = createServerController(rpc, { now: () => 50 });
    await controller.start({ sessionKey: "cache-failure-status", directory });
    rpc.writeCache = async () => { throw new Error("disk unavailable"); };

    await expect(controller.refreshServerStatus("keep")).resolves.toBeUndefined();
    expect(controller.getSnapshot().cache.scopes.local.servers.keep.state).toBe("running");
    expect(controller.getSnapshot().statusErrors.keep).toBeUndefined();
  });

  test("cache write failure does not turn a successful list refresh into an error", async () => {
    const rpc = fakeRpc([manifest("listed")]);
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "cache-failure-list", directory });
    rpc.writeCache = async () => { throw new Error("disk unavailable"); };

    await expect(controller.refreshList()).resolves.toBeUndefined();
    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toEqual(["listed"]);
    expect(controller.getSnapshot().listError).toBeNull();
  });

  test("lifecycle transition methods persist manifest and exact process state", async () => {
    const rpc = fakeRpc([manifest("alpha")]);
    const controller = createServerController(rpc, { now: () => 50 });
    await controller.start({ sessionKey: "transition-session", directory });
    const scope = controller.captureOperationScope()!;
    await controller.recordInstalled(manifest("alpha", { installed: true, accept_eula: true }), scope);
    expect(controller.getSnapshot().manifests[0].installed).toBe(true);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha).toMatchObject({ state: "stopped", pid: null, checked_at_ms: 50 });
    const startedScope = controller.captureOperationScope()!;
    await controller.recordStarted("alpha", { stage: "server.start", id: "alpha", running: true, pid: 17, supervisor_pid: 16, java_path: "/java", started_at_ms: 42 }, startedScope);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha).toMatchObject({ state: "running", pid: 17, supervisor_pid: 16, java_path: "/java", started_at_ms: 42 });
    await controller.recordStopped("alpha", controller.captureOperationScope()!);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha).toMatchObject({ state: "stopped", pid: null, java_path: null });
    await controller.recordDeleted("alpha", controller.captureOperationScope()!);
    expect(controller.getSnapshot().manifests).toEqual([]);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha).toBeUndefined();
  });

  test("lifecycle error uses stable code inference and old scope cannot update new source", async () => {
    const rpc = fakeRpc([manifest("alpha")]);
    const controller = createServerController(rpc, { now: () => 60 });
    await controller.start({ sessionKey: "scope-a", directory });
    const old = controller.captureOperationScope()!;
    await controller.recordLifecycleError("alpha", "SERVER_ALREADY_RUNNING", old);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha).toMatchObject({ state: "running", pid: null });
    await controller.start({ sessionKey: "scope-b", directory: "/other" });
    const newCache = controller.getSnapshot().cache;
    expect(await controller.recordDeleted("alpha", old)).toBe(false);
    expect(controller.getSnapshot().cache).toEqual(newCache);
  });

  test("transition cache write failure is advisory", async () => {
    const rpc = fakeRpc([manifest("alpha")]);
    rpc.writeCache = async () => { throw new Error("disk unavailable"); };
    const controller = createServerController(rpc, { now: () => 70 });
    await controller.start({ sessionKey: "write-failure-transition", directory });
    const scope = controller.captureOperationScope()!;
    await expect(controller.recordStopped("alpha", scope)).resolves.toBe(true);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha.state).toBe("stopped");
  });

  test("independent server transitions share a source revision", async () => {
    const rpc = fakeRpc([manifest("alpha"), manifest("beta")]);
    const controller = createServerController(rpc, { now: () => 80 });
    await controller.start({ sessionKey: "parallel-transitions", directory });
    const scope = controller.captureOperationScope()!;
    const result = (id: string, pid: number) => ({ stage: "server.start" as const, id, running: true as const, pid, supervisor_pid: pid + 1, java_path: "/java", started_at_ms: 70 });
    const outcomes = await Promise.all([controller.recordStarted("alpha", result("alpha", 10), scope), controller.recordStarted("beta", result("beta", 20), scope)]);
    expect(outcomes).toEqual([true, true]);
    expect(controller.getSnapshot().cache.scopes.local.servers.alpha.pid).toBe(10);
    expect(controller.getSnapshot().cache.scopes.local.servers.beta.pid).toBe(20);
  });
});
