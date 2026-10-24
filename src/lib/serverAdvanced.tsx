import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CoreSession } from "./rpc";
import { useServers, type ServerOperationScope } from "./servers";
import { acquireServerTarget, useServerTargetBusy } from "./serverTargetLock";
import type { ServerManifest, ServerProperties, ServerPropertiesResult, ServerQueryMode, ServerQueryResult, ServerRconResult } from "./types";

export type ServerAdvancedSession = Pick<CoreSession, "close" | "serverStatus" | "serverPropertiesGet" | "serverPropertiesSet" | "serverRconCommand" | "serverQuery">;
export interface ServerAdvancedSnapshot {
  properties: ServerPropertiesResult | null;
  query: ServerQueryResult | null;
  rcon: ServerRconResult | null;
  pending: boolean;
  error: string | null;
}
const empty = (): ServerAdvancedSnapshot => ({ properties: null, query: null, rcon: null, pending: false, error: null });
// Only allowlisted codes are retained, not arbitrary error messages/codes that
// could carry credentials, request bodies, hostnames or transport diagnostics.
const codes = new Set([
  "INVALID_PARAMS", "BUSY", "SERVER_NOT_FOUND", "SERVER_NOT_INSTALLED", "SERVER_ALREADY_RUNNING", "SERVER_NOT_RUNNING", "SERVER_STATUS_FAILED",
  "SERVER_PROPERTIES_NOT_FOUND", "SERVER_PROPERTIES_INVALID", "SERVER_RCON_DISABLED", "SERVER_QUERY_DISABLED", "SERVER_RCON_AUTH_FAILED",
  "SERVER_RCON_UNAVAILABLE", "SERVER_QUERY_UNAVAILABLE", "SERVER_RCON_PROTOCOL_ERROR", "SERVER_QUERY_PROTOCOL_ERROR", "JAVA_NOT_FOUND", "JAVA_INCOMPATIBLE",
  "SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED", "SSH_AUTH_REQUIRED_OR_FAILED", "SSH_INTERACTIVE_AUTH_UNSUPPORTED", "SSH_TIMEOUT", "SSH_DISCONNECTED", "UNSUPPORTED_PROTOCOL", "UNSUPPORTED_PLATFORM",
]);
function safeCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return typeof code === "string" && codes.has(code) ? code : "UNKNOWN";
}
function fail(code: string): never { throw { code }; }
/** Explicit deltas only. The core merges these, preserving unknown properties. */
export function validatePropertyChanges(changes: ServerProperties): ServerProperties {
  const entries = Object.entries(changes);
  if (!entries.length || entries.some(([key, value]) => !key.trim() || /[\r\n=:\s\0]/.test(key) || key.toLowerCase() === "rcon.password" || typeof value !== "string" || /[\r\n\0]/.test(value))) fail("INVALID_PARAMS");
  return Object.fromEntries(entries);
}
function redactedProperties(result: ServerPropertiesResult): ServerPropertiesResult {
  const properties = { ...result.properties };
  for (const key of Object.keys(properties)) {
    if (key.toLowerCase() === "rcon.password") properties[key] = "<redacted>";
  }
  return { ...result, properties };
}

