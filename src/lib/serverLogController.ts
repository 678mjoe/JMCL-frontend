import type { ServerCommandResult, ServerLogResult } from "./types";
import type { ServerOperationScope } from "./servers";

export const SERVER_LOG_MAX_BYTES = 64 * 1024;
/** Maximum retained JavaScript string length. Trimming prefers a newline boundary. */
export const MAX_SERVER_LOG_BUFFER_CHARS = 256 * 1024;
export const SERVER_LOG_POLL_INTERVAL_MS = 2_000;

export interface ServerLogSession {
  close(): Promise<void>;
  serverLogs(directory: string, id: string, options: { max_bytes: number; cursor?: number; file_id?: number }): Promise<ServerLogResult>;
  serverCommand(directory: string, id: string, command: string): Promise<ServerCommandResult>;
}

export interface ServerLogSnapshot {
  text: string;
  loading: boolean;
  empty: boolean;
  notFound: boolean;
  hasLogs: boolean;
  error: string | null;
  truncated: boolean;
  localOmission: boolean;
  open: boolean;
  sessionReady: boolean;
  running: boolean;
  inFlight: boolean;
  commandPending: boolean;
  commandError: string | null;
  commandAccepted: boolean;
  acceptedNotice: boolean;
  validationError: "empty" | "multiline" | null;
}

type TimerHandle = unknown;
const initialSnapshot = (): ServerLogSnapshot => ({
  text: "", loading: false, empty: false, notFound: false, hasLogs: false, error: null, truncated: false,
  localOmission: false, open: false, sessionReady: false, running: false, inFlight: false, commandPending: false,
  commandError: null, commandAccepted: false, acceptedNotice: false, validationError: null,
});
function stableCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : "UNKNOWN";
}

export function isNearLogBottom(element: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 48): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= threshold;
}

/** A panel-owned, scope-isolated resumable log session. No log or command data is persisted. */
export class ServerLogController {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private scope: ServerOperationScope | null = null;
  private session: ServerLogSession | null = null;
  private opening: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: TimerHandle | null = null;
  private generation = 0;
  private requestId = 0;
  private cursor: number | null = null;
  private fileId: number | null = null;
  private finalReadPending = false;
  private closePromise: Promise<void> | null = null;
  /** Latest running prop, retained across closed sessions. */
  private desiredRunning = false;

  constructor(private readonly options: {
    serverId: string;
    captureScope: () => ServerOperationScope | null;
    isScopeCurrent: (scope: ServerOperationScope) => boolean;
    openSession: () => Promise<ServerLogSession>;
    setTimer?: (callback: () => void, delay: number) => TimerHandle;
    clearTimer?: (timer: TimerHandle) => void;
    maxBytes?: number;
  }) {}

