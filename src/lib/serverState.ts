/** GUI-facing lifecycle states. The core remains the final authority for every action. */
export type ServerLifecycleState = "created" | "stopped" | "running" | "unknown";

export const SERVER_CAPABILITIES = [
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

export type ServerCapability = (typeof SERVER_CAPABILITIES)[number];

export type ServerCapabilityReason =
  | "status_unknown"
  | "not_installed"
  | "already_running"
  | "not_running"
  | "logs_unavailable"
  | "properties_unavailable"
  | "loader_required"
  | "stopped_only"
  | "running_only";

export interface ServerStateStatus {
  running: boolean;
  stale_state: boolean;
}

export interface ServerStateInput {
  manifest: { installed: boolean };
  /** null or omitted means status has not been obtained, or the refresh failed. */
  status?: ServerStateStatus | null;
  hasLogs: boolean;
  hasProperties: boolean;
  /** Whether server.json selects Fabric, NeoForge, or Forge. */
  hasLoaderManifest: boolean;
}

export type ServerCapabilities = Record<ServerCapability, boolean>;
export type ServerCapabilityReasons = Record<ServerCapability, ServerCapabilityReason | null>;

export interface ServerStateResult {
  state: ServerLifecycleState;
  staleState: boolean;
  capabilities: ServerCapabilities;
  reasons: ServerCapabilityReasons;
}

function emptyCapabilities(): ServerCapabilities {
  return Object.fromEntries(SERVER_CAPABILITIES.map((capability) => [capability, false])) as ServerCapabilities;
}

function enable(capabilities: ServerCapabilities, ...names: ServerCapability[]): void {
  for (const name of names) capabilities[name] = true;
}

function determineState(input: ServerStateInput): { state: ServerLifecycleState; staleState: boolean } {
  const status = input.status;
  const staleState = status?.stale_state ?? false;

  // A live PID claim from an uninstalled manifest, or a stale live claim, is contradictory.
  if (status?.running === true && (input.manifest.installed === false || staleState)) {
    return { state: "unknown", staleState };
  }
  if (input.manifest.installed === false) return { state: "created", staleState };
  if (status == null) return { state: "unknown", staleState };
  return { state: status.running ? "running" : "stopped", staleState };
}

function enabledCapabilities(input: ServerStateInput, state: ServerLifecycleState): ServerCapabilities {
  const capabilities = emptyCapabilities();
  enable(capabilities, "inspectStatus", "refreshStatus");

  switch (state) {
    case "unknown":
      break;
    case "created":
      enable(capabilities, "installRepair", "delete");
      if (input.hasProperties) enable(capabilities, "propertiesRead", "propertiesWrite");
      if (input.hasLoaderManifest) enable(capabilities, "serverModMutation");
      break;
    case "stopped":
      enable(
        capabilities,
        "installRepair",
        "start",
        "worldMutation",
        "serverModMutation",
        "serverDatapackMutation",
        "delete",
      );
      if (input.hasLogs) enable(capabilities, "logs");
      if (input.hasProperties) enable(capabilities, "propertiesRead", "propertiesWrite");
      break;
    case "running":
      enable(capabilities, "stop", "restart", "logs", "consoleCommand");
      if (input.hasProperties) enable(capabilities, "propertiesRead");
      break;
  }

  return capabilities;
}

function disabledReason(
  capability: ServerCapability,
  state: ServerLifecycleState,
  input: ServerStateInput,
): ServerCapabilityReason {
  if (state === "unknown") return "status_unknown";

  if (capability === "propertiesRead" || capability === "propertiesWrite") {
    if (!input.hasProperties) return "properties_unavailable";
    if (state === "running" && capability === "propertiesWrite") return "stopped_only";
  }

  if (capability === "logs" && state === "stopped" && !input.hasLogs) return "logs_unavailable";

  switch (state) {
    case "created":
      if (capability === "logs") return "logs_unavailable";
      if (capability === "serverModMutation" && !input.hasLoaderManifest) return "loader_required";
      if (capability === "start") return "not_installed";
      if (capability === "stop" || capability === "restart") return "not_running";
      if (capability === "consoleCommand") return "running_only";
      if (
        capability === "worldMutation" ||
        capability === "serverDatapackMutation"
      ) {
        return "not_installed";
      }
      return "not_installed";
    case "stopped":
      if (capability === "stop" || capability === "restart" || capability === "consoleCommand") {
        return "running_only";
      }
      return "stopped_only";
    case "running":
      if (capability === "start") return "already_running";
      if (
        capability === "installRepair" ||
        capability === "propertiesWrite" ||
        capability === "worldMutation" ||
        capability === "serverModMutation" ||
        capability === "serverDatapackMutation" ||
        capability === "delete"
      ) {
        return "stopped_only";
      }
      return "not_running";
  }
}

export function deriveServerState(input: ServerStateInput): ServerStateResult {
  const { state, staleState } = determineState(input);
  const capabilities = enabledCapabilities(input, state);
  const reasons = Object.fromEntries(
    SERVER_CAPABILITIES.map((capability) => [
      capability,
      capabilities[capability] ? null : disabledReason(capability, state, input),
    ]),
  ) as ServerCapabilityReasons;

  return { state, staleState, capabilities, reasons };
}
