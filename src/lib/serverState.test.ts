import { describe, expect, test } from "bun:test";
import { deriveServerState } from "./serverState";

test("derives an uninstalled server as created", () => {
  const result = deriveServerState({
    manifest: { installed: false },
    status: null,
    hasLogs: false,
    hasProperties: false,
    hasLoaderManifest: false,
  });

  expect(result.state).toBe("created");
  expect(result.capabilities.installRepair).toBe(true);
});

describe("lifecycle state", () => {
  test("derives an installed stopped server", () => {
    expect(
      deriveServerState({
        manifest: { installed: true },
        status: { running: false, stale_state: false },
        hasLogs: false,
        hasProperties: true,
        hasLoaderManifest: false,
      }).state,
    ).toBe("stopped");
  });

  test("derives an installed running server", () => {
    expect(
      deriveServerState({
        manifest: { installed: true },
        status: { running: true, stale_state: false },
        hasLogs: true,
        hasProperties: true,
        hasLoaderManifest: false,
      }).state,
    ).toBe("running");
  });

  test("derives unknown when installed status is unavailable", () => {
    expect(
      deriveServerState({
        manifest: { installed: true },
        status: null,
        hasLogs: false,
        hasProperties: false,
        hasLoaderManifest: false,
      }).state,
    ).toBe("unknown");
  });

  test("normalizes stale cleanup to stopped and preserves the stale flag", () => {
    const result = deriveServerState({
      manifest: { installed: true },
      status: { running: false, stale_state: true },
      hasLogs: true,
      hasProperties: true,
      hasLoaderManifest: false,
    });

    expect(result.state).toBe("stopped");
    expect(result.staleState).toBe(true);
  });

  test("treats an uninstalled running server as contradictory unknown", () => {
    expect(
      deriveServerState({
        manifest: { installed: false },
        status: { running: true, stale_state: false },
        hasLogs: false,
        hasProperties: false,
        hasLoaderManifest: false,
      }).state,
    ).toBe("unknown");
  });

  test("treats stale running status as contradictory unknown", () => {
    expect(
      deriveServerState({
        manifest: { installed: true },
        status: { running: true, stale_state: true },
        hasLogs: true,
        hasProperties: true,
        hasLoaderManifest: false,
      }).state,
    ).toBe("unknown");
  });
});

const capabilities = [
  "inspectStatus",
  "refreshStatus",
  "installRepair",
  "start",
  "stop",
  "restart",
  "logs",
  "consoleCommand",
  "propertiesRead",
  "propertiesWrite",
  "worldMutation",
  "serverModMutation",
  "serverDatapackMutation",
  "delete",
] as const;

describe("capability matrix", () => {
  const inputFor = (state: "created" | "stopped" | "running" | "unknown") => ({
    manifest: { installed: state !== "created" },
    status:
      state === "created" || state === "unknown"
        ? null
        : { running: state === "running", stale_state: false },
    hasLogs: true,
    hasProperties: true,
    hasLoaderManifest: false,
  });

  test.each([
    ["created", ["inspectStatus", "refreshStatus", "installRepair", "propertiesRead", "propertiesWrite", "delete"]],
    ["stopped", ["inspectStatus", "refreshStatus", "installRepair", "start", "logs", "propertiesRead", "propertiesWrite", "worldMutation", "serverModMutation", "serverDatapackMutation", "delete"]],
    ["running", ["inspectStatus", "refreshStatus", "stop", "restart", "logs", "consoleCommand", "propertiesRead"]],
    ["unknown", ["inspectStatus", "refreshStatus"]],
  ] as const)("enables the expected operations for %s", (state, enabled) => {
    const result = deriveServerState(inputFor(state));
    const enabledSet = new Set(enabled);

    for (const capability of capabilities) {
      expect(result.capabilities[capability]).toBe(enabledSet.has(capability));
      expect(result.reasons[capability]).toEqual(enabledSet.has(capability) ? null : expect.any(String));
    }
  });

  test("uses status_unknown for every non-inspection action when status is unknown", () => {
    const result = deriveServerState(inputFor("unknown"));

    expect(result.reasons.inspectStatus).toBeNull();
    expect(result.reasons.refreshStatus).toBeNull();
    for (const capability of capabilities) {
      if (capability !== "inspectStatus" && capability !== "refreshStatus") {
        expect(result.reasons[capability]).toBe("status_unknown");
      }
    }
  });

  test("gates stopped logs on hasLogs", () => {
    const result = deriveServerState({
      manifest: { installed: true },
      status: { running: false, stale_state: false },
      hasLogs: false,
      hasProperties: true,
      hasLoaderManifest: false,
    });

    expect(result.capabilities.logs).toBe(false);
    expect(result.reasons.logs).toBe("logs_unavailable");
  });

  test("gates property reads and writes on hasProperties", () => {
    const result = deriveServerState({
      manifest: { installed: true },
      status: { running: false, stale_state: false },
      hasLogs: true,
      hasProperties: false,
      hasLoaderManifest: false,
    });

    expect(result.capabilities.propertiesRead).toBe(false);
    expect(result.capabilities.propertiesWrite).toBe(false);
    expect(result.reasons.propertiesRead).toBe("properties_unavailable");
    expect(result.reasons.propertiesWrite).toBe("properties_unavailable");
  });

  test("allows created-server mod mutations only when a loader manifest exists", () => {
    const withLoader = deriveServerState({
      manifest: { installed: false },
      status: null,
      hasLogs: false,
      hasProperties: false,
      hasLoaderManifest: true,
    });
    const withoutLoader = deriveServerState({
      manifest: { installed: false },
      status: null,
      hasLogs: false,
      hasProperties: false,
      hasLoaderManifest: false,
    });

    expect(withLoader.capabilities.serverModMutation).toBe(true);
    expect(withLoader.reasons.serverModMutation).toBeNull();
    expect(withoutLoader.capabilities.serverModMutation).toBe(false);
    expect(withoutLoader.reasons.serverModMutation).toBe("loader_required");
  });

  test("requires properties for a running read but never enables writes", () => {
    const withoutProperties = deriveServerState({
      manifest: { installed: true },
      status: { running: true, stale_state: false },
      hasLogs: false,
      hasProperties: false,
      hasLoaderManifest: false,
    });
    const withProperties = deriveServerState({
      manifest: { installed: true },
      status: { running: true, stale_state: false },
      hasLogs: false,
      hasProperties: true,
      hasLoaderManifest: false,
    });

    expect(withoutProperties.reasons.propertiesRead).toBe("properties_unavailable");
    expect(withProperties.capabilities.propertiesRead).toBe(true);
    expect(withProperties.reasons.propertiesWrite).toBe("stopped_only");
  });
});
