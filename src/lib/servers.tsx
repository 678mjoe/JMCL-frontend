import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readServerStatusCache, writeServerStatusCache } from "./native";
import { SessionOwner } from "./sessionLifecycle";
import { errorText, useLauncher } from "./launcher";
import {
  createEmptyServerStatusCache,
  reconcileServerManifest,
  reduceServerCreated,
  reduceServerDeleted,
  reduceServerInstalled,
  reduceServerLifecycleError,
  reduceServerStarted,
  reduceServerStopped,
  reduceServerStatus,
  type ServerStatusCacheV1,
} from "./serverStatusCache";
import { useSettings } from "./settings";
import type {
  ServerLifecycleStartResult,
  ServerListResult,
  ServerManifest,
  ServerStatus,
} from "./types";
import { CoreSession } from "./rpc";
import { useEndpointContext } from "./endpointContext";

export interface ServerControllerRpc {
  list: (directory: string) => Promise<ServerListResult>;
  status: (directory: string, id: string) => Promise<ServerStatus>;
  readCache: () => Promise<ServerStatusCacheV1>;
  writeCache: (cache: ServerStatusCacheV1) => Promise<void>;
}

export interface ServerControllerSnapshot {
  manifests: ServerManifest[];
  cache: ServerStatusCacheV1;
  loading: boolean;
  listError: string | null;
  statusErrors: Record<string, string>;
  pendingStatus: ReadonlySet<string>;
  directory: string;
}

interface SourceKey {
  readonly sessionKey: object | string;
  readonly endpointId: string;
  readonly kind: "local" | "ssh";
  readonly directory: string;
}

export interface ServerOperationScope {
  readonly endpointId: string;
  readonly kind: "local" | "ssh";
  readonly directory: string;
  readonly sourceRevision: number;
}

interface StartupResult {
  manifests: ServerManifest[];
  cache: ServerStatusCacheV1;
  listError: string | null;
}

// A settled pair is retained for the lifetime of its session. This is the
// narrow deduplication needed for React StrictMode remounts; explicit refresh
// operations never use this registry.
const startupRegistry = new Map<object | string, Map<string, Promise<StartupResult>>>();

function sortedManifests(manifests: ServerManifest[]): ServerManifest[] {
  const unique = new Map<string, ServerManifest>();
  for (const manifest of manifests) unique.set(manifest.id, manifest);
  return [...unique.values()].sort((left, right) =>
    left.id.localeCompare(right.id) || left.name.localeCompare(right.name));
}

function sameSource(left: SourceKey | null, right: SourceKey): boolean {
  return left?.sessionKey === right.sessionKey && left.endpointId === right.endpointId && left.kind === right.kind && left.directory === right.directory;
}

function getStartup(
  rpc: ServerControllerRpc,
  source: SourceKey,
  sourceRevision: number,
  cacheBarrier: Promise<void>,
  now: () => number,
): Promise<StartupResult> {
  const sourceId = JSON.stringify([source.endpointId, source.kind, source.directory, sourceRevision]);
  let byDirectory = startupRegistry.get(source.sessionKey);
  if (!byDirectory) {
    byDirectory = new Map();
    startupRegistry.set(source.sessionKey, byDirectory);
  }
  const existing = byDirectory.get(sourceId);
  if (existing) return existing;

  const startup = (async (): Promise<StartupResult> => {
    await cacheBarrier.catch(() => undefined);
    const loadedCache = await rpc.readCache().catch(() => createEmptyServerStatusCache());
    try {
      const result = await rpc.list(source.directory);
      const manifests = sortedManifests(result.servers);
      const cache = reconcileServerManifest(
        loadedCache,
        source.endpointId,
        source.directory,
        manifests.map((server) => server.id),
        now(),
      );
      return { manifests, cache, listError: null };
    } catch (error) {
      return { manifests: [], cache: loadedCache, listError: errorText(error) };
    }
  })();
  byDirectory.set(sourceId, startup);
  return startup;
}

