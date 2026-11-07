/** Captured Native Session API replay, not live Tauri/Core/Java or browser acceptance. */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { MicrosoftAccountsProvider } from "./auth";
import { instanceMutationKey } from "./instanceCoordinator";
import { appendLaunchOutput, runLaunchRequest } from "./launchRunner";
import { LauncherContext } from "./launcher";
import type { BufferedLine } from "./logBuffer";
import { mockCredentialDelete, mockCredentialSet } from "./mockTransport";
import { ModpackTasksProvider } from "./modpackTasks";
import { CoreSession, RpcError, type LaunchExecuteOptions, type SessionEvent } from "./rpc";
import { SettingsProvider, useSettings } from "./settings";
import { TasksProvider, useTasks } from "./tasks";
import type { AuthSession, InstanceManifest, LaunchOptions } from "./types";

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

type TraceRequest = {
  type: "request"; session: number; method: string; params: Record<string, unknown>;
  events: SessionEvent[];
  outcome:
    | { kind: "result"; data: Record<string, unknown> }
    | { kind: "error"; data: { kind: string; code: string; message: string } };
};
type TraceRecord = TraceRequest | { type: "fixture"; root: string }
  | { type: "session_open"; session: number } | { type: "session_close"; session: number };
const file = (name: string) => new URL(`./fixtures/native-launch-trace/${name}`, import.meta.url);
const rawBytes = readFileSync(file("raw.jsonl"));
const rawRecords = rawBytes.toString().trim().split("\n").map(line => JSON.parse(line)) as TraceRecord[];
const normalizedBytes = readFileSync(file("normalized.json"));
const normalized = JSON.parse(normalizedBytes.toString()) as { schema_version: number; records: TraceRecord[] };
const requestsOf = (records: TraceRecord[]) => records.filter((r): r is TraceRequest => r.type === "request");
const launches = requestsOf(rawRecords).filter(r => r.method === "launch.execute");
const fixtureRoot = rawRecords.find((r): r is Extract<TraceRecord, { type: "fixture" }> => r.type === "fixture")!.root;
const dirs = { instancesDir: `${fixtureRoot}/instances`, storeDir: `${fixtureRoot}/never-create-store` };
const manifest: InstanceManifest = {
  id: "demo", name: "Native trace demo", version_id: "synthetic", source: "official", installed: true,
  fabric_loader: null, neoforge_version: null, forge_version: null,
};
const auth = launches[0]!.params.auth as AuthSession & { session: string };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const expectedLines: BufferedLine[] = [
  { stream: "stdout", text: "native child ready" },
  { stream: "stdout", text: "x".repeat(16383) + "中" + "y".repeat(20000) },
  { stream: "stdout", text: "" },
  { stream: "stdout", text: "token=<redacted>; session=<redacted>" },
  { stream: "stderr", text: "stderr=<redacted>" },
  { stream: "stderr", text: "binary\0\ufffd" },
];
function outcome(record: TraceRequest): Record<string, unknown> {
  if (record.outcome.kind === "error") throw new RpcError(record.outcome.data);
  return structuredClone(record.outcome.data);
}
function launchParams(record: TraceRequest) {
  const { id, directory, auth, ...options } = record.params;
  return { id: id as string, directory: directory as string, auth: auth as AuthSession, options: options as LaunchExecuteOptions };
}

