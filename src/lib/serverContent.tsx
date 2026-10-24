import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CoreSession, InstallEvent, SessionEvent, ServerContentTarget } from "./rpc";
import { useServers, type ServerOperationScope } from "./servers";
import { acquireServerTarget, useServerTargetBusy } from "./serverTargetLock";
import type { ServerContentListResult, ServerManifest, ServerStatus } from "./types";

export type ServerContentKind = "mods" | "datapacks";
export type ServerContentSession = Pick<CoreSession, "close" | "serverGet" | "serverStatus" | "serverModsList" | "serverModsInstall" | "serverModsSetVersion" | "serverModsEnable" | "serverModsDisable" | "serverModsRemove" | "serverModsAdopt" | "serverDatapacksList" | "serverDatapacksInstall" | "serverDatapacksSetVersion" | "serverDatapacksEnable" | "serverDatapacksDisable" | "serverDatapacksRemove" | "serverDatapacksAdopt">;
export interface ServerContentSnapshot {
  content: ServerContentListResult | null; status: ServerStatus | null;
  pending: boolean; error: string | null; refreshError: string | null; progress: string | null;
}
const empty = (): ServerContentSnapshot => ({ content: null, status: null, pending: false, error: null, refreshError: null, progress: null });
const codes = new Set(["BUSY", "INVALID_PARAMS", "SERVER_NOT_FOUND", "SERVER_ALREADY_RUNNING", "SERVER_STATUS_FAILED", "SERVER_LOADER_REQUIRED", "SERVER_PROPERTIES_INVALID", "CONTENT_NOT_FOUND", "NO_COMPATIBLE_VERSION", "INCOMPATIBLE_VERSION", "VERSION_PROJECT_MISMATCH", "CONTENT_CONFLICT", "CONTENT_KIND_MISMATCH", "UNSUPPORTED_PROJECT_TYPE", "DOWNLOAD_UNAVAILABLE", "HTTP_STATUS_ERROR", "RESPONSE_TOO_LARGE", "CONTENT_LIST_FAILED", "SERVER_CONTENT_INSTALL_FAILED", "SERVER_CONTENT_SET_VERSION_FAILED", "SERVER_CONTENT_TOGGLE_FAILED", "SERVER_CONTENT_REMOVE_FAILED", "SERVER_CONTENT_ADOPT_FAILED", "SERVER_DATAPACKS_INSTALL_FAILED", "SERVER_DATAPACKS_SET_VERSION_FAILED", "SERVER_DATAPACKS_TOGGLE_FAILED", "SERVER_DATAPACKS_REMOVE_FAILED", "SERVER_DATAPACKS_ADOPT_FAILED", "SSH_DISCONNECTED", "SSH_TIMEOUT", "SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED", "SSH_AUTH_REQUIRED_OR_FAILED", "UNSUPPORTED_PROTOCOL", "UNSUPPORTED_PLATFORM"]);
const safeCode = (error: unknown) => { const code = typeof error === "object" && error !== null && "code" in error ? error.code : null; return typeof code === "string" && codes.has(code) ? code : "UNKNOWN"; };
const fail = (code: string): never => { throw { code }; };
const validIdentifier = (value: string) => !!value.trim() && value === value.trim() && value !== "." && value !== ".." && !/[\\/\0\r\n]/.test(value);
export function serverContentLoader(server: ServerManifest): "fabric" | "neoforge" | "forge" | null {
  return server.fabric_loader ? "fabric" : server.neoforge_version ? "neoforge" : server.forge_version ? "forge" : null;
}

