import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { errorText, useLauncher } from "./launcher";
import { useServers, type ServerOperationScope } from "./servers";
import { useSettings } from "./settings";
import { withOpenedSession, type ClosableSession } from "./sessionLifecycle";
import type { InstallEvent, SessionEvent } from "./rpc";
import type { ServerLifecycleStartResult, ServerManifest, ServerManifestResult, ServerStopResult } from "./types";

export type ServerOperationKind = "install" | "start" | "stop" | "restart" | "delete";
export interface ServerOperation {
  kind: ServerOperationKind;
  pending: boolean;
  stage: "opening" | "downloading" | "finishing" | "running";
  progress: InstallEvent | null;
  error: string | null;
}

export interface ServerOperationsRpc extends ClosableSession {
  install(directory: string, id: string, options: { accept_eula: true; store_directory?: string }, onEvent?: (event: InstallEvent) => void): Promise<unknown>;
  get(directory: string, id: string): Promise<ServerManifestResult>;
  start(directory: string, id: string): Promise<ServerLifecycleStartResult>;
  stop(directory: string, id: string): Promise<ServerStopResult>;
  restart(directory: string, id: string): Promise<ServerLifecycleStartResult>;
  delete(directory: string, id: string): Promise<unknown>;
}

interface DirectoryController {
  captureOperationScope: () => ServerOperationScope | null;
  isOperationScopeCurrent: (scope: ServerOperationScope) => boolean;
  recordInstalled: (manifest: ServerManifest, scope: ServerOperationScope) => Promise<boolean>;
  recordStarted: (id: string, result: ServerLifecycleStartResult, scope: ServerOperationScope) => Promise<boolean>;
  recordStopped: (id: string, scope: ServerOperationScope) => Promise<boolean>;
  recordLifecycleError: (id: string, code: string, scope: ServerOperationScope) => Promise<boolean>;
  recordDeleted: (id: string, scope: ServerOperationScope) => Promise<boolean>;
}

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return null;
}

export function canInstallServer(manifest: ServerManifest, consent: boolean): boolean {
  return manifest.accept_eula || consent;
}

export class ServerOperationsController {
  private operations: Record<string, { id: string; scope: ServerOperationScope; operation: ServerOperation }> = {};
  private readonly listeners = new Set<() => void>();
  private readonly active = new Set<string>();
  constructor(private options: {
    openSession: () => Promise<ServerOperationsRpc>;
    directory: DirectoryController;
    storeDirectory?: string;
  }) {}
  setStoreDirectory(directory: string): void { this.options = { ...this.options, storeDirectory: directory }; }
  getSnapshot = () => this.operations;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private operationKey(id: string, scope: ServerOperationScope): string {
    return JSON.stringify([scope.directory, scope.sourceRevision, id]);
  }
  operationFor = (id: string) => {
    const scope = this.options.directory.captureOperationScope();
    if (!scope) return undefined;
    this.pruneSettled(scope);
    return this.operations[this.operationKey(id, scope)]?.operation;
  };
  private pruneSettled(currentScope?: ServerOperationScope) {
    const next = { ...this.operations };
    let changed = false;
    for (const [key, record] of Object.entries(next)) {
      const isCurrent = currentScope && record.scope.directory === currentScope.directory && record.scope.sourceRevision === currentScope.sourceRevision;
      if (!record.operation.pending && !isCurrent) { delete next[key]; changed = true; }
    }
    if (changed) this.operations = next;
  }
  private update(key: string, id: string, scope: ServerOperationScope, value: ServerOperation) {
    this.operations = { ...this.operations, [key]: { id, scope, operation: value } };
    for (const listener of this.listeners) listener();
  }
  private async run(id: string, kind: ServerOperationKind, action: (session: ServerOperationsRpc, scope: ServerOperationScope) => Promise<void>): Promise<boolean> {
    const scope = this.options.directory.captureOperationScope();
    if (!scope) return false;
    this.pruneSettled(scope);
    const key = this.operationKey(id, scope);
    if (this.active.has(key)) return false;
    this.active.add(key);
    this.update(key, id, scope, { kind, pending: true, stage: "opening", progress: null, error: null });
    let actionInvoked = false;
    let actionCompleted = false;
    try {
      try {
        await withOpenedSession(this.options.openSession, async (session) => {
          if (!this.options.directory.isOperationScopeCurrent(scope)) return;
          this.update(key, id, scope, { ...this.operations[key].operation, stage: "running" });
          actionInvoked = true;
          await action(session, scope);
          actionCompleted = true;
        });
      } catch (error) {
        if (!actionCompleted) throw error;
      }
      return actionInvoked;
    } catch (error) {
      const code = errorCode(error);
      if (actionInvoked && this.options.directory.isOperationScopeCurrent(scope) && ["start", "stop", "restart"].includes(kind)) {
        await this.options.directory.recordLifecycleError(id, code ?? "UNKNOWN", scope);
      }
      const current = this.operations[key]?.operation;
      if (current) this.update(key, id, scope, { ...current, pending: false, error: errorText(error) });
      throw error;
    } finally {
      this.active.delete(key);
      const current = this.operations[key]?.operation;
      if (current && current.pending) this.update(key, id, scope, { ...current, pending: false });
      if (!this.options.directory.isOperationScopeCurrent(scope)) {
        const next = { ...this.operations };
        delete next[key];
        this.operations = next;
        for (const listener of this.listeners) listener();
      } else {
        this.pruneSettled(scope);
      }
    }
  }
  install(manifest: ServerManifest, consent: boolean): Promise<boolean> {
    if (!canInstallServer(manifest, consent)) return Promise.reject(new Error("EULA consent is required"));
    return this.run(manifest.id, "install", async (session, scope) => {
      const key = this.operationKey(manifest.id, scope);
      const update = (operation: ServerOperation) => this.update(key, manifest.id, scope, operation);
      update({ ...this.operations[key].operation, stage: "downloading" });
      await session.install(scope.directory, manifest.id, { accept_eula: true, store_directory: this.options.storeDirectory || undefined }, (progress) => {
        const finishedDownload = progress.event === "progress" && progress.progress.files_total > 0 && progress.progress.files_completed >= progress.progress.files_total;
        const stage = finishedDownload || this.operations[key]?.operation.stage === "finishing" ? "finishing" : "downloading";
        update({ ...this.operations[key].operation, stage, progress });
      });
      if (!this.options.directory.isOperationScopeCurrent(scope)) return;
      update({ ...this.operations[key].operation, stage: "finishing" });
      const result = await session.get(scope.directory, manifest.id);
      if (this.options.directory.isOperationScopeCurrent(scope)) await this.options.directory.recordInstalled(result, scope);
    });
  }
  start(manifest: ServerManifest) { return this.run(manifest.id, "start", async (session, scope) => { const result = await session.start(scope.directory, manifest.id); if (this.options.directory.isOperationScopeCurrent(scope)) await this.options.directory.recordStarted(manifest.id, result, scope); }); }
  stop(manifest: ServerManifest) { return this.run(manifest.id, "stop", async (session, scope) => { await session.stop(scope.directory, manifest.id); if (this.options.directory.isOperationScopeCurrent(scope)) await this.options.directory.recordStopped(manifest.id, scope); }); }
  restart(manifest: ServerManifest) { return this.run(manifest.id, "restart", async (session, scope) => { const result = await session.restart(scope.directory, manifest.id); if (this.options.directory.isOperationScopeCurrent(scope)) await this.options.directory.recordStarted(manifest.id, result, scope); }); }
  delete(manifest: ServerManifest) { return this.run(manifest.id, "delete", async (session, scope) => { await session.delete(scope.directory, manifest.id); if (this.options.directory.isOperationScopeCurrent(scope)) await this.options.directory.recordDeleted(manifest.id, scope); }); }
}

