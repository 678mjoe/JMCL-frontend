/**
 * This cache is advisory UI state. The core remains the final authority for
 * server lifecycle state and every lifecycle action.
 */
export type CachedServerLifecycle = "created" | "stopped" | "running" | "unknown";

export interface CachedServerStatus {
  state: CachedServerLifecycle;
  pid: number | null;
  supervisor_pid: number | null;
  java_path: string | null;
  started_at_ms: number | null;
  checked_at_ms: number;
  last_stale_cleanup_at_ms: number | null;
}

export interface ServerStatusCacheScope {
  directory: string;
  servers: Record<string, CachedServerStatus>;
}

export interface ServerStatusCacheV1 {
  schema_version: 1;
  scopes: Record<string, ServerStatusCacheScope>;
}

export interface ServerStartData {
  pid: number | null;
  supervisor_pid: number | null;
  java_path: string | null;
  started_at_ms: number | null;
}

export interface ServerStatusResponse {
  running: boolean;
  stale_state: boolean;
  pid?: number | null;
  supervisor_pid?: number | null;
  java_path?: string | null;
  started_at_ms?: number | null;
}

export function createEmptyServerStatusCache(): ServerStatusCacheV1 {
  return { schema_version: 1, scopes: {} };
}

export const canonicalEmptyServerStatusCache = createEmptyServerStatusCache;

function emptyStatus(
  state: CachedServerLifecycle,
  nowMs: number,
  lastStaleCleanupAtMs: number | null = null,
): CachedServerStatus {
  return {
    state,
    pid: null,
    supervisor_pid: null,
    java_path: null,
    started_at_ms: null,
    checked_at_ms: nowMs,
    last_stale_cleanup_at_ms: lastStaleCleanupAtMs,
  };
}

function withScope(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  update: (scope: ServerStatusCacheScope) => ServerStatusCacheScope,
): ServerStatusCacheV1 {
  const current = cache.scopes[scopeKey];
  const base = current?.directory === directory
    ? current
    : { directory, servers: {} };
  return {
    schema_version: 1,
    scopes: {
      ...cache.scopes,
      [scopeKey]: update({
        directory: base.directory,
        servers: { ...base.servers },
      }),
    },
  };
}

export function reconcileServerManifest(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverIds: Iterable<string>,
  _nowMs: number,
): ServerStatusCacheV1 {
  const ids = new Set(serverIds);
  return withScope(cache, scopeKey, directory, (scope) => ({
    directory,
    servers: Object.fromEntries(
      Object.entries(scope.servers).filter(([id]) => ids.has(id)),
    ),
  }));
}

export function reduceServerCreated(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  nowMs: number,
): ServerStatusCacheV1 {
  return withScope(cache, scopeKey, directory, (scope) => ({
    directory,
    servers: { ...scope.servers, [serverId]: emptyStatus("created", nowMs) },
  }));
}

export function reduceServerInstalled(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  nowMs: number,
): ServerStatusCacheV1 {
  return updateServer(cache, scopeKey, directory, serverId, emptyStatus("stopped", nowMs));
}

export function reduceServerStarted(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  data: ServerStartData,
  nowMs: number,
): ServerStatusCacheV1 {
  return updateServer(cache, scopeKey, directory, serverId, (previous) => ({
    ...data,
    state: "running",
    checked_at_ms: nowMs,
    last_stale_cleanup_at_ms: previous?.last_stale_cleanup_at_ms ?? null,
  }));
}

export const reduceServerRestarted = reduceServerStarted;

export function reduceServerStopped(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  nowMs: number,
): ServerStatusCacheV1 {
  return updateServer(cache, scopeKey, directory, serverId, (previous) =>
    emptyStatus("stopped", nowMs, previous?.last_stale_cleanup_at_ms ?? null));
}

export function reduceServerStatus(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  response: ServerStatusResponse,
  nowMs: number,
): ServerStatusCacheV1 {
  return updateServer(cache, scopeKey, directory, serverId, (previous) => {
    if (response.stale_state) {
      return response.running
        ? emptyStatus("unknown", nowMs, nowMs)
        : emptyStatus("stopped", nowMs, nowMs);
    }
    if (response.running) {
      return {
        state: "running",
        pid: response.pid ?? null,
        supervisor_pid: response.supervisor_pid ?? null,
        java_path: response.java_path ?? null,
        started_at_ms: response.started_at_ms ?? null,
        checked_at_ms: nowMs,
        last_stale_cleanup_at_ms: previous?.last_stale_cleanup_at_ms ?? null,
      };
    }
    return emptyStatus("stopped", nowMs, previous?.last_stale_cleanup_at_ms ?? null);
  });
}

export function reduceServerDeleted(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  _nowMs: number,
): ServerStatusCacheV1 {
  return withScope(cache, scopeKey, directory, (scope) => {
    const { [serverId]: _deleted, ...servers } = scope.servers;
    return { directory, servers };
  });
}

export type StableLifecycleErrorCode =
  | "SERVER_ALREADY_RUNNING"
  | "SERVER_NOT_RUNNING"
  | string;

export function reduceServerLifecycleError(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  code: StableLifecycleErrorCode,
  nowMs: number,
): ServerStatusCacheV1 {
  const state = code === "SERVER_ALREADY_RUNNING"
    ? "running"
    : code === "SERVER_NOT_RUNNING"
      ? "stopped"
      : "unknown";
  return updateServer(cache, scopeKey, directory, serverId, (previous) =>
    emptyStatus(state, nowMs, previous?.last_stale_cleanup_at_ms ?? null));
}

function updateServer(
  cache: ServerStatusCacheV1,
  scopeKey: string,
  directory: string,
  serverId: string,
  status: CachedServerStatus | ((previous: CachedServerStatus | undefined) => CachedServerStatus),
): ServerStatusCacheV1 {
  return withScope(cache, scopeKey, directory, (scope) => {
    const previous = scope.servers[serverId];
    return {
      directory,
      servers: {
        ...scope.servers,
        [serverId]: typeof status === "function" ? status(previous) : status,
      },
    };
  });
}
