import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "./launcher";
import { TasksProvider, useTasks } from "./tasks";
import type { LaunchEvent } from "./launchRunner";
import type { CoreSession } from "./rpc";
import type { AuthSession, InstanceManifest } from "./types";

const dom = new (await import("happy-dom")).Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; });
const instance: InstanceManifest = {
  id: "demo", name: "Demo", version_id: "1.21.4", source: "official",
  fabric_loader: null, neoforge_version: null, forge_version: null, installed: true,
};
const auth: AuthSession = { player_name: "Fixture", uuid: "fixture", access_token: "synthetic" };
const dirs = (instancesDir: string) => ({ instancesDir, storeDir: "/store" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function launchSession() {
  const result = deferred<{ process: { termination: string; exit_code: number } }>();
  let emit!: (event: LaunchEvent) => void;
  let closed = 0;
  const calls: unknown[][] = [];
  const session = {
    close: async () => { closed++; },
    launchExecute: async (...args: unknown[]) => {
      calls.push(args.slice(0, -1));
      emit = args.at(-1) as typeof emit;
      return result.promise;
    },
  } as unknown as CoreSession;
  return {
    session, calls, emit: (event: LaunchEvent) => emit(event), closed: () => closed,
    finish: () => result.resolve({ process: { termination: "exited", exit_code: 0 } }),
    fail: () => result.reject(new Error("synthetic launch failure")),
  };
}
async function mount(openSession: () => Promise<CoreSession>) {
  let tasks!: ReturnType<typeof useTasks>;
  function Capture() { tasks = useTasks(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(
    <LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession }}>
      <TasksProvider><Capture /></TasksProvider>
    </LauncherContext.Provider>,
  ));
  return () => tasks;
}
const started = (pid: number): LaunchEvent => ({ kind: "event", data: { event: "started", started: { pid } } });
const output = (text: string): LaunchEvent => ({ kind: "event", data: { event: "stdout", stdout: { encoding: "base64", end: "newline", data: btoa(text) } } });

describe("launch task ownership", () => {
  test("same-root repeat clicks cannot replace tasks while opening; inputs are captured before await", async () => {
    const opening = deferred<CoreSession>();
    const launch = launchSession();
    let opens = 0;
    const current = await mount(() => { opens++; return opening.promise; });
    const mutableDirs = dirs("/root-a");
    let pending!: Promise<void>;
    await act(async () => {
      pending = current().startLaunch(instance, mutableDirs, auth);
      void current().startLaunch(instance, dirs("/root-a/./"), auth);
    });
    mutableDirs.instancesDir = "/root-b";
    mutableDirs.storeDir = "/other-store";
    // Complete even on an assertion failure so no RPC or session remains pending.
    await act(async () => { opening.resolve(launch.session); launch.finish(); await pending; });
    expect(opens).toBe(1);
    expect(launch.calls).toHaveLength(1);
    expect(launch.calls[0]![1]).toBe("/root-a/demo/.minecraft");
    expect(launch.calls[0]![3]).toMatchObject({ store_directory: "/store" });
    expect(current().taskFor("launch", "demo", "/root-a/")?.status).toBe("success");
    expect(current().taskFor("launch", "demo", "/root-b")).toBeUndefined();
    expect(current().taskFor("launch", "demo")).toBeUndefined();
    expect(launch.closed()).toBe(1);
  });

  test("same IDs in different roots keep late PID/log events, completion and clearing independent", async () => {
    const a = launchSession();
    const b = launchSession();
    const sessions = [a.session, b.session];
    let opens = 0;
    const current = await mount(async () => sessions[opens++]!);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = current().startLaunch(instance, dirs("/root-a"), auth); });
    try {
      expect(current().taskFor("launch", "demo", "/root-b")).toBeUndefined();
      await act(async () => { second = current().startLaunch(instance, dirs("/root-b"), auth); });
      await act(async () => {
        b.emit(started(222)); b.emit(output("root B"));
        a.emit(started(111)); a.emit(output("late root A"));
      });
      await act(async () => { await current().startLaunch(instance, dirs("/root-a/./"), auth); });
      expect(opens).toBe(2);
      expect(Object.keys(current().tasks)).toHaveLength(2);
      expect(current().taskFor("launch", "demo", "/root-a")).toMatchObject({ instancesDir: "/root-a", pid: 111, lines: [{ stream: "stdout", text: "late root A" }] });
      expect(current().taskFor("launch", "demo", "/root-b")).toMatchObject({ instancesDir: "/root-b", pid: 222, lines: [{ stream: "stdout", text: "root B" }] });
      await act(async () => { a.finish(); await first; });
      expect(current().taskFor("launch", "demo", "/root-a")?.status).toBe("success");
      expect(current().taskFor("launch", "demo", "/root-b")?.status).toBe("running");
      await act(async () => { current().clearTask("launch", "demo", "/root-a/./"); current().clearTask("launch", "demo"); });
      expect(current().taskFor("launch", "demo", "/root-a")).toBeUndefined();
      expect(current().taskFor("launch", "demo", "/root-b")?.pid).toBe(222);
    } finally {
      await act(async () => { a.finish(); b.finish(); await first; await second; });
    }
    expect(opens).toBe(2);
    expect(a.closed()).toBe(1); expect(b.closed()).toBe(1);
  });

  test("clearing a running task hides it without admitting duplicate launch or resurrecting it", async () => {
    const launch = launchSession();
    let opens = 0;
    const current = await mount(async () => { opens++; return launch.session; });
    let pending!: Promise<void>;
    await act(async () => { pending = current().startLaunch(instance, dirs("/root"), auth); });
    await act(async () => {
      current().clearTask("launch", "demo", "/root");
      void current().startLaunch(instance, dirs("/root/./"), auth);
      launch.emit(started(123)); launch.emit(output("late output"));
      launch.finish(); await pending;
    });
    expect(opens).toBe(1);
    expect(current().taskFor("launch", "demo", "/root")).toBeUndefined();
  });

  for (const outcome of ["success", "error"] as const) test(`a ${outcome} launch releases its guard; stale callbacks cannot alter its replacement`, async () => {
    const old = launchSession();
    const next = launchSession();
    const sessions = [old.session, next.session];
    let opens = 0;
    const current = await mount(async () => sessions[opens++]!);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = current().startLaunch(instance, dirs("/root"), auth); });
    await act(async () => { outcome === "success" ? old.finish() : old.fail(); await first; });
    expect(current().taskFor("launch", "demo", "/root")?.status).toBe(outcome);
    await act(async () => { second = current().startLaunch(instance, dirs("/root"), auth); });
    try {
      await act(async () => {
        next.emit(started(200)); next.emit(output("new log"));
        old.emit(started(100)); old.emit(output("old log"));
        old.emit({ kind: "diagnostic", data: "old diagnostic" });
        old.emit({ kind: "event", data: { event: "stage", stage: "extracting" } });
      });
      expect(current().taskFor("launch", "demo", "/root")).toMatchObject({
        status: "running", pid: 200, stage: "task.stage.launch",
        lines: [{ stream: "stdout", text: "new log" }],
      });
    } finally {
      await act(async () => { next.finish(); await second; });
    }
    expect(opens).toBe(2);
  });

  test("session opening failure releases the launch guard for retry", async () => {
    const launch = launchSession();
    let opens = 0;
    const current = await mount(async () => { if (++opens === 1) throw new Error("synthetic open failure"); return launch.session; });
    await act(async () => { await current().startLaunch(instance, dirs("/root"), auth); });
    expect(current().taskFor("launch", "demo", "/root")?.status).toBe("error");
    let pending!: Promise<void>;
    await act(async () => { pending = current().startLaunch(instance, dirs("/root"), auth); });
    await act(async () => { launch.finish(); await pending; });
    expect(opens).toBe(2);
    expect(current().taskFor("launch", "demo", "/root")?.status).toBe("success");
  });
});