export class ServerContentController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending = false;
  private closeSession: (() => Promise<void>) | null = null;
  constructor(private options: { id: string; kind: ServerContentKind; scope: ServerOperationScope | null; isScopeCurrent: (scope: ServerOperationScope) => boolean; openSession: () => Promise<ServerContentSession>; refreshStatus?: () => Promise<void> }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ServerContentSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  cancel = () => { this.generation++; void this.closeSession?.(); this.update(empty()); };
  private validateTarget(result: { id: string }) { if (result.id !== this.options.id) fail("INVALID_PARAMS"); }
  private async refresh(session: ServerContentSession, scope: ServerOperationScope, current: () => boolean) {
    if (current()) this.update({ content: null, status: null, refreshError: null });
    try {
      const result = await (this.options.kind === "mods" ? session.serverModsList(scope.directory, this.options.id) : session.serverDatapacksList(scope.directory, this.options.id));
      this.validateTarget(result);
      if (result.stage !== `server.${this.options.kind}.list`) fail("INVALID_PARAMS");
      if (current()) this.update({ content: result });
    } catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); }
    if (!current()) return;
    try {
      const status = await session.serverStatus(scope.directory, this.options.id);
      this.validateTarget(status);
      if (typeof status.running !== "boolean") fail("SERVER_STATUS_FAILED");
      if (current()) this.update({ status });
    } catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); }
    if (current()) await this.options.refreshStatus?.().catch(() => undefined);
  }
  private async run(action: (session: ServerContentSession, scope: ServerOperationScope, event: (event: SessionEvent<InstallEvent>) => void) => Promise<unknown>, mutation = true, requireLoader = false): Promise<boolean> {
    const scope = this.options.scope;
    if (this.pending || !scope || !this.options.isScopeCurrent(scope)) return false;
    const release = acquireServerTarget(scope, this.options.id);
    if (!release) { this.update({ error: "BUSY" }); return false; }
    this.pending = true;
    const generation = ++this.generation;
    const current = () => generation === this.generation && this.options.isScopeCurrent(scope);
    this.update({ pending: true, error: null, refreshError: null, progress: null });
    let close: (() => Promise<void>) | null = null;
    let session: ServerContentSession | null = null;
    let succeeded = false;
    try {
      session = await this.options.openSession();
      const opened = session;
      let closing: Promise<void> | null = null;
      close = () => closing ??= Promise.resolve().then(() => opened.close()).catch(() => undefined);
      this.closeSession = close;
      if (!current()) return false;
      if (mutation) {
        const manifest = await session.serverGet(scope.directory, this.options.id);
        if (!current()) return false;
        this.validateTarget(manifest);
        if (requireLoader && this.options.kind === "mods" && !serverContentLoader(manifest)) fail("SERVER_LOADER_REQUIRED");
        const status = await session.serverStatus(scope.directory, this.options.id);
        if (!current()) return false;
        this.validateTarget(status);
        this.update({ status });
        if (status.running === true) fail("SERVER_ALREADY_RUNNING");
        if (status.running !== false) fail("SERVER_STATUS_FAILED");
        const result = await action(session, scope, (event) => {
          // Never retain raw file paths, URLs, messages or request payloads.
          if (!current() || event.kind !== "event") return;
          const data = event.data;
          if (["started", "file", "retry", "progress"].includes(data.event)) {
            let progress: string = data.event;
            if (data.event === "progress") {
              const { files_completed: completed, files_total: total } = data.progress;
              if (Number.isSafeInteger(completed) && Number.isSafeInteger(total) && completed >= 0 && total >= completed) progress = `${completed} / ${total}`;
            }
            this.update({ progress });
          }
        });
        if (result && typeof result === "object" && "id" in result) this.validateTarget(result as { id: string });
      } else await this.refresh(session, scope, current);
      succeeded = true;
    } catch (error) { if (current()) this.update({ error: safeCode(error) }); }
    finally {
      try { if (session && mutation && current()) await this.refresh(session, scope, current); }
      catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); }
      finally {
        try { if (close) await close(); }
        finally { if (this.closeSession === close) this.closeSession = null; this.pending = false; release(); if (current()) this.update({ pending: false }); }
      }
    }
    return succeeded && current();
  }
  load = () => this.run(async () => {}, false);
  install = (project: string, versionId: string) => this.run((session, scope, event) => {
    if (!validIdentifier(project) || !validIdentifier(versionId)) fail("INVALID_PARAMS");
    const options = { provider: "modrinth" as const, version_id: versionId, with_dependencies: true };
    return this.options.kind === "mods" ? session.serverModsInstall(scope.directory, this.options.id, project, options, event) : session.serverDatapacksInstall(scope.directory, this.options.id, project, options, event);
  }, true, true);
  setVersion = (project: string, versionId: string) => this.run((session, scope, event) => {
    if (!validIdentifier(project) || !validIdentifier(versionId)) fail("INVALID_PARAMS");
    return this.options.kind === "mods" ? session.serverModsSetVersion(scope.directory, this.options.id, project, versionId, {}, event) : session.serverDatapacksSetVersion(scope.directory, this.options.id, project, versionId, {}, event);
  });
  private validateSelector(target: ServerContentTarget) {
    const project = "project" in target ? target.project : undefined;
    const file = "file" in target ? target.file : undefined;
    if (!!project === !!file) fail("INVALID_PARAMS");
    if (project && !validIdentifier(project)) fail("INVALID_PARAMS");
    // Core registry selectors are exact relative paths, not basenames. Preserve
    // the kind prefix; never join them to a local or remote filesystem root.
    if (file && (!file.startsWith(`${this.options.kind}/`) || !validIdentifier(file.slice(this.options.kind.length + 1)))) fail("INVALID_PARAMS");
    return project ? { project } : { file: file! };
  }
  toggle = (target: ServerContentTarget, enabled: boolean) => this.run((session, scope) => {
    const selector = this.validateSelector(target);
    if (typeof enabled !== "boolean") fail("INVALID_PARAMS");
    if (this.options.kind === "mods") return enabled ? session.serverModsEnable(scope.directory, this.options.id, selector) : session.serverModsDisable(scope.directory, this.options.id, selector);
    return enabled ? session.serverDatapacksEnable(scope.directory, this.options.id, selector) : session.serverDatapacksDisable(scope.directory, this.options.id, selector);
  });
  remove = (target: ServerContentTarget) => this.run((session, scope) => {
    const selector = this.validateSelector(target);
    return this.options.kind === "mods" ? session.serverModsRemove(scope.directory, this.options.id, selector) : session.serverDatapacksRemove(scope.directory, this.options.id, selector);
  });
  adopt = () => this.run((session, scope) => this.options.kind === "mods" ? session.serverModsAdopt(scope.directory, this.options.id) : session.serverDatapacksAdopt(scope.directory, this.options.id));
}
export function useServerContent(server: ServerManifest, kind: ServerContentKind) {
  const servers = useServers();
  const scope = servers.captureOperationScope();
  const scopeKey = JSON.stringify(scope);
  const controller = useMemo(() => new ServerContentController({ id: server.id, kind, scope, isScopeCurrent: servers.isOperationScopeCurrent, openSession: servers.openSession, refreshStatus: () => servers.refreshServerStatus(server.id) }), [server.id, kind, scopeKey, servers.isOperationScopeCurrent, servers.openSession, servers.refreshServerStatus]);
  useEffect(() => () => controller.cancel(), [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const busy = useServerTargetBusy(scope, server.id);
  return { snapshot: { ...snapshot, pending: snapshot.pending || busy }, load: controller.load, install: controller.install, setVersion: controller.setVersion, toggle: controller.toggle, remove: controller.remove, adopt: controller.adopt, cancel: controller.cancel };
}
