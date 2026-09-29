import { afterEach, describe, expect, test } from "bun:test";
import { CoreSession, launchExecuteParams } from "./rpc";
import { ENDPOINT_MOCK_SCENARIOS, MOCK_SSH_ENDPOINT_ID, endpointMockConfig, endpointMockOpenSessionCount, resetEndpointMock } from "./endpointMock";
import { runEndpointConnectionTest } from "./endpointConnectionTest";

describe("launch.execute wire params", () => {
  test("keeps instance, loader, Java, and source fields at the top level", () => {
    const auth = {
      player_name: "Player",
      uuid: "0123456789abcdef0123456789abcdef",
      access_token: "offline",
    };
    const params = launchExecuteParams("1.21.1", "/instances/fabric/.minecraft", auth, {
      source: "bmclapi",
      store_directory: "/store",
      fabric_loader: "0.16.10",
      java_override: "/java/bin/java",
      options: { resolution_width: 1280, resolution_height: 720 },
    });

    expect(params).toEqual({
      id: "1.21.1",
      directory: "/instances/fabric/.minecraft",
      auth,
      source: "bmclapi",
      store_directory: "/store",
      fabric_loader: "0.16.10",
      java_override: "/java/bin/java",
      options: { resolution_width: 1280, resolution_height: 720 },
    });
    expect(params.options).not.toMatchObject({
      source: expect.anything(),
      store_directory: expect.anything(),
      fabric_loader: expect.anything(),
      java_override: expect.anything(),
    });
  });
});

describe("endpoint session factories", () => {
  afterEach(() => CoreSession.setOpenExecutorForTesting(null));

  test("launcher and local endpoint retain the local core_open command", async () => {
    const opened: Array<[string, Record<string, unknown>]> = [];
    CoreSession.setOpenExecutorForTesting(async (command, args) => {
      opened.push([command, args]);
      return { session_id: opened.length, core: { name: "test", version: "1", protocol: 1 } };
    });
    await CoreSession.open();
    await CoreSession.openEndpoint({ id: "local", kind: "local", label: "Local" });
    expect(opened).toEqual([
      ["core_open", { binaryPath: null }],
      ["core_open", { binaryPath: null }],
    ]);
  });

  test("SSH endpoint sends only endpoint ID and every factory call gets an independent session", async () => {
    const opened: Array<[string, Record<string, unknown>]> = [];
    CoreSession.setOpenExecutorForTesting(async (command, args) => {
      opened.push([command, args]);
      return { session_id: opened.length, core: { name: "test", version: "1", protocol: 1 } };
    });
    const endpoint = { id: "123e4567-e89b-42d3-a456-426614174000", kind: "ssh" as const, label: "Remote", destination: "user@host", serversDirectory: "/srv" };
    const control = await CoreSession.openEndpoint(endpoint);
    const operation = await CoreSession.openSshEndpoint(endpoint.id);
    const log = await CoreSession.openSshEndpoint(endpoint.id);
    expect(opened).toEqual([
      ["endpoint_session_open", { endpointId: endpoint.id }],
      ["endpoint_session_open", { endpointId: endpoint.id }],
      ["endpoint_session_open", { endpointId: endpoint.id }],
    ]);
    expect(new Set([control.id, operation.id, log.id]).size).toBe(3);
  });

  test("rejects an SSH open response with an unsupported protocol as a transport error", async () => {
    CoreSession.setOpenExecutorForTesting(async () => ({ session_id: 7, core: { name: "test", version: "2", protocol: 2 } }));
    await expect(CoreSession.openSshEndpoint("ssh-id")).rejects.toMatchObject({ kind: "transport", message: "Unsupported core protocol" });
  });

  test("runs isolated mock SSH connection scenarios with sanitized states and guaranteed close", async () => {
    resetEndpointMock("ssh-host-key-unknown");
    const endpoint = endpointMockConfig().endpoints[1];
    if (!endpoint || endpoint.kind !== "ssh") throw new Error("SSH endpoint fixture missing");
    resetEndpointMock("default");
    const connected = await runEndpointConnectionTest(endpoint);
    expect(connected).toEqual({ status: "connected", core: { name: "jmcl-core", version: "0.1.0-mock" } });
    expect(endpointMockOpenSessionCount()).toBe(0);

    const expected = [
      ["ssh-host-key-unknown", "unknown-host-key"],
      ["ssh-host-key-changed", "changed-host-key"],
      ["ssh-auth-required", "auth-required"],
      ["ssh-timeout", "timeout"],
      ["ssh-bad-protocol", "unsupported-protocol"],
      ["ssh-disconnect", "disconnected"],
    ] as const;
    expect(ENDPOINT_MOCK_SCENARIOS).toHaveLength(expected.length);
    for (const [scenario, code] of expected) {
      resetEndpointMock(scenario);
      const state = await runEndpointConnectionTest(endpoint);
      expect(state).toEqual({ status: "error", code });
      expect(JSON.stringify(state)).not.toContain("mock-user@mock-host");
      expect(endpointMockOpenSessionCount()).toBe(0);
    }
    expect(endpoint.id).toBe(MOCK_SSH_ENDPOINT_ID);
  });
});
