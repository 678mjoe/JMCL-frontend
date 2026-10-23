import type { MessageKey } from "./i18n";

function stableCode(error: string | null | undefined): string | undefined {
  return error?.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1];
}

/** Convert recognized codes to fixed copy; never render raw SSH diagnostics.
 * Java guidance defaults to the remote host for remote status/list consumers. */
export function safeServerErrorKey(error: string | null | undefined, fallback: MessageKey): MessageKey {
  const code = stableCode(error);
  const categories: Record<string, MessageKey> = {
    JAVA_NOT_FOUND: "servers.javaMissingRemote",
    JAVA_INCOMPATIBLE: "servers.javaIncompatibleRemote",
    EULA_NOT_ACCEPTED: "servers.eulaRequired",
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
  const code = stableCode(error);
  if (code === "EULA_NOT_ACCEPTED") return translate("servers.eulaRequired");
  if (code === "JAVA_NOT_FOUND") return translate(endpointId === "local" ? "servers.javaMissingLocal" : "servers.javaMissingRemote");
  if (code === "JAVA_INCOMPATIBLE") return translate(endpointId === "local" ? "servers.javaIncompatibleLocal" : "servers.javaIncompatibleRemote");
  return endpointId === "local" ? error : translate(safeServerErrorKey(error, "servers.operationFailed"));
}
