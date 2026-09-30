import { canonicalEndpointConfig, validateEndpointConfig, type EndpointConfigV1 } from "./endpoints";
import type { CoreIdentity, SessionInfo } from "./types";
import { createServerMockState, dispatchServerMockRequest, type ServerMockScenario } from "./serverMock";

export const ENDPOINT_MOCK_SCENARIOS = [
  "ssh-host-key-unknown", "ssh-host-key-changed", "ssh-auth-required",
  "ssh-timeout", "ssh-bad-protocol", "ssh-disconnect",
] as const;
export type EndpointMockScenario = "default" | "empty" | "errors" | typeof ENDPOINT_MOCK_SCENARIOS[number];
export const MOCK_SSH_ENDPOINT_ID = "123e4567-e89b-42d3-a456-426614174000";
const successfulIdentity: CoreIdentity = { name: "jmcl-core", version: "0.1.0-mock", protocol: 1 };
const sessions = new Set<number>();
let nextSessionId = 1000;
let activeScenario: EndpointMockScenario = readEndpointMockScenario();
let config: EndpointConfigV1 = configFor(activeScenario);
let serverState = createServerMockState((activeScenario === "empty" || activeScenario === "errors" ? activeScenario : "default") as ServerMockScenario, "/srv/jmcl/servers");
let requestCounts = { list: 0, status: 0 };

export function readEndpointMockScenario(): EndpointMockScenario {
  const globals = globalThis as typeof globalThis & { location?: Location };
  const query = globals.location?.search ? new URLSearchParams(globals.location.search).get("jmclMockScenario") : null;
  const configured = query ?? import.meta.env?.VITE_JMCL_MOCK_SCENARIO;
  if (configured === "empty" || configured === "errors" || ENDPOINT_MOCK_SCENARIOS.includes(configured as never)) return configured as EndpointMockScenario;
  return "default";
}

function configFor(scenario: EndpointMockScenario): EndpointConfigV1 {
  if (!scenario.startsWith("ssh-")) return canonicalEndpointConfig();
  return validateEndpointConfig({
    version: 1,
    endpoints: [
      { id: "local", kind: "local", label: "Local" },
      { id: MOCK_SSH_ENDPOINT_ID, kind: "ssh", label: "Mock SSH", destination: "mock-user@mock-host", serversDirectory: "/srv/jmcl/servers" },
    ],
  });
}

export function resetEndpointMock(scenario: EndpointMockScenario = "default"): void {
  activeScenario = scenario;
  config = configFor(scenario);
  sessions.clear();
  nextSessionId = 1000;
  serverState = createServerMockState((scenario === "empty" || scenario === "errors" ? scenario : "default") as ServerMockScenario, "/srv/jmcl/servers");
  requestCounts = { list: 0, status: 0 };
}
export function endpointMockConfig(): EndpointConfigV1 { return structuredClone(config); }
export function writeEndpointMockConfig(next: EndpointConfigV1): void { config = validateEndpointConfig(next); }
export function activeEndpointMockScenario(): EndpointMockScenario { return activeScenario; }
export function endpointMockOpenSessionCount(): number { return sessions.size; }
export function endpointMockRequestCounts(): Readonly<{ list: number; status: number }> { return { ...requestCounts }; }

function error(code: string, message: string): never { throw { kind: "transport", code, message }; }

export async function openEndpointMockSession(_endpointId: string): Promise<SessionInfo> {
  switch (activeScenario) {
    case "ssh-host-key-unknown": error("SSH_HOST_KEY_UNKNOWN", "SSH host key is not trusted");
    case "ssh-host-key-changed": error("SSH_HOST_KEY_CHANGED", "SSH host key changed");
    case "ssh-auth-required": error("SSH_AUTH_REQUIRED_OR_FAILED", "SSH authentication is required");
    case "ssh-timeout": error("SSH_TIMEOUT", "SSH connection timed out");
    case "ssh-bad-protocol": return { session_id: nextSessionId++, core: { ...successfulIdentity, protocol: 2 } };
    default: {
      const session_id = nextSessionId++;
      sessions.add(session_id);
      return { session_id, core: { ...successfulIdentity } };
    }
  }
}

export async function endpointMockRequest<T>(sessionId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!sessions.has(sessionId)) error("SSH_DISCONNECTED", "Endpoint session is closed");
  if ((method === "ping" || method === "server.list" || method === "server.status") && activeScenario === "ssh-disconnect") error("SSH_DISCONNECTED", "Endpoint disconnected");
  if (method === "ping") return { pong: true } as T;
  if (method === "server.list" || method === "server.status") {
    if (method === "server.list") requestCounts.list += 1;
    else requestCounts.status += 1;
    return dispatchServerMockRequest<T>(serverState, method, params);
  }
  error("ENDPOINT_MOCK_METHOD_UNSUPPORTED", "Endpoint mock method is unsupported");
}

export async function closeEndpointMockSession(sessionId: number): Promise<void> { sessions.delete(sessionId); }