// This executor replaces only native I/O. Production CoreSession wrappers,
// instance coordination, launch runner, TasksProvider and React page stay real.
class GatedReplay {
  readonly session: CoreSession;
  readonly faults: string[] = [];
  readonly lifecycle: string[] = [];
  cursor = 0;
  calls = 0;
  closes = 0;
  private emit?: (event: SessionEvent) => void;
  private release?: () => void;
  constructor(readonly record: TraceRequest) {
    this.session = CoreSession.createForTesting(async (method, params, onEvent) => {
      this.calls++;
      if (this.calls !== 1 || method !== record.method || !isDeepStrictEqual(plain(params), record.params) || !onEvent) {
        this.faults.push(`Unexpected request: ${method} ${JSON.stringify(params)}`);
        throw new Error(this.faults.at(-1));
      }
      this.lifecycle.push("request");
      this.emit = event => onEvent(structuredClone(event) as never);
      await new Promise<void>(resolve => { this.release = resolve; });
      this.release = undefined;
      this.lifecycle.push("terminal");
      return outcome(record) as never;
    });
    this.session.close = async () => { this.closes++; this.lifecycle.push("close"); };
    gated.push(this);
  }
  emitNext() {
    if (!this.emit || this.cursor >= this.record.events.length) throw new Error("No captured event pending");
    const event = this.record.events[this.cursor++]!;
    this.emit(event);
    return event;
  }
  finish() {
    if (!this.release || this.cursor !== this.record.events.length) throw new Error("Cannot skip captured events/terminal");
    this.release();
  }
  drain() {
    if (!this.release) return;
    while (this.cursor < this.record.events.length) this.emitNext();
    this.finish();
  }
  assertComplete() {
    expect(this.faults).toEqual([]);
    expect(this.calls).toBe(1);
    expect(this.cursor).toBe(this.record.events.length);
    expect(this.closes).toBe(1);
    expect(this.lifecycle).toEqual(["request", "terminal", "close"]);
  }
}
let root: Root | undefined;
const gated: GatedReplay[] = [];
afterEach(async () => {
  // Release owned replay gates even on assertion failure, including the real
  // process-wide instance coordinator's lease. Never launch a native process.
  await act(async () => { gated.forEach(replay => replay.drain()); });
  await act(async () => root?.unmount());
  root = undefined; gated.length = 0;
  dom.document.body.replaceChildren(); localStorage.clear();
  mockCredentialDelete("native-trace-account");
});

test("real launch trace has pinned provenance, unchanged native modules and root-only normalization", () => {
  const provenanceBytes = readFileSync(file("provenance.json"));
  const provenance = JSON.parse(provenanceBytes.toString()) as {
    raw_sha256: string; normalized_sha256: string; core_sha256: string; source_commit: string;
    frontend_module_sha256: Record<string, string>;
    executing_guard: string; passed: number; failed: number; ignored: number;
  };
  const pins = JSON.parse(readFileSync(file("replay-pins.json"), "utf8"));
  expect(sha256(provenanceBytes)).toBe(pins.provenance_sha256);
  expect(provenance.source_commit).toBe(pins.source_commit_verified);
  expect(sha256(rawBytes)).toBe(provenance.raw_sha256);
  expect(sha256(normalizedBytes)).toBe(provenance.normalized_sha256);
  expect(provenance.core_sha256).toBe("dad858d76f05cc4fad65814b03790a83e02e9244c5fa1d3155f882b89c1fd1f5");
  expect(provenance).toMatchObject({ executing_guard: "launch_network_guard", passed: 1, failed: 0, ignored: 0 });
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll(fixtureRoot, "${FIXTURE_ROOT}");
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  expect(normalized as unknown).toEqual({ schema_version: 1, records: normalize(rawRecords) });
  expect(rawRecords).toHaveLength(12);
  expect(requestsOf(rawRecords)).toHaveLength(7);
  expect(launches).toHaveLength(4);
  for (const [name, digest] of Object.entries(provenance.frontend_module_sha256)) {
    expect(sha256(readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url)))).toBe(digest);
  }
  // The fixture genuinely includes a byte-level split, not a preassembled
  // string that would pass even with a stateless frontend TextDecoder.
  for (const launch of launches.slice(1)) {
    const outputs = launch.events.flatMap(event => event.kind === "event" && event.data.event === "stdout" ? [event.data.stdout as { data: string; end: string }] : []);
    expect(outputs).toHaveLength(6);
    expect(Buffer.from(outputs[1]!.data, "base64").at(-1)).toBe(0xe4);
    expect([...Buffer.from(outputs[2]!.data, "base64").subarray(0, 2)]).toEqual([0xb8, 0xad]);
    expect(outputs[4]).toMatchObject({ data: "", end: "newline" });
    const visible = JSON.stringify({ events: launch.events, outcome: launch.outcome });
    expect(visible).not.toContain(auth.access_token);
    expect(visible).not.toContain(auth.session!);
  }
});

