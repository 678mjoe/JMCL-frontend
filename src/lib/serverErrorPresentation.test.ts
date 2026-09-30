import { describe, expect, test } from "bun:test";
import { translate } from "./i18n";
import { safeServerErrorKey, safeServerOperationError } from "./serverErrorPresentation";

describe("server error presentation", () => {
  test("keeps local operation detail but hides remote diagnostics", () => {
    const raw = "SSH_DISCONNECTED: user@PRIVATE_HOST --password=PRIVATE_SECRET";
    const t = (key: Parameters<typeof translate>[1]) => translate("zh", key);
    expect(safeServerOperationError(raw, "local", t)).toBe(raw);
    expect(safeServerOperationError(raw, "ssh-remote", t)).toBe("连接已断开");
    expect(safeServerOperationError("PRIVATE_HOST", "ssh-remote", t)).toBe("服务器操作失败");
  });

  test("maps production transport codes to fixed categories and unknown errors to context-safe fallbacks", () => {
    const categories = [
      ["SSH_HOST_KEY_UNKNOWN", "endpoint.testUnknownHostKey"],
      ["SSH_HOST_KEY_CHANGED", "endpoint.testChangedHostKey"],
      ["SSH_AUTH_REQUIRED_OR_FAILED", "endpoint.testAuthRequired"],
      ["SSH_INTERACTIVE_AUTH_UNSUPPORTED", "endpoint.testInteractiveAuthUnsupported"],
      ["SSH_TIMEOUT", "endpoint.testTimeout"],
      ["UNSUPPORTED_PROTOCOL", "endpoint.testUnsupportedProtocol"],
      ["SSH_DISCONNECTED", "endpoint.testDisconnected"],
    ] as const;
    for (const [code, key] of categories) {
      expect(safeServerErrorKey(`${code}: PRIVATE_HOST --token=secret`, "servers.operationFailed")).toBe(key);
    }
    expect(safeServerErrorKey("PRIVATE_HOST --token=secret", "servers.listError")).toBe("servers.listError");
    expect(safeServerOperationError("PRIVATE_HOST --token=secret", "ssh-remote", (key) => key)).toBe("servers.operationFailed");
    expect(safeServerOperationError("detail: /safe/local/path", "local", (key) => key)).toBe("detail: /safe/local/path");
  });
});
