import { hasAmbiguousContentProject } from "./contentIdentity";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CoreSession, type InstallEvent, type SessionEvent } from "./rpc";
import { InstanceBusyError } from "./instanceCoordinator";
import type { DatapackListResult } from "./types";

export type ClientDatapackSession = Pick<CoreSession, "close" | "worldsGet" | "datapacksList" | "datapacksInstall" | "datapacksSetVersion" | "datapacksEnable" | "datapacksDisable" | "datapacksRemove" | "datapacksAdopt">;
export interface ClientDatapackSnapshot { content: DatapackListResult | null; locked: boolean | null; pending: boolean; error: string | null; refreshError: string | null; progress: string | null }
const empty = (): ClientDatapackSnapshot => ({ content: null, locked: null, pending: false, error: null, refreshError: null, progress: null });
const codes = new Set(["CONTENT_PROJECT_AMBIGUOUS", "CURSEFORGE_AUTH", "CURSEFORGE_DOWNLOAD_UNAVAILABLE", "CURSEFORGE_KEYCHAIN", "CURSEFORGE_KEY_INPUT", "CURSEFORGE_KEY_INVALID", "CURSEFORGE_KEY_REQUIRED", "CURSEFORGE_NETWORK", "CURSEFORGE_RATE_LIMIT", "CURSEFORGE_REQUEST_INVALID", "INVALID_PARAMS", "WORLD_NOT_FOUND", "WORLD_LOCKED", "CONTENT_NOT_FOUND", "NO_COMPATIBLE_VERSION", "INCOMPATIBLE_VERSION", "VERSION_PROJECT_MISMATCH", "CONTENT_CONFLICT", "CONTENT_KIND_MISMATCH", "UNSUPPORTED_PROJECT_TYPE", "DOWNLOAD_UNAVAILABLE", "HTTP_STATUS_ERROR", "RESPONSE_TOO_LARGE", "CONTENT_LIST_FAILED", "CONTENT_INSTALL_FAILED", "CONTENT_SET_VERSION_FAILED", "CONTENT_TOGGLE_FAILED", "CONTENT_REMOVE_FAILED", "CONTENT_ADOPT_FAILED", "STORE_ROOT_ERROR"]);
function safeCode(error: unknown) { if (error instanceof InstanceBusyError) return "BUSY"; const code = typeof error === "object" && error !== null && "code" in error ? error.code : null; return typeof code === "string" && codes.has(code) ? code : "UNKNOWN"; }
const fail = (code: string): never => { throw { code }; };
const validId = (value: string) => !!value.trim() && value === value.trim() && value !== "." && value !== ".." && !/[\\/\0\r\n]/.test(value);
export class ClientDatapackController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending = false;
  private closeSession: (() => Promise<void>) | null = null;
  constructor(private options: { directory: string; world: string; version: string; storeDirectory?: string; openSession: () => Promise<ClientDatapackSession> }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ClientDatapackSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  cancel = () => { this.generation++; void this.closeSession?.(); this.update(empty()); };
  private async checkWorld(session: ClientDatapackSession, current: () => boolean) {
    const { directory, world, version } = this.options;
    const result = await session.worldsGet(directory, world, version);
    if (result.world.name !== world || typeof result.world.locked !== "boolean") fail("INVALID_PARAMS");
    if (current()) this.update({ locked: result.world.locked });
    return result.world.locked;
  }
  private async refresh(session: ClientDatapackSession, current: () => boolean) {
    if (current()) this.update({ content: null, locked: null, refreshError: null });
    try {
      const result = await session.datapacksList(this.options.directory, this.options.world);
      if (result.world !== this.options.world || result.stage !== "datapacks.list") fail("INVALID_PARAMS");
      if (current()) this.update({ content: result });
      if (current()) await this.checkWorld(session, current);
    } catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); }
  }
  private async run(action?: (session: ClientDatapackSession, event: (event: SessionEvent<InstallEvent>) => void) => Promise<unknown>, freshRefresh = false) {
    if (this.pending) return false;
    this.pending = true;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.update({ pending: true, error: null, refreshError: null, progress: null });
    let session: ClientDatapackSession | null = null;
    let close: (() => Promise<void>) | null = null;
    let succeeded = false;
    try {
      session = await this.options.openSession();
      const opened = session; let closing: Promise<void> | null = null;
      close = () => closing ??= Promise.resolve().then(() => opened.close()).catch(() => undefined);
      this.closeSession = close;
      if (!current()) return false;
      if (action) {
        const locked = await this.checkWorld(session, current);
        if (!current()) return false;
        if (locked) fail("WORLD_LOCKED");
        // RPC wrappers own the process-wide instance mutation lease. Core checks
        // session.lock again atomically with each mutation; this read is advisory.
        const result = await action(session, event => {
          if (!current() || event.kind !== "event") return;
          const data = event.data;
          if (["started", "file", "retry", "progress"].includes(data.event)) {
            let progress: string = data.event;
            if (data.event === "progress" && data.progress && typeof data.progress === "object") {
              const { files_completed: done, files_total: total } = data.progress;
              if (Number.isSafeInteger(done) && Number.isSafeInteger(total) && done >= 0 && total >= done) progress = `${done} / ${total}`;
            }
            this.update({ progress });
          }
        });
        if (!result || typeof result !== "object" || !("world" in result) || result.world !== this.options.world) fail("INVALID_PARAMS");
      } else await this.refresh(session, current);
      succeeded = true;
    } catch (error) { if (current()) this.update({ error: safeCode(error) }); }
    finally {
      try {
        if (session && action && current()) {
          if (freshRefresh) {
            if (close) await close();
            this.closeSession = null;
            if (current()) {
              session = await this.options.openSession();
              const refreshed = session; let closing: Promise<void> | null = null;
              close = () => closing ??= Promise.resolve().then(() => refreshed.close()).catch(() => undefined);
              this.closeSession = close;
            }
          }
          if (current()) await this.refresh(session, current);
        }
      } catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); }
      finally { if (close) await close(); if (this.closeSession === close) this.closeSession = null; this.pending = false; if (current()) this.update({ pending: false }); }
    }
    return succeeded && current();
  }
  load = () => this.run();
  install = (project: string, version: string, provider: "modrinth" | "curseforge" = "modrinth") => this.run((session, event) => {
    if (!validId(project) || !validId(version)) fail("INVALID_PARAMS");
    if (provider === "curseforge" && (!/^[1-9]\d*$/.test(project) || !/^[1-9]\d*$/.test(version))) fail("INVALID_PARAMS");
    const o = this.options;
    return session.datapacksInstall(o.directory, o.world, o.version, project, { provider, version_id: version, with_dependencies: true, store_directory: o.storeDirectory }, event);
  }, provider === "curseforge");
  setVersion = (project: string, version: string, provider: "modrinth" | "curseforge" = "modrinth") => this.run((session, event) => {
    if (hasAmbiguousContentProject(this.snapshot.content?.entries ?? [], project)) fail("CONTENT_PROJECT_AMBIGUOUS");
    if (!validId(project) || !validId(version)) fail("INVALID_PARAMS");
    if (provider === "curseforge" && (!/^[1-9]\d*$/.test(project) || !/^[1-9]\d*$/.test(version))) fail("INVALID_PARAMS");
    const o = this.options;
    return session.datapacksSetVersion(o.directory, o.world, o.version, project, version, { ...(provider === "curseforge" ? { provider } : {}), store_directory: o.storeDirectory }, event);
  }, provider === "curseforge");
  private selector(target: { file: string }) {
    if (!target.file.startsWith("datapacks/") || !validId(target.file.slice(10))) fail("INVALID_PARAMS");
    return { file: target.file }; // Exact world-relative registry identity, never basename or joined path.
  }
  toggle = (target: { file: string }, enabled: boolean) => this.run(session => {
    const o = this.options, selector = this.selector(target);
    return enabled ? session.datapacksEnable(o.directory, o.world, selector) : session.datapacksDisable(o.directory, o.world, selector);
  });
  remove = (target: { file: string }) => this.run(session => session.datapacksRemove(this.options.directory, this.options.world, this.selector(target)));
  adopt = () => this.run(session => session.datapacksAdopt(this.options.directory, this.options.world, this.options.storeDirectory));
}
export function useClientDatapacks(directory: string, world: string, version: string, storeDirectory: string) {
  const controller = useMemo(() => new ClientDatapackController({ directory, world, version, storeDirectory, openSession: () => CoreSession.open() }), [directory, world, version, storeDirectory]);
  useEffect(() => () => controller.cancel(), [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { snapshot, load: controller.load, install: controller.install, setVersion: controller.setVersion, toggle: controller.toggle, remove: controller.remove, adopt: controller.adopt, cancel: controller.cancel };
}
