import { InstanceBusyError, instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";
import type { CoreSession, EventHandler, InstallEvent } from "./rpc";
import type { InstanceManifest, ModpackInstallResult } from "./types";
import { initialInstallProgress, reduceInstallProgress, type InstallProgressState } from "./installProgress";

export type ModpackSession = Pick<CoreSession, "close" | "instanceList" | "instanceGet" | "modpackInstall" | "installExecute" | "installPrepare">;
export interface ModpackImportInput { workers?: number; retries?: number; directory: string; storeDirectory: string; id: string; file: string; provider?: "modrinth" | "curseforge" }
export interface ModpackImportState {
  phase: "idle" | "checking" | "archive" | "manifest" | "install" | "prepare" | "success" | "error";
  busy: boolean;
  error: string | null;
  progress: { files: number; total: number; bytes: number; bytesTotal: number } | null;
  canResume: boolean;
  canEdit: boolean;
  summary: ModpackInstallResult | null;
  installProgress: InstallProgressState | null;
  instance: InstanceManifest | null;
}
export function validModpackInstanceId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) && !id.endsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(id);
}
export const modpackImportErrorCode = (error: unknown) => {
  if (error instanceof InstanceBusyError) return "INSTANCE_BUSY";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "IMPORT_OUTCOME_UNKNOWN";
  return new Set(["CURSEFORGE_KEY_REQUIRED", "CURSEFORGE_KEY_INVALID", "CURSEFORGE_KEYCHAIN", "CURSEFORGE_AUTH", "CURSEFORGE_NETWORK", "CURSEFORGE_RATE_LIMIT", "CURSEFORGE_REQUEST_INVALID", "INVALID_PARAMS", "INSTANCE_EXISTS", "INSTANCE_NOT_FOUND", "UNKNOWN_MODPACK_FORMAT", "UNSUPPORTED_MODPACK_FORMAT", "UNSUPPORTED_LOADER", "LOADER_CONFLICT", "DOWNLOAD_UNAVAILABLE", "UNSUPPORTED_PROJECT_TYPE", "MODPACK_NOT_FOUND", "UNSAFE_MODPACK", "HTTP_STATUS_ERROR", "MODPACK_INSTALL_FAILED", "INSTANCES_ROOT_ERROR", "STORE_ROOT_ERROR", "INSTALL_FAILED", "PREPARE_FAILED", "DOWNLOAD_FAILED", "JAVA_DOWNLOAD_FAILED", "JAVA_RESOLUTION_FAILED", "PROCESSOR_FAILED", "CACHE_INVALID", "UNSAFE_ARCHIVE", "PREPARE_CONFLICT", "JAVA_INSTALL_FAILED", "JAVA_NOT_FOUND", "JAVA_INCOMPATIBLE", "IMPORT_INTERRUPTED", "INVALID_INSTANCE_RESULT"]).has(code) ? code : "IMPORT_OUTCOME_UNKNOWN";
};
/** One archive submission only. Only confirmed post-archive stages can resume.
 * Disposal never kills a synchronous core request; it prevents the next stage.
 */
