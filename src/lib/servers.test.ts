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
});
