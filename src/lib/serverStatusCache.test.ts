import { describe, expect, test } from "bun:test";
import {
  readServerStatusCache,
  writeServerStatusCache,
} from "./native";
import { resetMockServerStatusCache } from "./mockTransport";
import {
  createEmptyServerStatusCache,
  reconcileServerManifest,
  reduceServerCreated,
  reduceServerDeleted,
  reduceServerInstalled,
  reduceServerLifecycleError,
  reduceServerStarted,
  reduceServerStatus,
  reduceServerStopped,
  type ServerStatusCacheV1,
} from "./serverStatusCache";

describe("server status cache reducers", () => {
  test("creates a server entry without mutating the input cache", () => {
    const cache = createEmptyServerStatusCache();

    const next = reduceServerCreated(
      cache,
      "local",
      "/mock/jmcl/servers",
      "alpha",
      1_700_000_000_000,
    );

    expect(cache).toEqual<ServerStatusCacheV1>({
      schema_version: 1,
      scopes: {},
    });
    expect(next.scopes.local.servers.alpha).toMatchObject({
      state: "created",
      checked_at_ms: 1_700_000_000_000,
    });
  });

  test("reconciles deleted manifest ids without inventing new status", () => {
    const cache = reduceServerCreated(
      reduceServerCreated(
        createEmptyServerStatusCache(),
        "local",
        "/servers",
        "keep",
        10,
      ),
      "local",
      "/servers",
      "delete",
      10,
    );

    const next = reconcileServerManifest(cache, "local", "/servers", ["keep", "new"], 20);

    expect(Object.keys(next.scopes.local.servers)).toEqual(["keep"]);
    expect(next.scopes.local.servers.delete).toBeUndefined();
    expect(next.scopes.local.servers.new).toBeUndefined();
    expect(cache.scopes.local.servers.delete).toBeDefined();
  });

  test("resets a reused scope key when its directory changes", () => {
    const cache = reduceServerCreated(
      reduceServerCreated(
        createEmptyServerStatusCache(),
        "local",
        "/old/root",
        "same-id",
        10,
      ),
      "remote",
      "/remote/root",
      "other-id",
      11,
    );

    const next = reduceServerInstalled(cache, "local", "/new/root", "new-id", 12);

    expect(next.scopes.local).toEqual({
      directory: "/new/root",
      servers: {
        "new-id": expect.objectContaining({ state: "stopped" }),
      },
    });
    expect(next.scopes.remote).toEqual(cache.scopes.remote);
    expect(next.scopes.local.servers["same-id"]).toBeUndefined();
  });

  test("records install, start/restart, stop, status, and delete transitions", () => {
    const started = {
      pid: 42,
      supervisor_pid: 7,
      java_path: "/java/bin/java",
      started_at_ms: 100,
    };
    const created = reduceServerCreated(createEmptyServerStatusCache(), "local", "/servers", "alpha", 1);
    const installed = reduceServerInstalled(created, "local", "/servers", "alpha", 2);
    const running = reduceServerStarted(installed, "local", "/servers", "alpha", started, 3);
    expect(running.scopes.local.servers.alpha).toEqual({
      state: "running",
      ...started,
      checked_at_ms: 3,
      last_stale_cleanup_at_ms: null,
    });

    const stopped = reduceServerStopped(running, "local", "/servers", "alpha", 4);
    expect(stopped.scopes.local.servers.alpha).toEqual({
      state: "stopped",
      pid: null,
      supervisor_pid: null,
      java_path: null,
      started_at_ms: null,
      checked_at_ms: 4,
      last_stale_cleanup_at_ms: null,
    });

    const refreshed = reduceServerStatus(
      stopped,
      "local",
      "/servers",
      "alpha",
      { running: true, stale_state: true, ...started },
      5,
    );
    expect(refreshed.scopes.local.servers.alpha).toEqual({
      state: "unknown",
      pid: null,
      supervisor_pid: null,
      java_path: null,
      started_at_ms: null,
      checked_at_ms: 5,
      last_stale_cleanup_at_ms: 5,
    });
    const stoppedAfterRefresh = reduceServerStatus(
      refreshed,
      "local",
      "/servers",
      "alpha",
      { running: false, stale_state: true },
      6,
    );
    expect(stoppedAfterRefresh.scopes.local.servers.alpha).toMatchObject({
      state: "stopped",
      pid: null,
      last_stale_cleanup_at_ms: 6,
      checked_at_ms: 6,
    });

    const deleted = reduceServerDeleted(stoppedAfterRefresh, "local", "/servers", "alpha", 7);
    expect(deleted.scopes.local.servers.alpha).toBeUndefined();
  });

  test("preserves stale-cleanup history across non-stale and lifecycle reductions", () => {
    const started = {
      pid: 42,
      supervisor_pid: 7,
      java_path: "/java/bin/java",
      started_at_ms: 100,
    };
    const stale = reduceServerStatus(
      reduceServerCreated(createEmptyServerStatusCache(), "local", "/servers", "alpha", 1),
      "local",
      "/servers",
      "alpha",
      { running: false, stale_state: true },
      2,
    );

    const nonStale = reduceServerStatus(
      stale,
      "local",
      "/servers",
      "alpha",
      { running: true, stale_state: false, ...started },
      3,
    );
    const restarted = reduceServerStarted(nonStale, "local", "/servers", "alpha", started, 4);
    const stopped = reduceServerStopped(restarted, "local", "/servers", "alpha", 5);
    const stableError = reduceServerLifecycleError(
      stopped,
      "local",
      "/servers",
      "alpha",
      "SERVER_NOT_RUNNING",
      6,
    );
    const uncertain = reduceServerLifecycleError(
      stableError,
      "local",
      "/servers",
      "alpha",
      "TRANSPORT_LOST",
      7,
    );

    expect(nonStale.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(2);
    expect(restarted.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(2);
    expect(stopped.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(2);
    expect(stableError.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(2);
    expect(uncertain.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(2);

    const staleAgain = reduceServerStatus(
      uncertain,
      "local",
      "/servers",
      "alpha",
      { running: false, stale_state: true },
      8,
    );
    expect(staleAgain.scopes.local.servers.alpha.last_stale_cleanup_at_ms).toBe(8);
  });

  test("infers only stable lifecycle errors and preserves other scopes", () => {
    const otherScope = reduceServerCreated(createEmptyServerStatusCache(), "remote", "/remote", "other", 1);
    const alreadyRunning = reduceServerLifecycleError(
      otherScope,
      "local",
      "/servers",
      "alpha",
      "SERVER_ALREADY_RUNNING",
      2,
    );
    expect(alreadyRunning.scopes.local.servers.alpha).toMatchObject({
      state: "running",
      pid: null,
      supervisor_pid: null,
      java_path: null,
      started_at_ms: null,
    });
    expect(alreadyRunning.scopes.remote.servers.other).toBeDefined();

    const notRunning = reduceServerLifecycleError(
      alreadyRunning,
      "local",
      "/servers",
      "alpha",
      "SERVER_NOT_RUNNING",
      3,
    );
    expect(notRunning.scopes.local.servers.alpha.state).toBe("stopped");

    const uncertain = reduceServerLifecycleError(
      notRunning,
      "local",
      "/servers",
      "alpha",
      "TRANSPORT_LOST",
      4,
    );
    expect(uncertain.scopes.local.servers.alpha.state).toBe("unknown");
    expect(notRunning.scopes.local.servers.alpha.state).toBe("stopped");
  });

  test("mock native persistence is isolated and deep-cloned", async () => {
    resetMockServerStatusCache();
    const cache = reduceServerCreated(createEmptyServerStatusCache(), "local", "/servers", "alpha", 9);
    await writeServerStatusCache(cache);
    cache.scopes.local.servers.alpha.state = "unknown";

    const firstRead = await readServerStatusCache();
    expect(firstRead.scopes.local.servers.alpha.state).toBe("created");
    firstRead.scopes.local.servers.alpha.state = "running";
    expect((await readServerStatusCache()).scopes.local.servers.alpha.state).toBe("created");
  });
});
