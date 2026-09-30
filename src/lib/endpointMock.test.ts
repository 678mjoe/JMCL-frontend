import { describe, expect, test } from "bun:test";
import {
  ENDPOINT_MOCK_SCENARIOS,
  endpointMockConfig,
  resetEndpointMock,
  openEndpointMockSession,
  endpointMockRequest,
  closeEndpointMockSession,
  readEndpointMockScenario,
  endpointMockRequestCounts,
} from "./endpointMock";

describe("isolated SSH endpoint mock", () => {
  test("provides a deterministic validated SSH endpoint for each SSH scenario", () => {
    for (const scenario of ENDPOINT_MOCK_SCENARIOS) {
      resetEndpointMock(scenario);
      expect(endpointMockConfig()).toEqual(endpointMockConfig());
      expect(endpointMockConfig().endpoints[1]).toMatchObject({
        kind: "ssh",
        destination: "mock-user@mock-host",
        serversDirectory: "/srv/jmcl/servers",
      });
    }
  });

  test("recognizes URL-selected endpoint scenarios without changing the generic dispatcher scenario", () => {
    const globals = globalThis as typeof globalThis & { location?: Location };
    const previous = globals.location;
    try {
      for (const scenario of ["default", "empty", "errors", ...ENDPOINT_MOCK_SCENARIOS] as const) {
        Object.defineProperty(globals, "location", { configurable: true, value: { search: `?jmclMockScenario=${scenario}` } });
        expect(readEndpointMockScenario()).toBe(scenario);
      }
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globals, "location");
      else globals.location = previous;
    }
  });

  test("routes only list and explicit status through the isolated server dispatcher", async () => {
    resetEndpointMock("default");
    const session = await openEndpointMockSession("mock-ssh-endpoint");
    const listed = await endpointMockRequest<{ servers: Array<{ id: string }> }>(session.session_id, "server.list", { directory: "/srv/jmcl/servers" });
    expect(listed.servers.length).toBeGreaterThan(0);
    expect(endpointMockRequestCounts()).toEqual({ list: 1, status: 0 });
    await expect(endpointMockRequest(session.session_id, "server.status", { directory: "/srv/jmcl/servers", id: listed.servers[0]?.id })).resolves.toBeDefined();
    expect(endpointMockRequestCounts()).toEqual({ list: 1, status: 1 });
    await expect(endpointMockRequest(session.session_id, "server.create", { directory: "/srv/jmcl/servers" })).rejects.toMatchObject({ code: "ENDPOINT_MOCK_METHOD_UNSUPPORTED" });
    await closeEndpointMockSession(session.session_id);

    resetEndpointMock("empty");
    const emptySession = await openEndpointMockSession("mock-ssh-endpoint");
    await expect(endpointMockRequest<{ servers: unknown[] }>(emptySession.session_id, "server.list", { directory: "/srv/jmcl/servers" })).resolves.toMatchObject({ servers: [] });
    await closeEndpointMockSession(emptySession.session_id);
  });

  test("disconnects on server list and explicit status, without exposing endpoint details", async () => {
    resetEndpointMock("ssh-disconnect");
    const first = await openEndpointMockSession("mock-ssh-endpoint");
    const second = await openEndpointMockSession("mock-ssh-endpoint");
    expect(first.session_id).not.toBe(second.session_id);
    await expect(endpointMockRequest(first.session_id, "server.list", { directory: "/srv/jmcl/servers" })).rejects.toMatchObject({ code: "SSH_DISCONNECTED" });
    await expect(endpointMockRequest(first.session_id, "server.status", { directory: "/srv/jmcl/servers", id: "demo" })).rejects.toMatchObject({ code: "SSH_DISCONNECTED" });
    expect(JSON.stringify(first)).not.toContain("mock-user@mock-host");
    await closeEndpointMockSession(first.session_id);
    await closeEndpointMockSession(second.session_id);
  });

  test("rejects bad protocol during open and unknown host keys before session creation", async () => {
    resetEndpointMock("ssh-bad-protocol");
    await expect(openEndpointMockSession("mock-ssh-endpoint")).resolves.toMatchObject({ core: { protocol: 2 } });
    resetEndpointMock("ssh-host-key-unknown");
    await expect(openEndpointMockSession("mock-ssh-endpoint")).rejects.toMatchObject({ code: "SSH_HOST_KEY_UNKNOWN" });
  });

  test("uses the production SSH authentication failure code", async () => {
    resetEndpointMock("ssh-auth-required");
    await expect(openEndpointMockSession("mock-ssh-endpoint")).rejects.toMatchObject({ code: "SSH_AUTH_REQUIRED_OR_FAILED" });
  });
});