test("exact normalized records replay through CoreSession/launch runner, including error, exit 7, retry, close and reopen", async () => {
  const queues = new Map<number, TraceRequest[]>();
  const sessions = new Map<number, CoreSession>();
  const consumed: TraceRequest[] = [];
  const closed: number[] = [];
  for (const request of requestsOf(normalized.records)) {
    queues.set(request.session, [...(queues.get(request.session) ?? []), request]);
  }
  for (const record of normalized.records) {
    if (record.type === "fixture") continue;
    if (record.type === "session_open") {
      const session = CoreSession.createForTesting(async (method, params, onEvent) => {
        const next = queues.get(record.session)!.shift()!;
        expect(method).toBe(next.method);
        expect(plain(params)).toEqual(next.params);
        consumed.push(next);
        for (const event of next.events) onEvent!(structuredClone(event) as never);
        return outcome(next) as never;
      });
      session.close = async () => { closed.push(record.session); };
      sessions.set(record.session, session);
      continue;
    }
    const session = sessions.get(record.session)!;
    if (record.type === "session_close") { await session.close(); continue; }
    const lines: BufferedLine[] = [];
    const started: Record<string, unknown>[] = [];
    const invoke = () => {
      if (record.method === "ping") return session.ping();
      const params = launchParams(record);
      return runLaunchRequest(
        onEvent => session.launchExecute(params.id, params.directory, params.auth, params.options, onEvent),
        (event, buffer) => {
          if (event.kind === "event" && event.data.event === "started") started.push(event.data.started as Record<string, unknown>);
          appendLaunchOutput(event, buffer, line => lines.push(line));
        },
        line => lines.push(line),
      );
    };
    if (record.outcome.kind === "error") {
      await expect(invoke()).rejects.toMatchObject(record.outcome.data);
      expect(lines).toEqual([]);
    } else {
      expect(await invoke()).toEqual(record.outcome.data);
      if (record.method === "launch.execute") {
        expect(lines).toEqual(expectedLines);
        expect(started).toHaveLength(1);
        expect(started[0]!.pid).toBe((record.outcome.data.process as { pid: number }).pid);
        const argv = started[0]!.redacted_argv as string[];
        expect(argv.filter(arg => arg === "<redacted>")).toHaveLength(2);
        expect(JSON.stringify(lines)).not.toContain(auth.access_token);
        expect(JSON.stringify(lines)).not.toContain(auth.session!);
      }
    }
  }
  expect(consumed).toEqual(requestsOf(normalized.records));
  expect(closed).toEqual([1, 2]);
  expect([...queues.values()].flat()).toEqual([]);
  expect(sessions.get(1)).not.toBe(sessions.get(2));
});

