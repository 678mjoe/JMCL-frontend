import { InstanceBusyError, instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";
import type { CoreSession, EventHandler, InstallEvent } from "./rpc";
import type { InstanceManifest } from "./types";

export type ModpackSession = Pick<CoreSession, "close" | "instanceList" | "instanceGet" | "modpackInstall" | "installExecute" | "installPrepare">;
export interface ModpackImportInput { directory: string; storeDirectory: string; id: string; file: string }
export interface ModpackImportState {
  phase: "idle" | "checking" | "archive" | "manifest" | "install" | "prepare" | "success" | "error";
  busy: boolean;
  error: string | null;
  progress: { files: number; total: number; bytes: number; bytesTotal: number } | null;
  canResume: boolean;
  instance: InstanceManifest | null;
}
export function validModpackInstanceId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) && !id.endsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(id);
}
const errorCode = (error: unknown) => {
  if (error instanceof InstanceBusyError) return "INSTANCE_BUSY";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "IMPORT_OUTCOME_UNKNOWN";
  return new Set(["INVALID_PARAMS", "INSTANCE_EXISTS", "INSTANCE_NOT_FOUND", "UNKNOWN_MODPACK_FORMAT", "UNSUPPORTED_MODPACK_FORMAT", "UNSUPPORTED_LOADER", "LOADER_CONFLICT", "DOWNLOAD_UNAVAILABLE", "UNSUPPORTED_PROJECT_TYPE", "MODPACK_NOT_FOUND", "UNSAFE_MODPACK", "HTTP_STATUS_ERROR", "MODPACK_INSTALL_FAILED", "INSTANCES_ROOT_ERROR", "STORE_ROOT_ERROR", "INSTALL_FAILED", "PREPARE_FAILED", "JAVA_NOT_FOUND", "JAVA_INCOMPATIBLE", "IMPORT_INTERRUPTED", "INVALID_INSTANCE_RESULT"]).has(code) ? code : "IMPORT_OUTCOME_UNKNOWN";
};
/** One archive submission only. Only confirmed post-archive stages can resume.
 * Disposal never kills a synchronous core request; it prevents the next stage.
 */
export class ModpackImportController {
  private state: ModpackImportState = { phase: "idle", busy: false, error: null, progress: null, canResume: false, instance: null };
  private listeners = new Set<() => void>();
  private disposed = false;
  private archiveAttempted = false;
  private archiveConfirmed = false;
  private installed = false;
  private importedIdentity: string | null = null;
  constructor(readonly input: ModpackImportInput, private readonly open: () => Promise<ModpackSession>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { this.disposed = true; this.listeners.clear(); }
  private patch(patch: Partial<ModpackImportState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private active() { if (this.disposed) throw { code: "IMPORT_INTERRUPTED" }; }
  async run(): Promise<void> {
    if (this.disposed || this.state.busy || this.state.phase === "success" || (this.archiveConfirmed && this.state.phase === "error" && !this.state.canResume) || (this.archiveAttempted && !this.archiveConfirmed)) return;
    const input = this.input;
    if (!input.directory || !input.storeDirectory || !input.file || !validModpackInstanceId(input.id)) {
      this.patch({ phase: "error", error: "INVALID_PARAMS" }); return;
    }
    let release: (() => void) | undefined;
    let session: ModpackSession | undefined;
    this.patch({ busy: true, error: null, canResume: false, progress: null });
    try {
      release = instanceCoordinator.tryAcquire(instanceMutationKey(input.directory, input.id), "install");
      session = await this.open(); this.active();
      if (!this.archiveConfirmed) {
        this.patch({ phase: "checking" });
        const list = await session.instanceList(input.directory); this.active();
        if (list.instances.some((instance) => instance.id === input.id)) throw { code: "INSTANCE_EXISTS" };
        this.patch({ phase: "archive" }); this.archiveAttempted = true;
        await session.modpackInstall(input.directory, input.id, input.file, { store_directory: input.storeDirectory }, this.progress, { coordinate: false });
        this.archiveConfirmed = true; this.active();
      }
      this.patch({ phase: "manifest", progress: null });
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
        this.patch({ phase: "install" });
        await session.installExecute(instance.version_id, { ...options, store_directory: input.storeDirectory }, this.progress, { coordinate: false });
        this.installed = true; this.active();
      }
      this.patch({ phase: "prepare", progress: null });
      await session.installPrepare(instance.version_id, options, { coordinate: false }); this.active();
      this.patch({ phase: "success", canResume: false });
    } catch (error) {
      this.patch({ phase: "error", error: errorCode(error), canResume: this.archiveConfirmed && errorCode(error) !== "INVALID_INSTANCE_RESULT" });
    } finally {
      // Closing a completed dedicated session must not re-submit the archive.
      try { await session?.close(); } catch { /* Core outcome remains authoritative. */ }
      release?.(); this.patch({ busy: false });
    }
  }
  private progress: EventHandler<InstallEvent> = (event) => {
    if (this.disposed || event.kind !== "event") return;
    if (event.data.event === "progress") {
      const p = event.data.progress;
      if (![p.files_completed, p.files_total, p.bytes_processed, p.bytes_total].every((value) => Number.isSafeInteger(value) && value >= 0)) return;
      this.patch({ progress: { files: p.files_completed, total: p.files_total, bytes: p.bytes_processed, bytesTotal: p.bytes_total } });
    }
  };
}
