import { describe, expect, test } from "bun:test";
import { runEndpointConnectionTest, type EndpointConnectionErrorCode } from "./endpointConnectionTest";
import type { SshEndpoint } from "./endpoints";

const endpoint: SshEndpoint = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  kind: "ssh",
  label: "Remote",
  destination: "secret-user@private-host",
  serversDirectory: "/srv/jmcl/servers",
};

describe("endpoint connection test", () => {
  test("opens one independent session, reads identity, pings once, and closes", async () => {
    const calls: string[] = [];
    const states: string[] = [];
    const state = await runEndpointConnectionTest(endpoint, async () => {
      calls.push("open");
      return {
        core: { name: "jmcl-core", version: "1.2.3", protocol: 1 },
        ping: async () => { calls.push("ping"); return { pong: true }; },
        close: async () => { calls.push("close"); },
      };
    }, { onState: (next) => states.push(next.status) });
    expect(calls).toEqual(["open", "ping", "close"]);
    expect(states).toEqual(["connecting", "connected"]);
    expect(state).toEqual({ status: "connected", core: { name: "jmcl-core", version: "1.2.3" } });
    expect(JSON.stringify(state)).not.toContain("private-host");
  });

  test("maps every safe failure category and closes an acquired session", async () => {
    const cases: Array<[string, EndpointConnectionErrorCode]> = [
      ["SSH_HOST_KEY_UNKNOWN", "unknown-host-key"],
      ["SSH_HOST_KEY_CHANGED", "changed-host-key"],
      ["SSH_AUTH_REQUIRED_OR_FAILED", "auth-required"],
      ["SSH_INTERACTIVE_AUTH_UNSUPPORTED", "interactive-auth-unsupported"],
      ["SSH_TIMEOUT", "timeout"],
      ["UNSUPPORTED_PROTOCOL", "unsupported-protocol"],
      ["SSH_DISCONNECTED", "disconnected"],
      ["anything-else", "failure"],
    ];
    for (const [errorCode, code] of cases) {
      let closes = 0;
      const state = await runEndpointConnectionTest(endpoint, async () => ({
        core: { name: "secret destination", version: "raw stderr", protocol: 1 },
        ping: async () => { throw { code: errorCode, message: "secret-user@private-host raw stderr" }; },
        close: async () => { closes++; },
      }));
      expect(state).toEqual({ status: "error", code });
      expect(closes).toBe(1);
      expect(JSON.stringify(state)).not.toMatch(/private-host|secret-user|stderr/);
    }
  });

  test("maps production SSH authentication and disconnect codes", async () => {
    const auth = await runEndpointConnectionTest(endpoint, async () => {
      throw { kind: "transport", code: "SSH_AUTH_REQUIRED_OR_FAILED" };
    });
    expect(auth).toEqual({ status: "error", code: "auth-required" });

    let closes = 0;
    const disconnected = await runEndpointConnectionTest(endpoint, async () => ({
      core: { name: "core", version: "1", protocol: 1 },
      ping: async () => { throw { kind: "transport", code: "SSH_DISCONNECTED" }; },
      close: async () => { closes++; },
    }));
    expect(disconnected).toEqual({ status: "error", code: "disconnected" });
    expect(closes).toBe(1);
  });

  test("never lists servers or touches cache", async () => {
    const calls: string[] = [];
    await runEndpointConnectionTest(endpoint, async () => ({
      core: { name: "core", version: "1", protocol: 1 },
      ping: async () => { calls.push("ping"); return { pong: true }; },
      close: async () => { calls.push("close"); },
    }));
    expect(calls).toEqual(["ping", "close"]);
  });

  test("cancellation during ping resolves safely and still closes the session", async () => {
    const controller = new AbortController();
    let closes = 0;
    const state = await runEndpointConnectionTest(endpoint, async () => ({
      core: { name: "core", version: "1", protocol: 1 },
      ping: () => { controller.abort(); return new Promise(() => {}); },
      close: async () => { closes++; },
    }), { signal: controller.signal });
    expect(state).toEqual({ status: "error", code: "disconnected" });
    expect(closes).toBe(1);
  });
});