/** Ephemeral panel state. No settings, task store, logging or telemetry. */
export class ServerAdvancedController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending = false;
  private closeSession: (() => Promise<void>) | null = null;
  private clearSecret: (() => void) | null = null;
  constructor(private options: {
    id: string;
    scope: ServerOperationScope | null;
    isScopeCurrent: (scope: ServerOperationScope) => boolean;
    openSession: () => Promise<ServerAdvancedSession>;
  }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<ServerAdvancedSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; for (const listener of this.listeners) listener(); }
  private current(generation: number): boolean { return generation === this.generation && this.options.scope !== null && this.options.isScopeCurrent(this.options.scope); }
  cancel = () => {
    this.generation += 1;
    this.clearSecret?.();
    this.clearSecret = null;
    void this.closeSession?.();
    // Cancellation invalidates UI, not an already dispatched physical mutation.
    // The shared lock remains held until the request AND cleanup settle.
    this.update(empty());
  };
  private async run(action: (session: ServerAdvancedSession, scope: ServerOperationScope, current: () => boolean) => Promise<Partial<ServerAdvancedSnapshot>>, cleanup?: () => void): Promise<boolean> {
    const scope = this.options.scope;
    if (this.pending || !scope || !this.options.isScopeCurrent(scope)) { cleanup?.(); return false; }
    const release = acquireServerTarget(scope, this.options.id);
    if (!release) { cleanup?.(); this.update({ error: "BUSY" }); return false; }
    this.pending = true;
    this.clearSecret = cleanup ?? null;
    const generation = ++this.generation;
    const current = () => this.current(generation);
    this.update({ pending: true, error: null });
    let session: ServerAdvancedSession | null = null;
    let close: (() => Promise<void>) | null = null;
    try {
      session = await this.options.openSession();
      const opened = session;
      let closing: Promise<void> | null = null;
      close = () => closing ??= opened.close().catch(() => undefined);
      this.closeSession = close;
      if (!current()) return false;
      const result = await action(session, scope, current);
      if (!current()) return false;
      this.update(result);
      return true;
    } catch (error) {
      if (current()) this.update({ error: safeCode(error) });
      return false;
    } finally {
      cleanup?.();
      this.clearSecret = null;
      if (close) await close();
      if (this.closeSession === close) this.closeSession = null;
      this.pending = false;
      release();
      if (current()) this.update({ pending: false });
    }
  }
  loadProperties = () => this.run(async (session, scope) => ({ properties: redactedProperties(await session.serverPropertiesGet(scope.directory, this.options.id)) }));
  saveProperties = (input: ServerProperties): Promise<boolean> => {
    let changes: ServerProperties;
    try { changes = validatePropertyChanges(input); } catch (error) { this.update({ error: safeCode(error) }); return Promise.resolve(false); }
    return this.run(async (session, scope, current) => {
      const status = await session.serverStatus(scope.directory, this.options.id);
      if (!current()) return {};
      if (status.running) fail("SERVER_ALREADY_RUNNING");
      // Fail closed on malformed / unknown authority, not merely falsy running.
      if (status.running !== false) fail("SERVER_STATUS_FAILED");
      return { properties: redactedProperties(await session.serverPropertiesSet(scope.directory, this.options.id, changes)) };
    });
  };
  rcon = (command: string, password: string): Promise<boolean> => {
    // Mutable private holder permits clearing while an asynchronous open/status
    // is pending. Never capture the password string in the request callback.
    const secret = { value: password };
    password = "";
    const clear = () => { secret.value = ""; };
    if (!command.trim() || /[\r\n\0]/.test(command) || !secret.value) { clear(); this.update({ error: "INVALID_PARAMS" }); return Promise.resolve(false); }
    this.update({ rcon: null });
    return this.run(async (session, scope, current) => {
      const status = await session.serverStatus(scope.directory, this.options.id);
      if (!current()) return {};
      if (status.running !== true || status.stale_state) fail(status.running === false ? "SERVER_NOT_RUNNING" : "SERVER_STATUS_FAILED");
      const request = session.serverRconCommand(scope.directory, this.options.id, secret.value, command.trim(), 262144);
      clear();
      return { rcon: await request };
    }, clear);
  };
  query = (mode: ServerQueryMode): Promise<boolean> => {
    if (mode !== "basic" && mode !== "full") { this.update({ error: "INVALID_PARAMS" }); return Promise.resolve(false); }
    this.update({ query: null });
    return this.run(async (session, scope, current) => {
      const status = await session.serverStatus(scope.directory, this.options.id);
      if (!current()) return {};
      if (status.running !== true || status.stale_state) fail(status.running === false ? "SERVER_NOT_RUNNING" : "SERVER_STATUS_FAILED");
      return { query: await session.serverQuery(scope.directory, this.options.id, mode) };
    });
  };
}

export function useServerAdvanced(server: ServerManifest) {
  const servers = useServers();
  const scope = servers.captureOperationScope();
  const scopeKey = JSON.stringify(scope);
  const controller = useMemo(() => new ServerAdvancedController({ id: server.id, scope, isScopeCurrent: servers.isOperationScopeCurrent, openSession: servers.openSession }), [server.id, scopeKey, servers.isOperationScopeCurrent, servers.openSession]);
  useEffect(() => () => controller.cancel(), [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const busy = useServerTargetBusy(scope, server.id);
  return { snapshot: { ...snapshot, pending: snapshot.pending || busy }, loadProperties: controller.loadProperties, saveProperties: controller.saveProperties, rcon: controller.rcon, query: controller.query, cancel: controller.cancel };
}
