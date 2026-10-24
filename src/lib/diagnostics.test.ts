import { expect, test } from "bun:test";
import { diagnosticFailures, diagnosticOperations, installDiagnosticCapture, parseDiagnosticRead, parseDiagnosticStatus, recordFrontendEvent } from "./diagnostics";
const secret = "SECRET_ACCESS_TOKEN_PASSWORD_ENDPOINT";
test("record parser excludes arbitrary strings and unsupported event/method/outcome", () => {
  const safe = { version: 1, timestamp_ms: 1, level: "info", event: "core_request" } as const;
  const result = parseDiagnosticRead({ records: [{ ...safe, message: secret, method: secret, outcome: secret, duration_ms: secret, correlation_id: secret }, { ...safe, event: secret }, { ...safe, level: secret }, { ...safe, timestamp_ms: Infinity }, null], skipped: 2 });
  expect(result).toEqual({ records: [safe], skipped: 6 });
  expect(JSON.stringify(result)).not.toContain(secret);
});
test("record parsing keeps only bounded finite numeric metadata and enums", () => {
  expect(parseDiagnosticRead({ records: [{ version: 1, timestamp_ms: 1, level: "error", event: "core_request", method: "account", duration_ms: 0, correlation_id: 4, outcome: "error" }] }).records).toHaveLength(1);
  expect(parseDiagnosticRead(undefined)).toEqual({ records: [], skipped: 0 });
  expect(parseDiagnosticRead({ records: Array(2010).fill({ version: 1, timestamp_ms: 1, level: "info", event: "app_started" }) }).records).toHaveLength(2000);
  expect(() => parseDiagnosticStatus({ enabled: secret })).toThrow();
  expect(parseDiagnosticStatus({ enabled: false, available: true, dropped: secret })).toEqual({ enabled: false, available: true, max_files: 0, max_file_bytes: 0, dropped: 0 });
});
test("error capture never accesses event details; cleanup removes listeners", () => {
  const listeners = new Map<string, EventListener>(); const recorded: unknown[] = [];
  const target = { addEventListener: (name: string, cb: EventListener) => listeners.set(name, cb), removeEventListener: (name: string) => listeners.delete(name) };
  const dispose = installDiagnosticCapture(target as unknown as Window, event => recorded.push(event));
  const event = new Proxy({}, { get() { throw new Error(secret); } }) as Event;
  listeners.get("error")!(event); listeners.get("unhandledrejection")!(event);
  expect(recorded).toEqual(["frontend_ready", "frontend_error", "unhandled_rejection"]);
  expect(JSON.stringify(recorded)).not.toContain(secret);
  dispose(); expect(listeners.size).toBe(0);
  expect(() => recordFrontendEvent(secret as never)).not.toThrow();
});
test("specific known operations and failure categories survive; raw codes and messages do not", () => {
  const base = { version: 1, timestamp_ms: 1, level: "error", event: "core_request", method: "auth", outcome: "error" };
  const result = parseDiagnosticRead({ records: [
    { ...base, operation: "auth.microsoft.device.begin", failure: "network", code: secret, message: secret, stderr: secret },
    { ...base, operation: `auth.microsoft.device.begin.${secret}`, failure: secret },
    { ...base, operation: "other", failure: "rpc_rejected" },
  ] });
  expect(result.records[0]?.operation).toBe("auth.microsoft.device.begin"); expect(result.records[0]?.failure).toBe("network");
  expect(result.records[1]?.operation).toBeUndefined(); expect(result.records[1]?.failure).toBeUndefined();
  expect(result.records[2]?.operation).toBe("other"); expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain("stderr");
});

test("all closed operation and failure values round-trip without widening to unknown strings", () => {
  for (const operation of diagnosticOperations) {
    const records = diagnosticFailures.map(failure => ({ version: 1, timestamp_ms: 1, level: "error", event: "core_request", operation, failure }));
    expect(parseDiagnosticRead({ records }).records.map(record => record.failure)).toEqual([...diagnosticFailures]);
    expect(parseDiagnosticRead({ records }).records.every(record => record.operation === operation)).toBe(true);
  }
});
