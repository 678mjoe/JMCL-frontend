import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CoreSession } from "./rpc";
import { useServers, type ServerOperationScope } from "./servers";
import { acquireServerTarget, useServerTargetBusy } from "./serverTargetLock";
import type { ServerBackupEntry, ServerManifest, ServerStatus, ServerWorldEntry, ServerWorldGetResult } from "./types";

export type ServerWorldsSession = Pick<CoreSession, "close" | "serverStatus" | "serverPropertiesGet" | "serverWorldsList" | "serverWorldsGet" | "serverWorldsRename" | "serverWorldsDelete" | "serverWorldsBackup" | "serverWorldsBackups" | "serverWorldsRestore">;
export interface ServerWorldsSnapshot {
  worlds: ServerWorldEntry[] | null; backups: ServerBackupEntry[] | null;
  detail: ServerWorldGetResult | null; baseWorld: string | null; status: ServerStatus | null;
  pending: boolean; error: string | null; refreshError: string | null;
}
const empty = (): ServerWorldsSnapshot => ({ worlds: null, backups: null, detail: null, baseWorld: null, status: null, pending: false, error: null, refreshError: null });
const codes = new Set(["BUSY", "INVALID_PARAMS", "SERVER_NOT_FOUND", "SERVER_ALREADY_RUNNING", "SERVER_STATUS_FAILED", "SERVER_PROPERTIES_NOT_FOUND", "SERVER_PROPERTIES_INVALID", "WORLD_NOT_FOUND", "WORLD_EXISTS", "WORLD_LOCKED", "BACKUP_NOT_FOUND", "WORLD_INVALID_LEVEL_DATA", "WORLD_ICON_TOO_LARGE", "WORLD_LIST_FAILED", "WORLD_GET_FAILED", "WORLD_RENAME_FAILED", "WORLD_DELETE_FAILED", "SSH_DISCONNECTED", "SSH_TIMEOUT", "SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED", "SSH_AUTH_REQUIRED_OR_FAILED", "UNSUPPORTED_PROTOCOL", "UNSUPPORTED_PLATFORM"]);
const safeCode = (error: unknown) => { const code = typeof error === "object" && error !== null && "code" in error ? error.code : null; return typeof code === "string" && codes.has(code) ? code : "UNKNOWN"; };
const fail = (code: string): never => { throw { code }; };
// Identifiers only: Core owns all filesystem paths and final platform validation.
const validName = (name: string) => !!name.trim() && name === name.trim() && name !== "." && name !== ".." && !/[\\/\0\r\n]/.test(name);

