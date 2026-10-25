import { describe, expect, test } from "bun:test";
import { formatBytes, initialInstallProgress, installPercent, reduceInstallProgress } from "./installProgress";
const event = (data: unknown) => ({ kind: "event", data });
// Wire shapes from pinned Core 5a4310d protocol/install.zig:484–575 and
// protocol/java.zig:271–319. No download, Java process, or credential access.
const started = event({ event: "started", source: "official", started: { stage: "download", version_id: "1.21.4", files_total: 4, bytes_total: 1000 } });
const progress = (values = {}) => event({ event: "progress", source: "official", progress: { files_completed: 2, files_total: 4, bytes_processed: 800, bytes_total: 1000, bytes_verified: 100, bytes_transferred: 700, ...values } });
const processor = (index = 2, total = 4) => event({ event: "processor_started", source: "official", processor_started: { stage: "processor", index, total, name: "private-token-path.jar" } });
describe("safe shared installation progress", () => {
  test("download started and byte-first progress retain only display counters", () => {
    const state = reduceInstallProgress(reduceInstallProgress(initialInstallProgress(), started), progress());
    expect(state).toEqual({ stage: "download", detail: null, progress: { filesCompleted: 2, filesTotal: 4, bytesProcessed: 800, bytesTotal: 1000 } });
    expect(installPercent(state.progress)).toBe(80);
  });
  test("processor started clears completed downloads and is not a completed file percentage", () => {
    const state = reduceInstallProgress(reduceInstallProgress(initialInstallProgress(), progress()), processor(4, 4));
    expect(state).toEqual({ stage: "processor", progress: null, detail: { kind: "processor", index: 4, total: 4 } });
    expect(installPercent(state.progress)).toBeNull();
    expect(JSON.stringify(state)).not.toContain("private-token");
  });
  test("all actual Java phases clear stale bars and preserve a bounded detail", () => {
    let state = reduceInstallProgress(initialInstallProgress(), progress());
    for (const phase of ["resolving", "downloading", "extracting", "verifying"] as const) {
      state = reduceInstallProgress(state, event({ event: "stage", stage: phase }));
      expect(state).toEqual({ stage: "java", progress: null, javaPhase: phase, detail: { kind: "java", phase } });
    }
  });
  test("direct runtime counters retain Java context until processor or sourced downloads", () => {
    let state = reduceInstallProgress(initialInstallProgress(), event({ event: "stage", stage: "downloading" }));
    state = reduceInstallProgress(state, event({ event: "progress", progress: { files_completed: 1, files_total: 1, bytes_processed: 24, bytes_total: 24, bytes_transferred: 24 } }));
    expect(state.stage).toBe("java"); expect(state.progress?.bytesProcessed).toBe(24);
    state = reduceInstallProgress(state, processor()); expect(state.stage).toBe("processor"); expect(state.progress).toBeNull();
    state = reduceInstallProgress(state, started); expect(state.stage).toBe("download"); expect(state.detail).toBeNull();
  });
  test("compatible runtime envelope supports explicit and inferred event names", () => {
    let state = reduceInstallProgress(initialInstallProgress(), event({ event: "runtime", runtime: { stage: "extracting" } }));
    expect(state.detail).toEqual({ kind: "java", phase: "extracting" });
    state = reduceInstallProgress(state, event({ event: "runtime", runtime: { event: "file", file: { path: "private", size: 4 } } }));
    expect(state.detail).toEqual({ kind: "file", status: "processed" });
    expect(state.javaPhase).toBe("extracting");
  });
  test("retry displays NEXT attempt and classified reason, never path/raw error", () => {
    let state = reduceInstallProgress(initialInstallProgress(), progress());
    state = reduceInstallProgress(state, event({ event: "retry", source: "official", retry: { path: "https://x/?token=secret", attempt: 1, max_attempts: 3, error: "HashMismatch" } }));
    expect(state.detail).toEqual({ kind: "retry", attempt: 2, maxAttempts: 3, reason: "integrity" });
    state = reduceInstallProgress(state, progress({ bytes_processed: 900 }));
    expect(state.detail?.kind).toBe("retry");
    state = reduceInstallProgress(state, event({ event: "file", source: "official", file: { path: "secret", size: 4, status: "downloaded", placement: "hard_link", attempts: 2 } }));
    expect(state.detail).toEqual({ kind: "file", status: "downloaded" });
    expect(JSON.stringify(state)).not.toMatch(/secret|https|hard_link|HashMismatch/);
  });
  test("unrecognized retry errors are coarse other, known network errors classified", () => {
    for (const [error, reason] of [["ConnectionTimedOut", "network"], ["token=secret", "other"], [{ private: "secret" }, "other"]] as const) {
      const state = reduceInstallProgress(initialInstallProgress(), event({ event: "retry", retry: { attempt: 1, max_attempts: 2, error } }));
      expect(state.detail).toEqual({ kind: "retry", attempt: 2, maxAttempts: 2, reason });
    }
  });
  test("invalid counters and counter inversions never poison state", () => {
    const state = reduceInstallProgress(initialInstallProgress(), progress());
    for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "20", null]) {
      for (const field of ["files_completed", "files_total", "bytes_processed", "bytes_total"]) {
        expect(reduceInstallProgress(state, progress({ [field]: value }))).toBe(state);
      }
    }
    expect(reduceInstallProgress(state, progress({ files_completed: 5 }))).toBe(state);
    expect(reduceInstallProgress(state, processor(0))).toBe(state);
    expect(reduceInstallProgress(state, processor(5))).toBe(state);
    expect(reduceInstallProgress(state, processor(1, 0))).toBe(state);
  });
  test("unknown/direct malformed events and diagnostics retain no content", () => {
    const state = initialInstallProgress();
    for (const input of [null, [], {}, { kind: "diagnostic", data: "token=private" }, event(null), event({ event: "stage", stage: "secret" }), event({ event: "runtime", runtime: [] }), event({ event: "file", file: { size: 1, status: "secret" } }), event({ event: "retry", retry: { attempt: 3, max_attempts: 3 } })]) {
      expect(reduceInstallProgress(state, input)).toBe(state);
    }
  });
  test("known file statuses shown without paths or false numbers", () => {
    for (const status of ["cached", "downloaded"] as const) {
      const state = reduceInstallProgress(initialInstallProgress(), event({ event: "file", source: "official", file: { path: "private", size: 10, status, placement: "hard_link", attempts: 1 } }));
      expect(state.detail).toEqual({ kind: "file", status }); expect(state.progress).toBeNull();
    }
  });
  test("same stage retry/processor events are deterministic and new started resets them", () => {
    const first = reduceInstallProgress(initialInstallProgress(), processor());
    expect(reduceInstallProgress(first, processor())).toEqual(first);
    expect(reduceInstallProgress(first, started).detail).toBeNull();
  });
  test("unknown totals remain indeterminate; percent finite/clamped and bytes formatted", () => {
    expect(installPercent({ filesCompleted: 0, filesTotal: 0, bytesProcessed: 100, bytesTotal: 0 })).toBeNull();
    expect(installPercent({ filesCompleted: 1, filesTotal: 4, bytesProcessed: 100, bytesTotal: 0 })).toBe(25);
    expect(installPercent({ filesCompleted: 4, filesTotal: 4, bytesProcessed: 1100, bytesTotal: 1000 })).toBe(100);
    expect(installPercent({ filesCompleted: 1, filesTotal: 4, bytesProcessed: Infinity, bytesTotal: 2 })).toBeNull();
    expect(formatBytes(1024)).toBe("1.00 KiB"); expect(formatBytes(1024 * 1024)).toBe("1.00 MiB");
    expect(formatBytes(NaN)).toBe("0 B"); expect(formatBytes(-10)).toBe("0 B");
  });
});
