/** Safe display projection of Core 5a4310d install/java event contracts.
 * Source: protocol/install.zig and protocol/java.zig. Never retain paths,
 * processor names, URLs, raw error strings or diagnostic output here.
 */
export interface InstallCounters {
  filesCompleted: number;
  filesTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
}
export type JavaInstallPhase = "resolving" | "downloading" | "extracting" | "verifying";
export type InstallProgressDetail =
  | { kind: "file"; status: "cached" | "downloaded" | "processed" }
  | { kind: "retry"; attempt: number; maxAttempts: number; reason: "network" | "integrity" | "other" }
  | { kind: "processor"; index: number; total: number }
  | { kind: "java"; phase: JavaInstallPhase };
export interface InstallProgressState {
  stage: "download" | "java" | "processor";
  progress: InstallCounters | null;
  detail: InstallProgressDetail | null;
  javaPhase?: JavaInstallPhase;
}
export const initialInstallProgress = (): InstallProgressState => ({ stage: "download", progress: null, detail: null });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const javaPhases: readonly unknown[] = ["resolving", "downloading", "extracting", "verifying"];
function reason(error: unknown): "network" | "integrity" | "other" {
  if (typeof error !== "string") return "other";
  if (["HashMismatch", "SizeMismatch", "InvalidHash", "InvalidChecksum"].includes(error)) return "integrity";
  if (["ConnectionTimedOut", "ConnectionResetByPeer", "ConnectionRefused", "NetworkUnreachable", "HostUnreachable", "TemporaryNameServerFailure", "HttpStatusError", "TlsFailure", "Timeout"].includes(error)) return "network";
  return "other";
}
/** SessionEvent envelope accepted as unknown because events from a native peer
 * are runtime data, despite their compile-time TypeScript annotations.
 */
export function reduceInstallProgress(previous: InstallProgressState, input: unknown): InstallProgressState {
  const envelope = record(input);
  if (envelope?.kind !== "event") return previous;
  let data = record(envelope.data);
  if (!data) return previous;
  // Current Core emits direct Java stage/file/retry/progress events without
  // source. Also accept the existing frontend's compatible runtime envelope.
  let runtime = false;
  if (data.event === "runtime") {
    data = record(data.runtime);
    if (!data) return previous;
    runtime = true;
    if (typeof data.event !== "string") {
      const name = ["stage", "file", "retry", "progress"].find((key) => key in data!);
      if (!name) return previous;
      data = { ...data, event: name };
    }
  }
  if (data.event === "stage") {
    if (!javaPhases.includes(data.stage)) return previous;
    return { stage: "java", progress: null, javaPhase: data.stage as JavaInstallPhase, detail: { kind: "java", phase: data.stage as JavaInstallPhase } };
  }
  if (data.event === "started") {
    const started = record(data.started);
    if (started?.stage !== "download" || !count(started.files_total) || !count(started.bytes_total)) return previous;
    return { stage: "download", progress: { filesCompleted: 0, filesTotal: started.files_total, bytesProcessed: 0, bytesTotal: started.bytes_total }, detail: null };
  }
  if (data.event === "processor_started") {
    const processor = record(data.processor_started);
    if (processor?.stage !== "processor" || !count(processor.index) || !count(processor.total) || processor.index < 1 || processor.index > processor.total) return previous;
    // Core reports index + 1 when a processor STARTS. It is not completed
    // work and cannot safely become an overall percent or file count.
    return { stage: "processor", progress: null, detail: { kind: "processor", index: processor.index, total: processor.total } };
  }
  const stage = runtime ? "java" : typeof data.source === "string" ? "download" : previous.stage === "java" ? "java" : "download";
  const base: InstallProgressState = stage === previous.stage ? previous : { stage, progress: null, detail: null };
  if (data.event === "progress") {
    const progress = record(data.progress);
    if (!progress || !count(progress.files_completed) || !count(progress.files_total) || !count(progress.bytes_processed) || !count(progress.bytes_total) || progress.files_completed > progress.files_total) return previous;
    // bytes_processed may exceed an estimated/unknown total; display caps only
    // the ratio, retaining truthful processed bytes. Counts must remain finite.
    return { ...base, progress: { filesCompleted: progress.files_completed, filesTotal: progress.files_total, bytesProcessed: progress.bytes_processed, bytesTotal: progress.bytes_total } };
  }
  if (data.event === "file") {
    const file = record(data.file);
    if (!file || !count(file.size)) return previous;
    const status = file.status === "cached" || file.status === "downloaded" ? file.status : stage === "java" && file.status === undefined ? "processed" : null;
    if (!status) return previous;
    return { ...base, detail: { kind: "file", status } };
  }
  if (data.event === "retry") {
    const retry = record(data.retry);
    if (!retry || !count(retry.attempt) || !count(retry.max_attempts) || retry.attempt < 1 || retry.attempt >= retry.max_attempts) return previous;
    // Core attempt is the failed attempt; next attempt is attempt + 1.
    return { ...base, detail: { kind: "retry", attempt: retry.attempt + 1, maxAttempts: retry.max_attempts, reason: reason(retry.error) } };
  }
  return previous;
}

export function installPercent(progress: InstallCounters | null): number | null {
  if (!progress || !Object.values(progress).every(count)) return null;
  const total = progress.bytesTotal > 0 ? progress.bytesTotal : progress.filesTotal;
  const complete = progress.bytesTotal > 0 ? progress.bytesProcessed : progress.filesCompleted;
  return total > 0 ? Math.min(100, Math.max(0, complete / total * 100)) : null;
}
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}
