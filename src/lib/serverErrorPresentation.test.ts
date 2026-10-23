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

describe("server lifecycle recovery guidance", () => {
  test("uses distinct fixed local/remote Java and explicit EULA guidance", () => {
    const categories = [
      ["JAVA_NOT_FOUND", "servers.javaMissingLocal", "servers.javaMissingRemote"],
      ["JAVA_INCOMPATIBLE", "servers.javaIncompatibleLocal", "servers.javaIncompatibleRemote"],
      ["EULA_NOT_ACCEPTED", "servers.eulaRequired", "servers.eulaRequired"],
    ] as const;
    for (const [code, local, remote] of categories) {
      for (const raw of [code, `${code}: PRIVATE_HOST /private/java --token=PRIVATE_SECRET`]) {
        expect(safeServerOperationError(raw, "local", (key) => key)).toBe(local);
        expect(safeServerOperationError(raw, "ssh-remote", (key) => key)).toBe(remote);
        expect(safeServerErrorKey(raw, "servers.operationFailed")).toBe(remote);
      }
    }
  });

  test("both languages have sanitized actionable guidance on the correct host", () => {
    for (const language of ["en", "zh"] as const) {
      const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
      const missing = safeServerOperationError("JAVA_NOT_FOUND: PRIVATE_SECRET", "ssh-host", t);
      const incompatible = safeServerOperationError("JAVA_INCOMPATIBLE: PRIVATE_SECRET", "ssh-host", t);
      const local = safeServerOperationError("JAVA_NOT_FOUND: PRIVATE_SECRET", "local", t);
      const eula = safeServerOperationError("EULA_NOT_ACCEPTED: PRIVATE_SECRET", "ssh-host", t);
      for (const text of [missing, incompatible, local, eula]) {
        expect(text).not.toContain("PRIVATE_SECRET");
        expect(text).not.toContain("servers.");
        expect(text).not.toBe(t("servers.operationFailed"));
      }
      expect(missing).not.toBe(incompatible);
      expect(missing).not.toBe(local);
      expect(missing).toContain(language === "en" ? "remote host" : "远端主机");
      expect(incompatible).toContain(language === "en" ? "remote host" : "远端主机");
      expect(eula).toContain(language === "en" ? "explicitly" : "明确");
    }
  });

  test("does not infer recovery codes from diagnostic content", () => {
    for (const raw of ["diagnostic JAVA_NOT_FOUND: private", "JAVA_NOT_FOUND_EXTRA: private", "java_not_found: private"]) {
      expect(safeServerOperationError(raw, "ssh-host", (key) => key)).toBe("servers.operationFailed");
    }
  });
});