  getSnapshot = (): ServerLogSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private update(patch: Partial<ServerLogSnapshot>, generation = this.generation): void {
    if (generation !== this.generation) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(generation: number, scope: ServerOperationScope): boolean {
    if (generation !== this.generation) return false;
    const live = this.options.captureScope();
    const matches = this.options.isScopeCurrent(scope) && live?.directory === scope.directory && live.sourceRevision === scope.sourceRevision;
    if (!matches) void this.invalidateScope(generation);
    return matches;
  }
  private async invalidateScope(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const session = this.session;
    this.generation++;
    this.clearTimer();
    this.session = null; this.scope = null; this.cursor = null; this.fileId = null;
    this.inFlight = null; this.opening = null; this.requestId++;
    this.finalReadPending = false;
    this.snapshot = { ...this.snapshot, open: false, sessionReady: false, running: false, loading: false, inFlight: false, commandPending: false };
    for (const listener of this.listeners) listener();
    await Promise.resolve().then(() => session?.close()).catch(() => undefined);
  }
  private clearTimer(): void {
    if (this.timer === null) return;
    if (this.options.clearTimer) this.options.clearTimer(this.timer);
    else clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }
  private schedulePoll(generation: number, scope: ServerOperationScope): void {
    this.clearTimer();
    if (!this.snapshot.open || !this.snapshot.running || !this.current(generation, scope)) return;
    this.timer = (this.options.setTimer ?? setTimeout)(() => {
      this.timer = null;
      if (this.current(generation, scope) && this.snapshot.running && this.snapshot.open) void this.read(generation, scope);
    }, SERVER_LOG_POLL_INTERVAL_MS);
  }

  async open(): Promise<void> {
    const requestedScope = this.options.captureScope();
    if (!requestedScope) return;
    if (this.snapshot.open && this.scope && this.scope.directory === requestedScope.directory && this.scope.sourceRevision === requestedScope.sourceRevision) {
      if (this.opening) return this.opening;
      return;
    }
    if (this.snapshot.open) await this.close();
    const scope = { ...requestedScope };
    const generation = ++this.generation;
    this.scope = scope;
    this.cursor = null; this.fileId = null; this.finalReadPending = false; this.closePromise = null;
    this.snapshot = { ...initialSnapshot(), open: true, loading: true, running: this.desiredRunning };
    for (const listener of this.listeners) listener();
    const operation = (async () => {
      try {
        const session = await this.options.openSession();
        if (!this.current(generation, scope) || !this.snapshot.open) { await session.close(); return; }
        this.session = session;
        this.update({ sessionReady: true }, generation);
        await this.read(generation, scope);
      } catch (error) {
        if (this.current(generation, scope)) this.update({ loading: false, inFlight: false, error: stableCode(error) }, generation);
      }
    })();
    this.opening = operation;
    try { await operation; } finally { if (generation === this.generation) this.opening = null; }
  }

  async close(): Promise<void> {
    if (!this.snapshot.open && !this.session && !this.opening) return this.closePromise ?? Promise.resolve();
    const oldSession = this.session;
    this.generation++;
    this.clearTimer();
    this.finalReadPending = false;
    this.session = null; this.scope = null; this.cursor = null; this.fileId = null;
    this.inFlight = null; this.opening = null; this.requestId++;
    this.snapshot = { ...this.snapshot, open: false, sessionReady: false, running: false, loading: false, inFlight: false, commandPending: false };
    for (const listener of this.listeners) listener();
    const closing = oldSession ? Promise.resolve().then(() => oldSession.close()) : Promise.resolve();
    this.closePromise = closing.catch(() => undefined);
    await this.closePromise;
  }

  setRunning(running: boolean): void {
    this.desiredRunning = running;
    if (!this.snapshot.open || this.snapshot.running === running) return;
    const generation = this.generation;
    const scope = this.scope;
    if (!scope || !this.current(generation, scope)) { void this.close(); return; }
    this.update({ running }, generation);
    if (running) {
      this.finalReadPending = false;
      this.clearTimer();
      if (!this.inFlight) void this.read(generation, scope);
    } else {
      this.clearTimer();
      this.finalReadPending = true;
      if (!this.inFlight) { this.finalReadPending = false; void this.read(generation, scope); }
    }
  }

  async retry(): Promise<void> {
    const scope = this.scope;
    if (!scope || !this.snapshot.open) return;
    if (!this.current(this.generation, scope)) { await this.close(); return; }
    if (this.opening) { await this.opening; return; }
    this.clearTimer();
    if (!this.session) {
      const generation = this.generation;
      this.update({ loading: true, error: null }, generation);
      try {
        const session = await this.options.openSession();
        if (!this.current(generation, scope) || !this.snapshot.open) { await session.close(); return; }
        this.session = session;
        this.update({ sessionReady: true }, generation);
      } catch (error) {
        if (this.current(generation, scope)) this.update({ loading: false, error: stableCode(error) }, generation);
        return;
      }
    }
    await this.read(this.generation, scope);
  }

  private async read(generation: number, scope: ServerOperationScope): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const session = this.session;
    if (!session || !this.current(generation, scope)) return;
    const id = ++this.requestId;
    const opts: { max_bytes: number; cursor?: number; file_id?: number } = { max_bytes: this.options.maxBytes ?? SERVER_LOG_MAX_BYTES };
    if (this.cursor !== null && this.fileId !== null) { opts.cursor = this.cursor; opts.file_id = this.fileId; }
    this.update({ loading: true, inFlight: true, error: null, notFound: false }, generation);
    const request = (async () => {
      try {
        const result = await session.serverLogs(scope.directory, this.options.serverId, opts);
        if (!this.current(generation, scope) || id !== this.requestId || !this.snapshot.open) return;
        this.cursor = result.next_cursor; this.fileId = result.file_id;
        let text = result.reset ? result.text : this.snapshot.text + result.text;
        let localOmission = result.reset ? false : this.snapshot.localOmission;
        if (text.length > MAX_SERVER_LOG_BUFFER_CHARS) {
          const excess = text.length - MAX_SERVER_LOG_BUFFER_CHARS;
          const newline = text.indexOf("\n", excess);
          let cut = newline >= 0 ? newline + 1 : excess;
          if (cut > 0 && cut < text.length) {
            const firstRetained = text.charCodeAt(cut);
            const preceding = text.charCodeAt(cut - 1);
            if (firstRetained >= 0xdc00 && firstRetained <= 0xdfff && preceding >= 0xd800 && preceding <= 0xdbff) cut++;
          }
          text = text.slice(cut);
          localOmission = true;
        }
        this.update({ text, truncated: result.reset ? result.truncated : this.snapshot.truncated || result.truncated, localOmission, empty: text.length === 0, notFound: false, hasLogs: true, error: null }, generation);
      } catch (error) {
        if (!this.current(generation, scope) || id !== this.requestId || !this.snapshot.open) return;
        const code = stableCode(error);
        if (code === "SERVER_LOGS_NOT_FOUND") {
          this.cursor = null; this.fileId = null;
          this.update({ text: "", empty: true, notFound: true, hasLogs: false, truncated: false, localOmission: false, error: null }, generation);
        }
        else this.update({ error: code, empty: this.snapshot.text.length === 0, notFound: false }, generation);
      } finally {
        if (this.current(generation, scope) && id === this.requestId && this.snapshot.open) {
          this.inFlight = null;
          this.update({ loading: false, inFlight: false }, generation);
          if (this.finalReadPending && !this.snapshot.running) {
            this.finalReadPending = false;
            void this.read(generation, scope);
          } else this.schedulePoll(generation, scope);
        }
      }
    })();
    this.inFlight = request;
    return request;
  }

  async submitCommand(input: string): Promise<boolean> {
    const scope = this.scope;
    if (!this.snapshot.open || !this.snapshot.running || !scope || !this.current(this.generation, scope) || this.snapshot.commandPending) return false;
    const command = input.trim();
    if (!command) { this.update({ validationError: "empty", commandError: null, acceptedNotice: false }); return false; }
    if (/[\r\n]/.test(input)) { this.update({ validationError: "multiline", commandError: null, acceptedNotice: false }); return false; }
    const session = this.session;
    if (!session) return false;
    const generation = this.generation;
    this.update({ commandPending: true, commandError: null, validationError: null, acceptedNotice: false, commandAccepted: false });
    try {
      const result = await session.serverCommand(scope.directory, this.options.serverId, command);
      if (!this.current(generation, scope) || !this.snapshot.open) return false;
      this.update({ commandPending: false, commandAccepted: true, acceptedNotice: result.accepted });
      return true;
    } catch (error) {
      if (!this.current(generation, scope) || !this.snapshot.open) return false;
      this.update({ commandPending: false, commandError: stableCode(error) });
      return false;
    }
  }
}