export class ServerWorldsController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending = false;
  private closeSession: (() => Promise<void>) | null = null;
  constructor(private options: { id: string; version: string; scope: ServerOperationScope | null; isScopeCurrent: (scope: ServerOperationScope) => boolean; openSession: () => Promise<ServerWorldsSession>; refreshStatus?: () => Promise<void> }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ServerWorldsSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  cancel = () => { this.generation++; void this.closeSession?.(); this.update(empty()); };
  private validateTarget(result: { id: string }) { if (result.id !== this.options.id) fail("INVALID_PARAMS"); }
  private async refresh(session: ServerWorldsSession, scope: ServerOperationScope, current: () => boolean) {
    // Independent reads let a missing properties file coexist with useful lists.
    const jobs = [
      async () => { const result = await session.serverWorldsList(scope.directory, this.options.id, this.options.version); this.validateTarget(result); if (current()) this.update({ worlds: result.worlds }); },
      async () => { const result = await session.serverWorldsBackups(scope.directory, this.options.id); this.validateTarget(result); if (current()) this.update({ backups: result.backups }); },
      async () => { const result = await session.serverPropertiesGet(scope.directory, this.options.id); this.validateTarget(result); if (current()) this.update({ baseWorld: result.properties["level-name"] ?? "world" }); },
      async () => { const result = await session.serverStatus(scope.directory, this.options.id); this.validateTarget(result); if (result.running !== true && result.running !== false) fail("SERVER_STATUS_FAILED"); if (current()) this.update({ status: result }); },
    ];
    if (current()) this.update({ worlds: null, backups: null, detail: null, baseWorld: null, status: null, refreshError: null });
    for (const job of jobs) { if (!current()) return; try { await job(); } catch (error) { if (current()) this.update({ refreshError: safeCode(error) }); } }
    if (current()) await this.options.refreshStatus?.().catch(() => undefined);
  }
  private async run(action: (session: ServerWorldsSession, scope: ServerOperationScope, current: () => boolean) => Promise<void>, mutation = false): Promise<boolean> {
    const scope = this.options.scope;
    if (this.pending || !scope || !this.options.isScopeCurrent(scope)) return false;
    const release = acquireServerTarget(scope, this.options.id);
    if (!release) { this.update({ error: "BUSY" }); return false; }
    this.pending = true;
    const generation = ++this.generation;
    const current = () => generation === this.generation && this.options.isScopeCurrent(scope);
    this.update({ pending: true, error: null, refreshError: null });
    let close: (() => Promise<void>) | null = null;
    let session: ServerWorldsSession | null = null;
    let succeeded = false;
    try {
      session = await this.options.openSession();
      const opened = session;
      let closing: Promise<void> | null = null;
      close = () => closing ??= Promise.resolve().then(() => opened.close()).catch(() => undefined);
      this.closeSession = close;
      if (!current()) return false;
      if (mutation) {
        const status = await session.serverStatus(scope.directory, this.options.id);
        if (!current()) return false;
        this.validateTarget(status);
        this.update({ status });
        if (status.running === true) fail("SERVER_ALREADY_RUNNING");
        if (status.running !== false) fail("SERVER_STATUS_FAILED");
      }
      await action(session, scope, current);
      succeeded = true;
    } catch (error) { if (current()) this.update({ error: safeCode(error) }); }
    finally {
      try {
        if (session && mutation && current()) await this.refresh(session, scope, current);
      } catch (error) {
        // A refresh failure must neither rewrite a confirmed result nor leak the lock.
        if (current()) this.update({ refreshError: safeCode(error) });
      } finally {
        try { if (close) await close(); }
        finally {
          if (this.closeSession === close) this.closeSession = null;
          this.pending = false; release();
          if (current()) this.update({ pending: false });
        }
      }
    }
    return succeeded && current();
  }
  load = () => this.run((session, scope, current) => this.refresh(session, scope, current));
  get = (world: string) => this.run(async (session, scope, current) => {
    if (!validName(world)) fail("INVALID_PARAMS");
    if (current()) this.update({ detail: null });
    const result = await session.serverWorldsGet(scope.directory, this.options.id, world, this.options.version);
    this.validateTarget(result);
    if (result.world.name !== world) fail("INVALID_PARAMS");
    if (current()) this.update({ detail: result });
  });
  rename = (world: string, newName: string, confirmation: string) => this.run(async (session, scope) => {
    if (!validName(world) || !validName(newName) || world === newName || confirmation !== world) fail("INVALID_PARAMS");
    await session.serverWorldsRename(scope.directory, this.options.id, world, newName);
  }, true);
  deleteWorld = (world: string, confirmation: string) => this.run(async (session, scope) => {
    if (!validName(world) || confirmation !== world) fail("INVALID_PARAMS");
    await session.serverWorldsDelete(scope.directory, this.options.id, world);
  }, true);
  backup = (label?: string) => this.run(async (session, scope) => {
    if (label && !validName(label)) fail("INVALID_PARAMS");
    await session.serverWorldsBackup(scope.directory, this.options.id, label ? { label } : {});
  }, true);
  restore = (backup: string, replace: boolean, confirmation: string) => this.run(async (session, scope) => {
    if (!validName(backup) || confirmation !== backup || typeof replace !== "boolean") fail("INVALID_PARAMS");
    await session.serverWorldsRestore(scope.directory, this.options.id, backup, replace);
  }, true);
}

export function useServerWorlds(server: ServerManifest) {
  const servers = useServers();
  const scope = servers.captureOperationScope();
  const scopeKey = JSON.stringify(scope);
  const controller = useMemo(() => new ServerWorldsController({ id: server.id, version: server.version_id, scope, isScopeCurrent: servers.isOperationScopeCurrent, openSession: servers.openSession, refreshStatus: () => servers.refreshServerStatus(server.id) }), [server.id, server.version_id, scopeKey, servers.isOperationScopeCurrent, servers.openSession, servers.refreshServerStatus]);
  useEffect(() => () => controller.cancel(), [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const busy = useServerTargetBusy(scope, server.id);
  return { snapshot: { ...snapshot, pending: snapshot.pending || busy }, load: controller.load, get: controller.get, rename: controller.rename, deleteWorld: controller.deleteWorld, backup: controller.backup, restore: controller.restore, cancel: controller.cancel };
}
