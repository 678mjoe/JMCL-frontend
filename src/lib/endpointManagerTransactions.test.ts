import { describe, expect, test } from "bun:test";
import { canonicalEndpointConfig } from "./endpoints";
import { deleteEndpointTransaction, EndpointMutationQueue, saveEndpointTransaction } from "./endpointManagerTransactions";
import { createEmptyServerStatusCache, reduceServerCreated } from "./serverStatusCache";

const id = "123e4567-e89b-42d3-a456-426614174000";
const config = {
  version: 1 as const,
  endpoints: [
    ...canonicalEndpointConfig().endpoints,
    { id, kind: "ssh" as const, label: "Remote", destination: "user@host", serversDirectory: "/srv" },
  ],
};

describe("endpoint deletion transaction", () => {
  test("persists config first, selects Local, invalidates and drains, closes sessions, then removes only latest endpoint scope", async () => {
    const calls: string[] = [];
    let stored = config;
    let cache = reduceServerCreated(
      reduceServerCreated(createEmptyServerStatusCache(), "local", "/local", "local-server", 1),
      "unrelated", "/unrelated", "other-server", 1,
    );
    const result = await deleteEndpointTransaction({
      repository: { read: async () => stored, write: async (next) => { calls.push("config-write"); stored = next; } },
      endpointId: id,
      selectedEndpointId: id,
      persistSelectedEndpointId: (next) => { calls.push(`select:${next}`); },
      publishConfig: () => { calls.push("publish"); },
      prepareEndpointDeletion: async (endpointId) => {
        expect(endpointId).toBe(id);
        calls.push("barrier");
        cache = reduceServerCreated(cache, id, "/remote", "late-latest", 2);
      },
      closeEndpointSessions: async () => { calls.push("close-sessions"); },
      cleanupEndpointCache: async (endpointId) => {
        calls.push("cache-cleanup");
        expect(endpointId).toBe(id);
        cache = { ...cache, scopes: Object.fromEntries(Object.entries(cache.scopes).filter(([key]) => key !== id)) };
      },
    });
    expect(result).toEqual({ deleted: true, cleanupComplete: true });
    expect(calls).toEqual(["config-write", "select:local", "publish", "barrier", "close-sessions", "cache-cleanup"]);
    expect(stored.endpoints.map((endpoint) => endpoint.id)).toEqual(["local"]);
    expect(cache.scopes.local.servers["local-server"]).toBeDefined();
    expect(cache.scopes.unrelated.servers["other-server"]).toBeDefined();
    expect(cache.scopes[id]).toBeUndefined();
  });

  test("config write failure leaves selection, context, sessions, and cache untouched", async () => {
    const calls: string[] = [];
    await expect(deleteEndpointTransaction({
      repository: { read: async () => config, write: async () => { calls.push("config-write"); throw new Error("disk"); } },
      endpointId: id,
      selectedEndpointId: id,
      persistSelectedEndpointId: () => { calls.push("select"); },
      publishConfig: () => { calls.push("publish"); },
      prepareEndpointDeletion: async () => { calls.push("barrier"); },
      closeEndpointSessions: async () => { calls.push("close"); },
      cleanupEndpointCache: async () => { calls.push("cache-cleanup"); },
    })).resolves.toEqual({ deleted: false, cleanupComplete: false });
    expect(calls).toEqual(["config-write"]);
  });

  test("cleanup failures report partial cleanup after config deletion without restoring the endpoint", async () => {
    const calls: string[] = [];
    let stored = config;
    const result = await deleteEndpointTransaction({
      repository: { read: async () => stored, write: async (next) => { stored = next; calls.push("config-write"); } },
      endpointId: id,
      selectedEndpointId: "local",
      persistSelectedEndpointId: () => { calls.push("select"); },
      publishConfig: () => { calls.push("publish"); },
      prepareEndpointDeletion: async () => { calls.push("barrier"); },
      closeEndpointSessions: async () => { calls.push("close"); throw new Error("close"); },
      cleanupEndpointCache: async () => { calls.push("cache-cleanup"); throw new Error("read"); },
    });
    expect(result).toEqual({ deleted: true, cleanupComplete: false });
    expect(stored.endpoints.map((endpoint) => endpoint.id)).toEqual(["local"]);
    expect(calls).toEqual(["config-write", "publish", "barrier", "close", "cache-cleanup"]);
  });
});

describe("endpoint mutation queue", () => {
  test("two queued mutations read the latest repository config instead of overwriting each other", async () => {
    let stored = canonicalEndpointConfig();
    let releaseFirst!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let writes = 0;
    const repository = {
      read: async () => stored,
      write: async (next: typeof stored) => {
        if (writes++ === 0) await firstWriteGate;
        stored = next;
      },
    };
    const queue = new EndpointMutationQueue();
    const add = (newId: string, label: string) => queue.run(() => saveEndpointTransaction({
      repository,
      endpointId: null,
      draft: { label, destination: `${label.toLowerCase()}@host` },
      randomUUID: () => newId,
    }));
    const first = add(id, "First");
    const second = add("223e4567-e89b-42d3-a456-426614174001", "Second");
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);
    expect(stored.endpoints.map((endpoint) => endpoint.id)).toEqual(["local", id, "223e4567-e89b-42d3-a456-426614174001"]);
    expect(writes).toBe(2);
  });
});
