/**
 * Captured real Core/native Session records, replayed at CoreSession's request seam.
 * This test executes real task/UI logic, not a live Tauri bridge or Core process.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { InstallTaskProgress } from "@/components/InstallTaskProgress";
import { MicrosoftAccountsProvider } from "./auth";
import { LauncherContext } from "./launcher";
import { ModpackTasksProvider } from "./modpackTasks";
import { CoreSession, RpcError, type SessionEvent } from "./rpc";
import { SettingsProvider } from "./settings";
import { TasksProvider, useTasks } from "./tasks";
import type { InstanceManifest } from "./types";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom, document: dom.document, localStorage: dom.localStorage,
  HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
  Event: dom.Event, MouseEvent: dom.MouseEvent,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  ResizeObserver: dom.ResizeObserver, MutationObserver: dom.MutationObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
});
const { InstancesPage } = await import("@/pages/InstancesPage");

interface TraceRequest {
  type: "request";
  session: number;
  sequence: number;
  method: string;
  params: Record<string, unknown>;
  events: SessionEvent[];
  outcome:
    | { kind: "result"; data: Record<string, unknown> }
    | { kind: "error"; data: { kind: string; code: string; message: string } };
}
const fixture = new URL("./fixtures/native-install-trace/normalized.json", import.meta.url);
const trace = JSON.parse(readFileSync(fixture, "utf8")) as {
  schema_version: number;
  records: Array<TraceRequest | { type: string }>;
};
const requests = trace.records.filter((record): record is TraceRequest => record.type === "request");
const fixtureRoot = "${FIXTURE_ROOT}";
const dirs = { instancesDir: `${fixtureRoot}/instances`, storeDir: `${fixtureRoot}/store`, workers: 1, retries: 0 };
const gameDir = (id: string) => `${dirs.instancesDir}/${id}/.minecraft`;
const captured = (method: string, id: string) => requests.filter(record =>
  record.method === method && (method.startsWith("instance.") ? record.params.id === id : record.params.directory === gameDir(id)),
);
function result(record: TraceRequest) {
  if (record.outcome.kind !== "result") throw new Error(`Expected captured result: ${record.method}`);
  return record.outcome.data;
}
function initialManifest(id: string): InstanceManifest {
  const record = captured("instance.get", id).find(record => record.outcome.kind === "result" && record.outcome.data.installed === false);
  if (!record) throw new Error(`Missing captured initial manifest for ${id}`);
  return structuredClone(result(record)) as unknown as InstanceManifest;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

/** Scheduling and close are explicit replay controls, never claimed as native I/O. */
class TraceSession {
  readonly calls: Array<{ method: string; params: Record<string, unknown>; compactEvents?: boolean }> = [];
  readonly faults: string[] = [];
  readonly lifecycle: string[] = [];
  readonly session: CoreSession;
  closed = 0;
  private pending: { record: TraceRequest; emit: (event: SessionEvent) => void; finish: () => void; cursor: number } | undefined;
  constructor(readonly records: TraceRequest[]) {
    this.session = CoreSession.createForTesting(async (method, params, onEvent, options) => {
      const record = records[this.calls.length];
      this.calls.push({ method, params: plain(params), compactEvents: options?.compactEvents });
      if (!record || record.method !== method || !isDeepStrictEqual(plain(params), record.params)) {
        this.faults.push(`Unexpected replay request ${method}: ${JSON.stringify(plain(params))}`);
        throw new Error(this.faults.at(-1));
      }
      if (!onEvent && record.events.length) {
        this.faults.push(`Missing event consumer for ${method}`);
        throw new Error(this.faults.at(-1));
      }
      const done = deferred<void>();
      this.lifecycle.push(`request:${method}`);
      this.pending = {
        record, cursor: 0,
        emit: event => onEvent?.(structuredClone(event) as never),
        finish: () => done.resolve(),
      };
      await done.promise;
      this.lifecycle.push(`terminal:${method}`);
      if (record.outcome.kind === "error") throw new RpcError(record.outcome.data);
      return structuredClone(record.outcome.data) as never;
    });
    this.session.close = async () => { this.closed++; this.lifecycle.push("close"); };
    replaySessions.push(this);
  }
  get current() { return this.pending?.record; }
  emitNext(): SessionEvent {
    const pending = this.pending;
    if (!pending || pending.cursor >= pending.record.events.length) throw new Error("No captured event pending");
    const event = pending.record.events[pending.cursor++]!;
    pending.emit(event);
    return event;
  }
  emitAll() { while (this.pending && this.pending.cursor < this.pending.record.events.length) this.emitNext(); }
  finish() {
    if (!this.pending) throw new Error("No captured terminal pending");
    if (this.pending.cursor !== this.pending.record.events.length) throw new Error("Cannot skip captured events");
    const pending = this.pending;
    this.pending = undefined;
    pending.finish();
  }
  drain() { if (this.pending) { this.emitAll(); this.finish(); } }
  assertComplete() {
    expect(this.faults).toEqual([]);
    expect(this.calls).toHaveLength(this.records.length);
    expect(this.current).toBeUndefined();
    expect(this.closed).toBe(1);
  }
}
let root: Root | undefined;
const replaySessions: TraceSession[] = [];
const releaseOpenings: Array<() => void> = [];
afterEach(async () => {
  // Always release synthetic gates, even when an assertion fails, so the real
  // process-wide instance coordinator cannot leak a lease into another test.
  for (const release of releaseOpenings.splice(0)) release();
  for (let i = 0; i < 4; i++) await act(async () => replaySessions.forEach(session => session.drain()));
  await act(async () => root?.unmount());
  root = undefined; replaySessions.length = 0;
  dom.document.body.replaceChildren(); localStorage.clear();
});
function settings() {
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({
    language: "en", instancesDir: dirs.instancesDir, storeDir: dirs.storeDir,
    serversDir: `${fixtureRoot}/servers`, downloadWorkers: 1, downloadRetries: 0,
  }));
}
async function mountTasks(openSession: () => Promise<CoreSession>) {
  settings();
  let tasks!: ReturnType<typeof useTasks>;
  function Capture() {
    tasks = useTasks();
    const task = tasks.taskFor("install", "blocked", dirs.instancesDir);
    return task?.status === "running" ? <InstallTaskProgress task={task} /> : null;
  }
  const host = dom.document.createElement("div"); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(
    <SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession }}>
      <TasksProvider><Capture /></TasksProvider>
    </LauncherContext.Provider></SettingsProvider>,
  ));
  return () => tasks;
}

