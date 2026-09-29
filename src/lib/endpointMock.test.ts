import { describe, expect, test } from "bun:test";
import {
  ENDPOINT_MOCK_SCENARIOS,
  endpointMockConfig,
  resetEndpointMock,
  openEndpointMockSession,
  endpointMockRequest,
  closeEndpointMockSession,
  readEndpointMockScenario,
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

  test("assigns distinct session IDs and disconnects at ping, without exposing endpoint details", async () => {
    resetEndpointMock("ssh-disconnect");
    const first = await openEndpointMockSession("mock-ssh-endpoint");
    const second = await openEndpointMockSession("mock-ssh-endpoint");
    expect(first.session_id).not.toBe(second.session_id);
    await expect(endpointMockRequest(first.session_id, "ping")).rejects.toMatchObject({ code: "SSH_DISCONNECTED" });
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
