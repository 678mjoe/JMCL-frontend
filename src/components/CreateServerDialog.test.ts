import { describe, expect, test } from "bun:test";
import { CoreSession } from "@/lib/rpc";
import { createServerController, type ServerControllerRpc } from "@/lib/servers";
import { submitServerCreate, resetLoaderVersionSelection, isLoaderVersionSelectionValid } from "@/lib/serverCreate";
import type { ServerManifest } from "@/lib/types";
import { createEmptyServerStatusCache } from "@/lib/serverStatusCache";

describe("server create submit seam", () => {
  test("game version changes clear stale loader selection while the next catalog loads", () => {
    const reset = resetLoaderVersionSelection("fabric");
    expect(reset).toEqual({ loaderVersion: "", loaderVersions: [], loaderState: "loading" });
    expect(isLoaderVersionSelectionValid("fabric", "0.16.10", ["0.16.10"], "loading")).toBe(false);
    expect(isLoaderVersionSelectionValid("fabric", "0.16.10", ["0.16.10"], "ready")).toBe(true);
    expect(isLoaderVersionSelectionValid("fabric", "old-version", ["new-version"], "ready")).toBe(false);
  });

  test("creates once, caches before routing, and performs no install, status, or extra list", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const created: ServerManifest = {
      id: "my-server", name: "My Server", version_id: "1.21.4", fabric_loader: "0.16.10",
      neoforge_version: null, forge_version: null, source: "bmclapi", accept_eula: false,
      java_path: null, installed: false,
    };
    const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return created as T;
    });
    const events: string[] = [];

    await submitServerCreate({
      session, directory: "/srv/servers", id: "my-server", versionId: "1.21.4",
      name: "My Server", source: "bmclapi", loader: "fabric", loaderVersion: "0.16.10",
      recordCreated: async (server) => { expect(server).toBe(created); events.push("record"); },
      onCreated: (server) => { expect(server).toBe(created); events.push("route"); },
    });

    expect(calls).toEqual([{
      method: "server.create",
      params: {
        directory: "/srv/servers", id: "my-server", version_id: "1.21.4",
        name: "My Server", source: "bmclapi", accept_eula: false, fabric_loader: "0.16.10",
      },
    }]);
    expect(events).toEqual(["record", "route"]);
    expect(calls.filter(({ method }) => method === "server.install" || method === "server.status" || method === "server.list")).toHaveLength(0);
  });

  test("routes after recordCreated when its advisory cache write fails", async () => {
    const server: ServerManifest = {
      id: "created", name: "Created", version_id: "1.21.4", fabric_loader: null,
      neoforge_version: null, forge_version: null, source: "official", accept_eula: false,
      java_path: null, installed: false,
    };
    const rpc: ServerControllerRpc = {
      list: async () => ({ stage: "server.list", servers: [] }),
      status: async () => { throw new Error("unused"); },
      readCache: async () => createEmptyServerStatusCache(),
      writeCache: async () => {},
    };
    const controller = createServerController(rpc);
    await controller.start({ sessionKey: "create-route-cache-error", directory: "/srv/servers" });
    rpc.writeCache = async () => { throw new Error("disk unavailable"); };
    const session = CoreSession.createForTesting(async <T>() => server as T);
    const events: string[] = [];

    await submitServerCreate({
      session, directory: "/srv/servers", id: server.id, versionId: server.version_id,
      name: server.name, source: server.source, loader: "none", loaderVersion: "",
      recordCreated: (created) => controller.recordCreated(created),
      onCreated: () => events.push("route"),
    });

    expect(controller.getSnapshot().manifests.map(({ id }) => id)).toContain("created");
    expect(events).toEqual(["route"]);
  });
});
