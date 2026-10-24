import { invoke, isTauri } from "@tauri-apps/api/core";
import { isMockTransport } from "./transportMode";

export const diagnosticEvents = ["app_started", "app_stopped", "core_open", "endpoint_open", "core_close", "endpoint_close", "core_request", "frontend_ready", "frontend_error", "unhandled_rejection", "bridge_error"] as const;
export type DiagnosticEvent = typeof diagnosticEvents[number];
export type FrontendDiagnosticEvent = "frontend_ready" | "frontend_error" | "unhandled_rejection" | "bridge_error";
const families = ["core", "instance", "server", "content", "account", "auth", "java", "other"] as const;
// Exact native operation identifiers only. Unknown input is never rendered.
export const diagnosticOperations = [
  "account.microsoft.delete",
  "account.microsoft.get",
  "account.microsoft.list",
  "account.microsoft.save",
  "auth.microsoft.device.begin",
  "auth.microsoft.device.poll",
  "auth.microsoft.refresh",
  "auth.minecraft.exchange",
  "auth.minecraft.refresh_exchange",
  "core.version",
  "datapacks.adopt",
  "datapacks.disable",
  "datapacks.enable",
  "datapacks.install",
  "datapacks.list",
  "datapacks.remove",
  "datapacks.set-version",
  "install.execute",
  "install.plan",
  "install.prepare",
  "instance.create",
  "instance.delete",
  "instance.get",
  "instance.list",
  "java.detect",
  "java.runtime.install",
  "java.runtime.list",
  "java.runtime.remove",
  "java.select",
  "launch.execute",
  "launch.plan",
  "modpack.install",
  "mods.adopt",
  "mods.disable",
  "mods.enable",
  "mods.install",
  "mods.list",
  "mods.remove",
  "mods.set-version",
  "ping",
  "resourcepacks.adopt",
  "resourcepacks.disable",
  "resourcepacks.enable",
  "resourcepacks.install",
  "resourcepacks.list",
  "resourcepacks.remove",
  "resourcepacks.set-version",
  "server.command",
  "server.create",
  "server.datapacks.adopt",
  "server.datapacks.disable",
  "server.datapacks.enable",
  "server.datapacks.install",
  "server.datapacks.list",
  "server.datapacks.remove",
  "server.datapacks.set-version",
  "server.delete",
  "server.get",
  "server.install",
  "server.list",
  "server.logs",
  "server.mods.adopt",
  "server.mods.disable",
  "server.mods.enable",
  "server.mods.install",
  "server.mods.list",
  "server.mods.remove",
  "server.mods.set-version",
  "server.properties.get",
  "server.properties.set",
  "server.query",
  "server.rcon.command",
  "server.restart",
  "server.start",
  "server.status",
  "server.stop",
  "server.worlds.backup",
  "server.worlds.backups",
  "server.worlds.backups.delete",
  "server.worlds.delete",
  "server.worlds.get",
  "server.worlds.list",
  "server.worlds.rename",
  "server.worlds.restore",
  "shaderpacks.adopt",
  "shaderpacks.disable",
  "shaderpacks.enable",
  "shaderpacks.install",
  "shaderpacks.list",
  "shaderpacks.remove",
  "shaderpacks.set-version",
  "store.gc",
  "version.get",
  "version.list",
  "version.resolve",
  "worlds.backup",
  "worlds.backups",
  "worlds.backups.delete",
  "worlds.delete",
  "worlds.duplicate",
  "worlds.export",
  "worlds.get",
  "worlds.import",
  "worlds.list",
  "worlds.rename",
  "worlds.restore",
  "other"
] as const;
export const diagnosticFailures = ["rpc_rejected", "invalid_params", "network", "rate_limited", "session_closed", "cancelled", "eof", "read_failed", "write_failed", "readers_stopped", "protocol", "incompatible_version", "ssh_auth", "ssh_host_key", "ssh_timeout", "ssh_connection", "credentials", "transport", "core_unavailable", "spawn_failed"] as const;
export interface DiagnosticRecord {
  version: 1; timestamp_ms: number; level: "info" | "error"; event: DiagnosticEvent;
  operation?: typeof diagnosticOperations[number]; failure?: typeof diagnosticFailures[number];
  method?: typeof families[number]; duration_ms?: number; correlation_id?: number; outcome?: "ok" | "error" | "cancelled";
}
export interface DiagnosticStatus { enabled: boolean; available: boolean; max_file_bytes: number; max_files: number; dropped: number }
export interface DiagnosticRead { records: DiagnosticRecord[]; skipped: number }
const unavailable: DiagnosticStatus = { enabled: false, available: false, max_file_bytes: 0, max_files: 0, dropped: 0 };
const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const member = <T extends string>(values: readonly T[], v: unknown): v is T => typeof v === "string" && values.includes(v as T);
/** Defense in depth: copy only recognized fields, never render bridge-provided free text. */
export function parseDiagnosticRead(value: unknown): DiagnosticRead {
  const input = value as Partial<DiagnosticRead> | null;
  let skipped = number(input?.skipped) ? input.skipped : 0;
  const records: DiagnosticRecord[] = [];
  for (const raw of Array.isArray(input?.records) ? input.records.slice(-2000) : []) {
    if (!raw || raw.version !== 1 || !number(raw.timestamp_ms) || raw.timestamp_ms > 8640000000000000 || !member(["info", "error"], raw.level) || !member(diagnosticEvents, raw.event)) { skipped++; continue; }
    const record: DiagnosticRecord = { version: 1, timestamp_ms: raw.timestamp_ms, level: raw.level, event: raw.event };
    if (member(families, raw.method)) record.method = raw.method;
    if (member(diagnosticOperations, raw.operation)) record.operation = raw.operation;
    if (member(diagnosticFailures, raw.failure)) record.failure = raw.failure;
    if (number(raw.duration_ms)) record.duration_ms = raw.duration_ms;
    if (number(raw.correlation_id)) record.correlation_id = raw.correlation_id;
    if (member(["ok", "error", "cancelled"], raw.outcome)) record.outcome = raw.outcome;
    records.push(record);
  }
  return { records, skipped };
}
export function parseDiagnosticStatus(value: unknown): DiagnosticStatus {
  const v = value as Partial<DiagnosticStatus> | null;
  if (!v || typeof v.enabled !== "boolean" || typeof v.available !== "boolean") throw new Error("diagnostics_unavailable");
  return { enabled: v.enabled, available: v.available, max_file_bytes: number(v.max_file_bytes) ? v.max_file_bytes : 0, max_files: number(v.max_files) ? v.max_files : 0, dropped: number(v.dropped) ? v.dropped : 0 };
}
export interface DiagnosticTransport {
  status(): Promise<unknown>; read(): Promise<unknown>; setEnabled(enabled: boolean): Promise<unknown>;
  clear(): Promise<unknown>; export(): Promise<unknown>;
}
const native = () => !isMockTransport() && isTauri();
export const diagnosticTransport: DiagnosticTransport = {
  status: () => native() ? invoke("diagnostics_status") : Promise.resolve(unavailable),
  read: () => native() ? invoke("diagnostics_read") : Promise.resolve({ records: [], skipped: 0 }), setEnabled: enabled => invoke("diagnostics_set_enabled", { enabled }),
  clear: () => invoke("diagnostics_clear"), export: () => invoke("diagnostics_export"),
};
/** No error/rejection argument is accepted: even an Error's name/message/stack can contain secrets. */
export function recordFrontendEvent(event: FrontendDiagnosticEvent): void {
  try {
    if (!member(["frontend_ready", "frontend_error", "unhandled_rejection", "bridge_error"], event) || !native()) return;
    void invoke("diagnostics_record", { event }).catch(() => {});
  } catch { /* Logging must never cause another uncaught error. */ }
}
export function installDiagnosticCapture(target: Pick<Window, "addEventListener" | "removeEventListener">, record = recordFrontendEvent): () => void {
  const error = () => record("frontend_error");
  const rejection = () => record("unhandled_rejection");
  target.addEventListener("error", error);
  target.addEventListener("unhandledrejection", rejection);
  record("frontend_ready");
  return () => { target.removeEventListener("error", error); target.removeEventListener("unhandledrejection", rejection); };
}