export interface OperationsContextValue {
  operationFor: (id: string) => ServerOperation | undefined;
  install: (manifest: ServerManifest, consent: boolean) => Promise<boolean>;
  start: (manifest: ServerManifest) => Promise<boolean>;
  stop: (manifest: ServerManifest) => Promise<boolean>;
  restart: (manifest: ServerManifest) => Promise<boolean>;
  delete: (manifest: ServerManifest) => Promise<boolean>;
}
export const OperationsContext = createContext<OperationsContextValue | null>(null);

export function ServerOperationsProvider({ children }: { children: ReactNode }) {
  const { openSession } = useLauncher();
  const { storeDir } = useSettings().settings;
  const directory = useServers();
  const controller = useMemo(() => new ServerOperationsController({
    openSession: async () => {
      const session = await openSession();
      return {
        close: () => session.close(),
        install: (dir, id, options, event) => session.serverInstall(dir, id, options, (rpcEvent: SessionEvent<InstallEvent>) => {
          if (rpcEvent.kind === "event") event?.(rpcEvent.data);
        }),
        get: (dir, id) => session.serverGet(dir, id),
        start: (dir, id) => session.serverStart(dir, id),
        stop: (dir, id) => session.serverStop(dir, id),
        restart: (dir, id) => session.serverRestart(dir, id),
        delete: (dir, id) => session.serverDelete(dir, id),
      };
    }, directory, storeDirectory: storeDir,
  }), [directory.captureOperationScope, directory.isOperationScopeCurrent, directory.recordInstalled, directory.recordStarted, directory.recordStopped, directory.recordLifecycleError, directory.recordDeleted, openSession]);
  controller.setStoreDirectory(storeDir);
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const value: OperationsContextValue = {
    operationFor: (id) => controller.operationFor(id),
    install: useCallback((manifest, consent) => controller.install(manifest, consent), [controller]),
    start: useCallback((manifest) => controller.start(manifest), [controller]),
    stop: useCallback((manifest) => controller.stop(manifest), [controller]),
    restart: useCallback((manifest) => controller.restart(manifest), [controller]),
    delete: useCallback((manifest) => controller.delete(manifest), [controller]),
  };
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useServerOperations(): OperationsContextValue {
  const context = useContext(OperationsContext);
  if (!context) throw new Error("useServerOperations outside ServerOperationsProvider");
  return context;
}