const blockedExecute = captured("install.execute", "blocked");
const blockedPrepare = captured("install.prepare", "blocked");
const failedPrepare = blockedPrepare.find(record => record.outcome.kind === "error")!;
const retryPrepare = blockedPrepare.find(record => record.outcome.kind === "result")!;

describe("captured native install trace consumed by TasksProvider", () => {
  test("cached progress stays running through prepare failure; close, duplicate guard and real-trace retry remain correct", async () => {
    const failed = new TraceSession([blockedExecute[0]!, failedPrepare]);
    const retry = new TraceSession([blockedExecute[1]!, retryPrepare]);
    const opening = deferred<CoreSession>();
    releaseOpenings.push(() => opening.resolve(failed.session));
    let opens = 0;
    const current = await mountTasks(() => ++opens === 1 ? opening.promise : Promise.resolve(retry.session));
    const manifest = initialManifest("blocked");
    let first!: Promise<void>;
    await act(async () => {
      first = current().startInstall(manifest, dirs, { policy: "local" });
      void current().startInstall(manifest, dirs, { policy: "local" });
    });
    expect(opens).toBe(1); expect(failed.calls).toHaveLength(0);
    await act(async () => opening.resolve(failed.session));
    expect(failed.current).toBe(blockedExecute[0]);
    expect(failed.calls[0]!.compactEvents).toBe(true);
    for (let index = 0; index < blockedExecute[0]!.events.length; index++) {
      // Feed the recorded event objects unchanged, with real reducer/rendering
      // checkpoints rather than asserting a hand-written event fixture.
      let event!: SessionEvent;
      await act(async () => { event = failed.emitNext(); });
      if (event.kind === "event" && event.data.event === "file") {
        expect(current().taskFor("install", "blocked", dirs.instancesDir)?.installProgress?.detail).toEqual({ kind: "file", status: "cached" });
        expect(dom.document.body.textContent).toContain("Verified and reused a cached file");
      }
    }
    const task = () => current().taskFor("install", "blocked", dirs.instancesDir)!;
    expect(task()).toMatchObject({ status: "running", stage: "task.stage.download", progress: { filesCompleted: 1, filesTotal: 1, bytesProcessed: 5, bytesTotal: 5 } });
    expect(dom.document.body.textContent).toContain("100%");
    expect(result(blockedExecute[0]!).bytes_transferred).toBe(0);
    await act(async () => { await current().startInstall(manifest, dirs, { policy: "local" }); });
    expect(opens).toBe(1);
    await act(async () => failed.finish());
    expect(failed.current).toBe(failedPrepare);
    expect(task()).toMatchObject({ status: "running", stage: "task.stage.prepare", progress: null });
    expect(task().installProgress).toBeUndefined();
    expect(dom.document.body.textContent).toContain("Preparing runtime");
    expect(dom.document.body.textContent).not.toContain("100%");
    expect(failed.closed).toBe(0);
    await act(async () => { await current().startInstall(manifest, dirs, { policy: "local" }); });
    expect(opens).toBe(1);
    await act(async () => { failed.finish(); await first; });
    expect(task().status).toBe("error");
    expect(task().message).toContain("PREPARE_FAILED");
    failed.assertComplete();
    expect(failed.lifecycle).toEqual(["request:install.execute", "terminal:install.execute", "request:install.prepare", "terminal:install.prepare", "close"]);

    let second!: Promise<void>;
    await act(async () => { second = current().startInstall(manifest, dirs, { policy: "local" }); });
    expect(opens).toBe(2); expect(task().status).toBe("running");
    await act(async () => { retry.emitAll(); retry.finish(); });
    expect(task().stage).toBe("task.stage.prepare");
    expect(task().status).toBe("running"); expect(retry.closed).toBe(0);
    await act(async () => { retry.finish(); await second; });
    expect(task().status).toBe("success"); retry.assertComplete();
    expect(manifest.installed).toBe(false); // Task success never mutates the authoritative manifest.
  });

  test("failure of one replayed instance does not clear another instance's pending progress or guard", async () => {
    const blocked = new TraceSession([blockedExecute[0]!, failedPrepare]);
    const one = new TraceSession([captured("install.execute", "one")[0]!, captured("install.prepare", "one")[0]!]);
    const sessions = [blocked, one]; let opens = 0;
    const current = await mountTasks(async () => sessions[opens++]!.session);
    let first!: Promise<void>; let other!: Promise<void>;
    await act(async () => {
      first = current().startInstall(initialManifest("blocked"), dirs, { policy: "local" });
      other = current().startInstall(initialManifest("one"), dirs, { policy: "local" });
    });
    await act(async () => { blocked.emitAll(); one.emitAll(); blocked.finish(); });
    const before = current().taskFor("install", "one", dirs.instancesDir);
    expect(before?.progress?.filesCompleted).toBe(1);
    await act(async () => { blocked.finish(); await first; });
    expect(current().taskFor("install", "blocked", dirs.instancesDir)?.status).toBe("error");
    expect(current().taskFor("install", "one", dirs.instancesDir)).toEqual(before);
    expect(one.closed).toBe(0);
    await act(async () => { await current().startInstall(initialManifest("one"), dirs, { policy: "local" }); });
    expect(opens).toBe(2);
    await act(async () => one.finish());
    await act(async () => { one.finish(); await other; });
    blocked.assertComplete(); one.assertComplete();
    expect(current().taskFor("install", "one", dirs.instancesDir)?.status).toBe("success");
  });
});