export class ServerController {
  private source: SourceKey | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private revision = 0;
  private sourceRevision = 0;
  private manifestGeneration = 0;
  private nextListRequestId = 0;
  private activeListRequest: { id: number; sourceRevision: number; manifestGeneration: number } | null = null;
  private startupLoading = false;
  private readonly transitionGenerations = new Map<string, number>();
  private readonly statusRequestIds = new Map<string, number>();
  private nextStatusRequestId = 0;
  private snapshot: ServerControllerSnapshot = {
    manifests: [],
    cache: createEmptyServerStatusCache(),
    loading: false,
    listError: null,
    statusErrors: {},
    pendingStatus: new Set(),
    directory: "",
  };

  constructor(
    private rpc: ServerControllerRpc,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  replaceRpc(rpc: ServerControllerRpc): void {
    this.rpc = rpc;
  }

  getSnapshot = (): ServerControllerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ServerControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private enqueueCacheWrite(cache: ServerStatusCacheV1): Promise<void> {
    const write = this.writeQueue.catch(() => undefined).then(() => this.rpc.writeCache(cache));
    this.writeQueue = write.catch(() => undefined);
    // Cache persistence is advisory. Keep writes ordered, but let a failed
    // write settle before the next one without changing the core operation's result.
    return write.catch(() => undefined);
  }

  async start(source: SourceKey): Promise<void> {
    const capturedSource = Object.freeze({ ...source });
    if (sameSource(this.source, capturedSource)) return;
    this.revision += 1;
    this.sourceRevision += 1;
    this.manifestGeneration += 1;
    this.activeListRequest = null;
    this.startupLoading = true;
    this.source = capturedSource;
    this.transitionGenerations.clear();
    this.statusRequestIds.clear();
    const startupRevision = this.revision;
    const sourceRevision = this.sourceRevision;
    this.update({
      manifests: [],
      cache: createEmptyServerStatusCache(),
      loading: true,
      listError: null,
      statusErrors: {},
      pendingStatus: new Set(),
      directory: capturedSource.directory,
    });
    const result = await getStartup(this.rpc, capturedSource, sourceRevision, this.writeQueue, this.now);
    if (!sameSource(this.source, capturedSource) || this.sourceRevision !== sourceRevision) return;
    this.startupLoading = false;
    const manifests = startupRevision === this.revision
      ? result.manifests
      : sortedManifests([...result.manifests, ...this.snapshot.manifests]);
    const cache = startupRevision === this.revision
      ? result.cache
      : reconcileServerManifest(
        this.snapshot.cache,
        capturedSource.endpointId,
        capturedSource.directory,
        manifests.map((server) => server.id),
        this.now(),
      );
    this.update({
      manifests,
      cache,
      loading: false,
      listError: result.listError,
    });
    if (!result.listError) await this.enqueueCacheWrite(cache);
  }

  setUnavailable(directory: string, error: string | null): void {
    if (this.source === null && this.snapshot.directory === directory && this.snapshot.listError === error) return;
    this.source = null;
    this.revision += 1;
    this.sourceRevision += 1;
    this.manifestGeneration += 1;
    this.activeListRequest = null;
    this.startupLoading = false;
    this.transitionGenerations.clear();
    this.statusRequestIds.clear();
    this.update({
      manifests: [],
      cache: createEmptyServerStatusCache(),
      loading: false,
      listError: error,
      statusErrors: {},
      pendingStatus: new Set(),
      directory,
    });
  }

  async refreshList(): Promise<void> {
    const source = this.source;
    if (!source) return;
    const request = {
      id: ++this.nextListRequestId,
      sourceRevision: this.sourceRevision,
      manifestGeneration: this.manifestGeneration,
    };
    this.activeListRequest = request;
    this.update({ loading: true, listError: null });
    const isApplicable = () => this.activeListRequest?.id === request.id
      && this.sourceRevision === request.sourceRevision
      && sameSource(this.source, source)
      && this.manifestGeneration === request.manifestGeneration;
    try {
      const result = await this.rpc.list(source.directory);
      if (!isApplicable()) return;
      const manifests = sortedManifests(result.servers);
      const cache = reconcileServerManifest(
        this.snapshot.cache,
        source.endpointId,
        source.directory,
        manifests.map((server) => server.id),
        this.now(),
      );
      this.activeListRequest = null;
      this.update({ manifests, cache, loading: this.startupLoading, listError: null });
      this.revision += 1;
      await this.enqueueCacheWrite(cache);
    } catch (error) {
      if (!isApplicable()) return;
      this.activeListRequest = null;
      this.update({ loading: this.startupLoading, listError: errorText(error) });
    }
  }

  async refreshServerStatus(id: string): Promise<void> {
    const source = this.source;
    if (!source) return;
    const sourceRevision = this.sourceRevision;
    const transitionGeneration = this.transitionGenerations.get(id) ?? 0;
    const requestId = ++this.nextStatusRequestId;
    this.statusRequestIds.set(id, requestId);
    const pendingStatus = new Set(this.snapshot.pendingStatus);
    pendingStatus.add(id);
    this.update({ pendingStatus });
    const isCurrentRequest = () => this.statusRequestIds.get(id) === requestId;
    const isApplicable = () => isCurrentRequest()
      && this.sourceRevision === sourceRevision
      && this.source?.endpointId === source.endpointId
      && this.source.kind === source.kind
      && this.source.directory === source.directory
      && (this.transitionGenerations.get(id) ?? 0) === transitionGeneration;
    try {
      const result = await this.rpc.status(source.directory, id);
      if (!isApplicable()) return;
      const cache = reduceServerStatus(
        this.snapshot.cache,
        source.endpointId,
        source.directory,
        id,
        result,
        this.now(),
      );
      const statusErrors = { ...this.snapshot.statusErrors };
      delete statusErrors[id];
      this.update({ cache, statusErrors });
      this.revision += 1;
      await this.enqueueCacheWrite(cache);
    } catch (error) {
      if (!isApplicable()) return;
      const statusErrors = {
        ...this.snapshot.statusErrors,
        [id]: errorText(error),
      };
      this.update({ statusErrors });
    } finally {
      if (isCurrentRequest()) {
        this.statusRequestIds.delete(id);
        const remaining = new Set(this.snapshot.pendingStatus);
        remaining.delete(id);
        this.update({ pendingStatus: remaining });
      }
    }
  }

  async recordCreated(manifest: ServerManifest, scope = this.captureOperationScope()): Promise<void> {
    if (!scope || !this.isOperationScopeCurrent(scope)) return;
    const source = this.source;
    if (!source) return;
    this.invalidateExplicitList();
    const manifests = sortedManifests([
      ...this.snapshot.manifests.filter((item) => item.id !== manifest.id),
      manifest,
    ]);
    const cache = reduceServerCreated(
      this.snapshot.cache,
      source.endpointId,
      source.directory,
      manifest.id,
      this.now(),
    );
    this.update({ manifests, cache, listError: null });
    this.revision += 1;
    await this.enqueueCacheWrite(cache);
  }

  captureOperationScope(): ServerOperationScope | null {
    return this.source ? { endpointId: this.source.endpointId, kind: this.source.kind, directory: this.source.directory, sourceRevision: this.sourceRevision } : null;
  }

  isOperationScopeCurrent(scope: ServerOperationScope): boolean {
    return this.source?.endpointId === scope.endpointId && this.source.kind === scope.kind && this.source.directory === scope.directory && this.sourceRevision === scope.sourceRevision;
  }

  private async transition(id: string, scope: ServerOperationScope, update: (cache: ServerStatusCacheV1) => ServerStatusCacheV1): Promise<boolean> {
    if (!this.isOperationScopeCurrent(scope)) return false;
    this.invalidateExplicitList();
    this.transitionGenerations.set(id, (this.transitionGenerations.get(id) ?? 0) + 1);
    this.statusRequestIds.delete(id);
    const pendingStatus = new Set(this.snapshot.pendingStatus);
    pendingStatus.delete(id);
    const statusErrors = { ...this.snapshot.statusErrors };
    delete statusErrors[id];
    const cache = update(this.snapshot.cache);
    this.update({ cache, pendingStatus, statusErrors });
    this.revision += 1;
    await this.enqueueCacheWrite(cache);
    return true;
  }

  private invalidateExplicitList(): void {
    this.manifestGeneration += 1;
    if (!this.activeListRequest) return;
    this.activeListRequest = null;
    this.update({ loading: this.startupLoading });
  }

  async recordInstalled(manifest: ServerManifest, scope: ServerOperationScope): Promise<boolean> {
    if (!this.isOperationScopeCurrent(scope)) return false;
    const manifests = sortedManifests([...this.snapshot.manifests.filter((item) => item.id !== manifest.id), manifest]);
    this.update({ manifests, listError: null });
    return this.transition(manifest.id, scope, (cache) =>
      reduceServerInstalled(cache, scope.endpointId, scope.directory, manifest.id, this.now()));
  }

  recordStarted(id: string, result: ServerLifecycleStartResult, scope: ServerOperationScope): Promise<boolean> {
    return this.transition(id, scope, (cache) => reduceServerStarted(cache, scope.endpointId, scope.directory, id, {
      pid: result.pid, supervisor_pid: result.supervisor_pid, java_path: result.java_path, started_at_ms: result.started_at_ms,
    }, this.now()));
  }

  recordStopped(id: string, scope: ServerOperationScope): Promise<boolean> {
    return this.transition(id, scope, (cache) => reduceServerStopped(cache, scope.endpointId, scope.directory, id, this.now()));
  }

  recordLifecycleError(id: string, code: string, scope: ServerOperationScope): Promise<boolean> {
    return this.transition(id, scope, (cache) => reduceServerLifecycleError(cache, scope.endpointId, scope.directory, id, code, this.now()));
  }

  async recordDeleted(id: string, scope: ServerOperationScope): Promise<boolean> {
    if (!this.isOperationScopeCurrent(scope)) return false;
    const manifests = this.snapshot.manifests.filter((item) => item.id !== id);
    this.update({ manifests });
    return this.transition(id, scope, (cache) => reduceServerDeleted(cache, scope.endpointId, scope.directory, id, this.now()));
  }
}

export function createServerController(
  rpc: ServerControllerRpc,
  options: { now?: () => number } = {},
): ServerController {
  return new ServerController(rpc, options);
}

export interface ServersContextValue extends ServerControllerSnapshot {
  refreshList: () => Promise<void>;
  refreshServerStatus: (id: string) => Promise<void>;
  recordCreated: (manifest: ServerManifest, scope?: ServerOperationScope) => Promise<void>;
  captureOperationScope: () => ServerOperationScope | null;
  isOperationScopeCurrent: (scope: ServerOperationScope) => boolean;
  recordInstalled: (manifest: ServerManifest, scope: ServerOperationScope) => Promise<boolean>;
  recordStarted: (id: string, result: ServerLifecycleStartResult, scope: ServerOperationScope) => Promise<boolean>;
  recordStopped: (id: string, scope: ServerOperationScope) => Promise<boolean>;
  recordLifecycleError: (id: string, code: string, scope: ServerOperationScope) => Promise<boolean>;
  recordDeleted: (id: string, scope: ServerOperationScope) => Promise<boolean>;
  coreStatus: "starting" | "ready" | "error";
  coreError: string | null;
  endpointId: string;
  openSession: () => Promise<CoreSession>;
}

export const ServersContext = createContext<ServersContextValue | null>(null);

function rpcForSession(session: CoreSession): ServerControllerRpc {
  return {
    list: (directory) => session.serverList(directory),
    status: (directory, id) => session.serverStatus(directory, id),
    readCache: readServerStatusCache,
    writeCache: writeServerStatusCache,
  };
}

export function ServersProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { selectedEndpoint: endpoint, loading: endpointLoading, error: endpointError } = useEndpointContext();
  const { error: launcherError } = useLauncher();
  const [controlStatus, setControlStatus] = useState<"starting" | "ready" | "error">("starting");
  const [controlError, setControlError] = useState<string | null>(null);
  const openSession = useCallback(() => endpoint
    ? CoreSession.openEndpoint(endpoint)
    : Promise.reject(new Error(endpointError ?? "Server endpoint is unavailable")), [endpoint, endpointError]);
  const controllerRef = useRef<ServerController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ServerController({
      list: () => Promise.reject(new Error("Core is not ready")),
      status: () => Promise.reject(new Error("Core is not ready")),
      readCache: readServerStatusCache,
      writeCache: writeServerStatusCache,
    });
  }
  const controller = controllerRef.current;
  const controlSessionOwner = useRef(new SessionOwner<CoreSession>()).current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const sourceDirectory = endpoint?.kind === "ssh" ? endpoint.serversDirectory ?? "" : settings.serversDir;
  useEffect(() => {
    let cancelled = false;
    if (endpointLoading) return;
    if (!endpoint || !sourceDirectory) {
      setControlStatus("error");
      setControlError(endpointError ?? (endpoint ? "Server directory is unavailable" : "Selected server endpoint is unavailable"));
      controller.setUnavailable(sourceDirectory, endpointError ?? (endpoint ? "Server directory is unavailable" : "Selected server endpoint is unavailable"));
      return;
    }
    setControlStatus("starting");
    setControlError(null);
    controller.setUnavailable(sourceDirectory, null);
    void controlSessionOwner.open(() => CoreSession.openEndpoint(endpoint)).then(async (opened) => {
      if (cancelled || !opened) return;
      controller.replaceRpc(rpcForSession(opened));
      setControlStatus("ready");
      await controller.start({ sessionKey: opened, endpointId: endpoint.id, kind: endpoint.kind, directory: sourceDirectory });
    }).catch((error) => {
      if (!cancelled) {
        const message = errorText(error);
        setControlStatus("error");
        setControlError(message);
        controller.setUnavailable(sourceDirectory, message);
      }
    });
    return () => {
      cancelled = true;
      controller.setUnavailable(sourceDirectory, null);
      void controlSessionOwner.close().catch(() => undefined);
    };
  }, [controlSessionOwner, controller, endpoint, endpointError, endpointLoading, sourceDirectory]);

  const refreshList = useCallback(() => controller.refreshList(), [controller]);
  const refreshServerStatus = useCallback((id: string) => controller.refreshServerStatus(id), [controller]);
  const recordCreated = useCallback((manifest: ServerManifest, scope?: ServerOperationScope) => controller.recordCreated(manifest, scope), [controller]);
  const captureOperationScope = useCallback(() => controller.captureOperationScope(), [controller]);
  const isOperationScopeCurrent = useCallback((scope: ServerOperationScope) => controller.isOperationScopeCurrent(scope), [controller]);
  const recordInstalled = useCallback((manifest: ServerManifest, scope: ServerOperationScope) => controller.recordInstalled(manifest, scope), [controller]);
  const recordStarted = useCallback((id: string, result: ServerLifecycleStartResult, scope: ServerOperationScope) => controller.recordStarted(id, result, scope), [controller]);
  const recordStopped = useCallback((id: string, scope: ServerOperationScope) => controller.recordStopped(id, scope), [controller]);
  const recordLifecycleError = useCallback((id: string, code: string, scope: ServerOperationScope) => controller.recordLifecycleError(id, code, scope), [controller]);
  const recordDeleted = useCallback((id: string, scope: ServerOperationScope) => controller.recordDeleted(id, scope), [controller]);
  const value: ServersContextValue = {
    ...snapshot,
    refreshList,
    refreshServerStatus,
    recordCreated,
    captureOperationScope, isOperationScopeCurrent, recordInstalled, recordStarted,
    recordStopped, recordLifecycleError, recordDeleted,
    coreStatus: endpointLoading ? "starting" : controlStatus,
    coreError: controlError ?? endpointError ?? launcherError,
    endpointId: endpoint?.id ?? "local",
    openSession,
  };
  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

export function useServers(): ServersContextValue {
  const context = useContext(ServersContext);
  if (!context) throw new Error("useServers outside ServersProvider");
  return context;
}
