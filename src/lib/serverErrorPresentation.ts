import type { MessageKey } from "./i18n";

/** Convert only recognized transport codes to fixed copy; never render raw SSH diagnostics. */
export function safeServerErrorKey(error: string | null | undefined, fallback: MessageKey): MessageKey {
  const code = error?.match(/^([A-Z][A-Z0-9_]+):/)?.[1];
  const categories: Record<string, MessageKey> = {
    SSH_HOST_KEY_UNKNOWN: "endpoint.testUnknownHostKey",
    SSH_HOST_KEY_CHANGED: "endpoint.testChangedHostKey",
    SSH_AUTH_REQUIRED_OR_FAILED: "endpoint.testAuthRequired",
    SSH_INTERACTIVE_AUTH_UNSUPPORTED: "endpoint.testInteractiveAuthUnsupported",
    SSH_TIMEOUT: "endpoint.testTimeout",
    UNSUPPORTED_PROTOCOL: "endpoint.testUnsupportedProtocol",
    SSH_DISCONNECTED: "endpoint.testDisconnected",
  };
  return (code ? categories[code] : undefined) ?? fallback;
}

export function safeServerOperationError(error: string, endpointId: string, translate: (key: MessageKey) => string): string {
  return endpointId === "local" ? error : translate(safeServerErrorKey(error, "servers.operationFailed"));
}