test("main page launch clicks consume raw trace unchanged; failure recovery, blank rows and exit results survive log reopen", async () => {
  const replays = launches.map(record => new GatedReplay(record));
  const key = instanceMutationKey(dirs.instancesDir, manifest.id);
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({
    language: "en", ...dirs, serversDir: `${fixtureRoot}/servers`, activeAccountId: "native-trace-account",
    javaPreferences: { [key]: { policy: "local", override: launches[0]!.params.java_override } },
    launchOptions: { version: 1, instances: { [key]: launches[0]!.params.options } },
  }));
  // List and auth are explicit UI scaffolding, outside the native capture.
  // Only fake credentials are used; no keychain, login, network or account is accessed.
  mockCredentialSet("native-trace-account", "synthetic-refresh");
  const scaffoldCalls: string[] = [];
  const scaffold = CoreSession.createForTesting(async method => {
    scaffoldCalls.push(method);
    if (method === "instance.list") return { instances: [manifest] } as never;
    if (method === "account.microsoft.list") return { accounts: [{ id: "native-trace-account", player_name: auth.player_name, client_id: "synthetic-client" }] } as never;
    if (method === "auth.minecraft.refresh_exchange") return { state: "authenticated", refresh_token: "synthetic-refresh", session: auth } as never;
    throw new Error(`Unexpected UI scaffolding request: ${method}`);
  });
  let authCloses = 0;
  scaffold.close = async () => { authCloses++; };
  let opens = 0;
  let tasks!: ReturnType<typeof useTasks>;
  let preferences!: ReturnType<typeof useSettings>;
  function Capture() { tasks = useTasks(); preferences = useSettings(); return null; }
  const host = dom.document.createElement("div"); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(
    <SettingsProvider><LauncherContext.Provider value={{ status: "ready", core: scaffold.core, error: null, session: scaffold,
      openSession: async () => { const index = opens++; return index % 2 === 0 ? scaffold : replays[Math.floor(index / 2)]!.session; },
    }}><MicrosoftAccountsProvider><TasksProvider><ModpackTasksProvider>
      <InstancesPage onOpenDetail={() => {}} onOpenContent={() => {}} /><Capture />
    </ModpackTasksProvider></TasksProvider></MicrosoftAccountsProvider></LauncherContext.Provider></SettingsProvider>,
  ));
  const button = (label: string) => [...dom.document.querySelectorAll("button")].find(item => item.textContent?.trim() === label || item.title === label)!;
  const rows = () => [...dom.document.querySelectorAll('[data-slot="launch-log-line"]')];
  const task = () => tasks.taskFor("launch", manifest.id, dirs.instancesDir)!;
  for (const [index, replay] of replays.entries()) {
    const record = replay.record;
    await act(async () => preferences.update({
      javaPreferences: { [key]: { policy: "local", override: record.params.java_override as string } },
      launchOptions: { version: 1, instances: { [key]: record.params.options as LaunchOptions } },
    }));
    expect(button("Launch").disabled).toBe(false);
    await act(async () => button("Launch").click());
    expect(replay.faults).toEqual([]);
    expect(replay.calls).toBe(1);
    expect(opens).toBe((index + 1) * 2);
    expect(button("Launch").disabled).toBe(true);
    expect(task()).toMatchObject({ status: "running", lines: [], pid: null, message: null });
    expect(dom.document.querySelector('[role="dialog"]')).not.toBeNull();
    for (let eventIndex = 0; eventIndex < record.events.length; eventIndex++) {
      await act(async () => { replay.emitNext(); });
      expect(task().status).toBe("running");
      expect(replay.closes).toBe(0);
      // Split code point and remainder must stay buffered until newline.
      if (eventIndex === 2 || eventIndex === 3) expect(task().lines).toEqual(expectedLines.slice(0, 1));
    }
    if (record.outcome.kind === "result") {
      expect(task().lines).toEqual(expectedLines);
      expect(rows().map(row => row.textContent)).toEqual(expectedLines.map(line => line.text));
      expect(rows()[2]!.classList.contains("min-h-5")).toBe(true);
      expect(rows()[4]!.classList.contains("text-destructive/80")).toBe(true);
      expect(rows()[5]!.classList.contains("text-destructive/80")).toBe(true);
      expect(task().pid).toBe((record.outcome.data.process as { pid: number }).pid);
      // Log sheet closure is a UI operation. It must not complete/close the task.
      await act(async () => button("Close").click());
      expect(dom.document.querySelector('[role="dialog"]')).toBeNull();
      expect(task().status).toBe("running"); expect(replay.closes).toBe(0);
      await act(async () => button("Log").click());
      expect(rows().map(row => row.textContent)).toEqual(expectedLines.map(line => line.text));
    }
    await act(async () => replay.finish());
    replay.assertComplete();
    expect(button("Launch").disabled).toBe(false);
    if (record.outcome.kind === "error") {
      expect(task().status).toBe("error");
      expect(task().message).toContain("JAVA_NOT_FOUND");
      expect(dom.document.body.textContent).toContain("JAVA_NOT_FOUND");
      expect(rows()).toHaveLength(0);
    } else {
      const code = (record.outcome.data.process as { exit_code: number }).exit_code;
      // Exit 7 is a successful RPC with a nonzero process result, not RpcError.
      expect(task()).toMatchObject({ status: "success", message: `exited:${code}`, lines: expectedLines });
      expect(dom.document.body.textContent).toContain(`Exited with code ${code}`);
      expect(dom.document.body.textContent).not.toContain(auth.access_token);
      expect(dom.document.body.textContent).not.toContain(auth.session!);
      await act(async () => button("Close").click());
      await act(async () => button("Log").click());
      expect(rows().map(row => row.textContent)).toEqual(expectedLines.map(line => line.text));
      expect(rows()[2]!.classList.contains("min-h-5")).toBe(true);
      expect(dom.document.body.textContent).toContain(`Exited with code ${code}`);
      expect(opens).toBe((index + 1) * 2);
    }
    await act(async () => button("Close").click());
  }
  expect(authCloses).toBe(4);
  expect(scaffoldCalls.filter(method => method === "auth.minecraft.refresh_exchange")).toHaveLength(4);
  expect(scaffoldCalls.filter(method => method === "instance.list")).toHaveLength(1);
  expect(scaffoldCalls.filter(method => method === "account.microsoft.list")).toHaveLength(1);
  expect(launches.map(record => record.session)).toEqual([1, 1, 1, 2]);
});