export class ModpackImportController {
  private state: ModpackImportState = { phase: "idle", busy: false, error: null, progress: null, canResume: false, canEdit: false, summary: null, installProgress: null, instance: null };
  private listeners = new Set<() => void>();
  private disposed = false;
  private archiveAttempted = false;
  private archiveConfirmed = false;
  private installed = false;
  private importedIdentity: string | null = null;
  constructor(readonly input: ModpackImportInput, private readonly open: () => Promise<ModpackSession>) { this.input = { ...input }; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { this.disposed = true; this.listeners.clear(); }
  private patch(patch: Partial<ModpackImportState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private active() { if (this.disposed) throw { code: "IMPORT_INTERRUPTED" }; }
  async run(): Promise<void> {
    if (this.disposed || this.state.busy || this.state.phase === "success" || (this.archiveConfirmed && this.state.phase === "error" && !this.state.canResume) || (this.archiveAttempted && !this.archiveConfirmed)) return;
    const input = this.input;
    if (!input.directory || !input.storeDirectory || !input.file || !validModpackInstanceId(input.id)) {
      this.patch({ phase: "error", error: "INVALID_PARAMS", canEdit: true }); return;
    }
    let release: (() => void) | undefined;
    let session: ModpackSession | undefined;
    this.patch({ busy: true, error: null, canResume: false, canEdit: false, progress: null, installProgress: null });
    try {
      release = instanceCoordinator.tryAcquire(instanceMutationKey(input.directory, input.id), "install");
      session = await this.open(); this.active();
      if (!this.archiveConfirmed) {
        this.patch({ phase: "checking" });
        const list = await session.instanceList(input.directory); this.active();
        if (list.instances.some((instance) => instance.id === input.id)) throw { code: "INSTANCE_EXISTS" };
        this.patch({ phase: "archive" }); this.archiveAttempted = true;
        const summary = await session.modpackInstall(input.directory, input.id, input.file, { workers: input.workers, retries: input.retries, store_directory: input.storeDirectory, ...(input.provider === "curseforge" ? { provider: "curseforge" as const } : {}) }, this.progress, { coordinate: false });
        this.archiveConfirmed = true; this.active();
        if (!validModpackSummary(summary, input.id)) throw { code: "INVALID_INSTANCE_RESULT" };
        this.patch({ summary });
        if (input.provider === "curseforge") {
          // Credentialed native sessions are deliberately single-use. Continue setup
          // through a fresh uncredentialed session under the same mutation lease.
          try { await session.close(); } catch { /* Native may already have closed it. */ }
          session = undefined; this.active();
          session = await this.open(); this.active();
        }
      }
      this.patch({ phase: "manifest", progress: null, installProgress: null });
      const instance = await session.instanceGet(input.directory, input.id); this.active();
      if (instance.id !== input.id || !instance.version_id || [instance.fabric_loader, instance.neoforge_version, instance.forge_version].filter(Boolean).length > 1) throw { code: "INVALID_INSTANCE_RESULT" };
      const identity = JSON.stringify([instance.id, instance.version_id, instance.source, instance.fabric_loader, instance.neoforge_version, instance.forge_version]);
      if (this.importedIdentity !== null && identity !== this.importedIdentity) throw { code: "INVALID_INSTANCE_RESULT" };
      this.importedIdentity = identity;
      this.patch({ instance });
      // This is the documented instance layout, not an archive-derived path.
      const directory = `${input.directory}/${input.id}/.minecraft`;
      const loaders = instance.fabric_loader ? { fabric_loader: instance.fabric_loader } : instance.neoforge_version ? { neoforge_version: instance.neoforge_version } : instance.forge_version ? { forge_version: instance.forge_version } : {};
      const options = { directory, source: instance.source, ...loaders };
      if (!this.installed) {
        this.patch({ phase: "install", progress: null, installProgress: null });
        await session.installExecute(instance.version_id, { ...options, workers: input.workers, retries: input.retries, store_directory: input.storeDirectory }, this.progress, { coordinate: false });
        this.installed = true; this.active();
      }
      this.patch({ phase: "prepare", progress: null, installProgress: null });
      await session.installPrepare(instance.version_id, options, { coordinate: false }); this.active();
      this.patch({ phase: "success", canResume: false });
    } catch (error) {
      const code = modpackImportErrorCode(error);
      const known = code !== "IMPORT_OUTCOME_UNKNOWN" && code !== "IMPORT_INTERRUPTED";
      this.patch({ phase: "error", error: code, canResume: this.archiveConfirmed && known && code !== "INVALID_INSTANCE_RESULT", canEdit: !this.archiveConfirmed && known });
    } finally {
      // Closing a completed dedicated session must not re-submit the archive.
      try { await session?.close(); } catch { /* Core outcome remains authoritative. */ }
      release?.(); this.patch({ busy: false });
    }
  }
  private progress: EventHandler<InstallEvent> = (event) => {
    if (this.disposed) return;
    const previous = this.state.installProgress ?? initialInstallProgress();
    const installProgress = reduceInstallProgress(previous, event);
    if (installProgress !== previous) {
      const p = installProgress.progress;
      this.patch({ installProgress, progress: p ? { files: p.filesCompleted, total: p.filesTotal, bytes: p.bytesProcessed, bytesTotal: p.bytesTotal } : null });
    }
  };
}

export function suggestedModpackInstanceId(name: string): string {
  const id = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|[.-]+$/g, "").slice(0, 64).replace(/[.]+$/g, "");
  return validModpackInstanceId(id) ? id : "modpack";
}
function validModpackSummary(value: ModpackInstallResult, id: string): boolean {
  return !!value && value.id === id && typeof value.name === "string" && value.name.length <= 4096
    && typeof value.version_id === "string" && value.version_id.length <= 256
    && [value.files_installed, value.files_skipped, value.overrides_written].every(v => Number.isSafeInteger(v) && v >= 0)
    && (value.loader === null || (typeof value.loader?.name === "string" && typeof value.loader?.version === "string"));
}
