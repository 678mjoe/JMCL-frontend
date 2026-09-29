import type { SshEndpoint } from "./endpoints";
import { CoreSession } from "./rpc";

export type EndpointConnectionState =
  | { status: "idle" | "connecting" }
  | { status: "connected"; core: { name: string; version: string } }
  | { status: "error"; code: EndpointConnectionErrorCode };

export type EndpointConnectionErrorCode =
  | "unknown-host-key"
  | "changed-host-key"
  | "auth-required"
  | "interactive-auth-unsupported"
  | "timeout"
  | "unsupported-protocol"
  | "disconnected"
  | "failure";

export const IDLE_ENDPOINT_CONNECTION_STATE: EndpointConnectionState = { status: "idle" };

export type EndpointTestSession = Pick<CoreSession, "core" | "ping" | "close">;
export type EndpointTestOpener = (endpoint: SshEndpoint) => Promise<EndpointTestSession>;

function safeIdentityValue(value: string): string {
  return /^[A-Za-z0-9._+-]{1,80}$/.test(value) ? value : "unknown";
}

function safeCode(error: unknown): EndpointConnectionErrorCode {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  switch (code) {
    case "SSH_HOST_KEY_UNKNOWN": return "unknown-host-key";
    case "SSH_HOST_KEY_CHANGED": return "changed-host-key";
    case "SSH_AUTH_REQUIRED_OR_FAILED": return "auth-required";
    case "SSH_INTERACTIVE_AUTH_UNSUPPORTED": return "interactive-auth-unsupported";
    case "SSH_TIMEOUT": return "timeout";
    case "UNSUPPORTED_PROTOCOL": return "unsupported-protocol";
    case "SSH_DISCONNECTED": return "disconnected";
    default: return "failure";
  }
}

/** Opens one independent endpoint session, handshakes via its identity, pings once, and closes it. */
export async function runEndpointConnectionTest(
  endpoint: SshEndpoint,
  opener: EndpointTestOpener = (value) => CoreSession.openEndpoint(value),
  options: { signal?: AbortSignal; onState?: (state: EndpointConnectionState) => void } = {},
): Promise<EndpointConnectionState> {
  let session: EndpointTestSession | null = null;
  const publish = (state: EndpointConnectionState) => options.onState?.(state);
  publish({ status: "connecting" });
  try {
    if (options.signal?.aborted) throw { code: "SSH_DISCONNECTED" };
    session = await opener(endpoint);
    const core = session.core;
    if (options.signal?.aborted) throw { code: "SSH_DISCONNECTED" };
    if (options.signal) {
      let onAbort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject({ code: "SSH_DISCONNECTED" });
        options.signal!.addEventListener("abort", onAbort, { once: true });
      });
      try { await Promise.race([session.ping(), aborted]); }
      finally { options.signal.removeEventListener("abort", onAbort); }
    } else {
      await session.ping();
    }
    const state = { status: "connected" as const, core: { name: safeIdentityValue(core.name), version: safeIdentityValue(core.version) } };
    publish(state);
    return state;
  } catch (error) {
    const state = { status: "error" as const, code: safeCode(error) };
    publish(state);
    return state;
  } finally {
    if (session) {
      try { await session.close(); } catch { /* safe result excludes close diagnostics */ }
    }
  }
}