const fixtureFile = (name: string) => new URL(`./fixtures/native-install-trace/${name}`, import.meta.url);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
test("captured fixture hashes, source modules and root-only normalization are reproducible", () => {
  const raw = readFileSync(fixtureFile("raw.jsonl"));
  const normalized = readFileSync(fixtureFile("normalized.json"));
  const provenance = JSON.parse(readFileSync(fixtureFile("provenance.json"), "utf8")) as {
    raw_sha256: string; normalized_sha256: string;
    normalization: { literal_from: string; literal_to: string };
    frontend_modules: Record<string, string>;
  };
  expect(sha256(raw)).toBe(provenance.raw_sha256);
  expect(sha256(normalized)).toBe(provenance.normalized_sha256);
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll(provenance.normalization.literal_from, provenance.normalization.literal_to);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  const rawRecords = raw.toString().trim().split("\n").map(line => JSON.parse(line));
  expect(trace as unknown).toEqual({ schema_version: 1, records: normalize(rawRecords) });
  expect(trace.records).toHaveLength(37);
  expect(requests).toHaveLength(28);
  expect(new Set(requests.map(record => `${record.session}:${record.sequence}`)).size).toBe(28);
  // Native-source drift must be reviewed before this trace is still described
  // as captured through this frontend's unchanged Session implementation.
  for (const [name, digest] of Object.entries(provenance.frontend_modules)) {
    expect(sha256(readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url)))).toBe(digest);
  }
  expect(blockedExecute).toHaveLength(2);
  expect(blockedExecute[0]!.session).not.toBe(blockedExecute[1]!.session);
  expect(failedPrepare.outcome).toMatchObject({ kind: "error", data: { kind: "rpc", code: "PREPARE_FAILED" } });
  expect(retryPrepare.outcome.kind).toBe("result");
});

test("real instance-list records drive remounted cards: prepare failure remains installed, missing receipt does not", async () => {
  const lists = requests.filter(record => record.method === "instance.list");
  expect(lists).toHaveLength(2);
  expect(lists[0]!.sequence).toBeLessThan(blockedExecute[1]!.sequence);
  let listCalls = 0;
  let opens = 0;
  const failed = new TraceSession([blockedExecute[0]!, failedPrepare]);
  const unexpected: string[] = [];
  const control = CoreSession.createForTesting(async (method, params) => {
    // Account listing is unrelated to the captured install trace. Keep this
    // clearly marked UI-only stub; no account operation is claimed as replay.
    if (method === "account.microsoft.list") return { accounts: [] } as never;
    const record = lists[listCalls++];
    if (method !== "instance.list" || !record || !isDeepStrictEqual(plain(params), record.params)) {
      unexpected.push(`${method}: ${JSON.stringify(params)}`);
      throw new Error("Unexpected page request outside captured list trace");
    }
    return structuredClone(result(record)) as never;
  });
  let tasks!: ReturnType<typeof useTasks>;
  function Capture() { tasks = useTasks(); return null; }
  settings();
  const host = dom.document.createElement("div"); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  const renderPage = (generation: number, showPage = true) => (
    <SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: control.core, error: null, session: control, openSession: async () => { if (++opens !== 1) throw new Error("Unexpected additional task session"); return failed.session; } }}>
      <MicrosoftAccountsProvider><TasksProvider><ModpackTasksProvider>
        {showPage && <InstancesPage key={generation} onOpenDetail={() => {}} onOpenContent={() => {}} />}<Capture />
      </ModpackTasksProvider></TasksProvider></MicrosoftAccountsProvider>
    </LauncherContext.Provider></SettingsProvider>
  );
  const card = (id: string) => [...dom.document.querySelectorAll('[data-slot="card"]')].find(element => element.querySelector('[data-slot="card-title"]')?.textContent === id)!;
  const hasButton = (id: string, text: string) => [...card(id).querySelectorAll("button")].some(button => button.textContent?.trim() === text);
  // Keep the task provider alive through the real captured failure and page
  // navigation. An error task must not override Core's installed receipt state.
  await act(async () => root!.render(renderPage(0, false)));
  let pending!: Promise<void>;
  await act(async () => { pending = tasks.startInstall(initialManifest("blocked"), dirs, { policy: "local" }); });
  await act(async () => { failed.emitAll(); failed.finish(); });
  await act(async () => { failed.finish(); await pending; });
  failed.assertComplete();
  expect(tasks.taskFor("install", "blocked", dirs.instancesDir)?.status).toBe("error");
  expect(listCalls).toBe(0);
  await act(async () => root!.render(renderPage(0)));
  expect(listCalls).toBe(1); expect(unexpected).toEqual([]);
  expect(tasks.taskFor("install", "blocked", dirs.instancesDir)?.status).toBe("error");
  expect(card("blocked").textContent).toContain("PREPARE_FAILED");
  for (const id of ["blocked", "one", "two"]) {
    expect(hasButton(id, "Launch")).toBe(true);
    expect(card(id).textContent).not.toContain("Not installed");
  }
  // The second captured list follows real removal of one's owned receipt.
  // Remount the actual page, retaining the same real TasksProvider above it.
  await act(async () => root!.render(renderPage(1)));
  expect(listCalls).toBe(2); expect(unexpected).toEqual([]);
  expect(tasks.taskFor("install", "blocked", dirs.instancesDir)?.status).toBe("error");
  expect(card("blocked").textContent).toContain("PREPARE_FAILED");
  expect(opens).toBe(1);
  expect(hasButton("one", "Install")).toBe(true);
  expect(hasButton("one", "Launch")).toBe(false);
  expect(card("one").textContent).toContain("Not installed");
  for (const id of ["blocked", "two"]) expect(hasButton(id, "Launch")).toBe(true);
});
