import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "./launcher";
import { TasksProvider, useTasks } from "./tasks";
import type { CoreSession } from "./rpc";
import type { InstanceManifest } from "./types";

const dom = new (await import("happy-dom")).Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; });
const instance: InstanceManifest = { id: "fixture", name: "Fixture", version_id: "1.21.4", source: "official", fabric_loader: null, neoforge_version: null, forge_version: null, installed: false };
async function mount(openSession: () => Promise<CoreSession>) {
  let tasks!: ReturnType<typeof useTasks>;
  function Capture() { tasks = useTasks(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession }}><TasksProvider><Capture /></TasksProvider></LauncherContext.Provider>); });
  return () => tasks;
}
describe("ordinary install shared progress integration", () => {
  test("repeated clicks do not replace active progress or open duplicate sessions; guard releases on error", async () => {
    let opens = 0;
    let reject!: (error: unknown) => void;
    const current = await mount(async () => {
      opens++;
      return { close: async () => {}, installExecute: async (_id: string, _opts: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ kind: "event", data: { event: "processor_started", source: "official", processor_started: { stage: "processor", index: 2, total: 3, name: "private" } } });
        await new Promise((_, fail) => { reject = fail; });
      } } as unknown as CoreSession;
    });
    let pending!: Promise<void>;
    await act(async () => { pending = current().startInstall(instance, { instancesDir: "/fixture/instances", storeDir: "/fixture/store" }); });
    expect(opens).toBe(1);
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.installProgress?.detail).toEqual({ kind: "processor", index: 2, total: 3 });
    await act(async () => { await current().startInstall(instance, { instancesDir: "/fixture/instances", storeDir: "/fixture/store" }); });
    expect(opens).toBe(1); expect(current().taskFor("install", instance.id, "/fixture/instances")?.status).toBe("running");
    await act(async () => { reject(new Error("synthetic failure")); await pending; });
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.status).toBe("error");
    await act(async () => { pending = current().startInstall(instance, { instancesDir: "/fixture/instances", storeDir: "/fixture/store" }); });
    expect(opens).toBe(2);
    await act(async () => { reject(new Error("synthetic failure")); await pending; });
  });
  test("Java detail clears before prepare; dedicated session closes only after completion", async () => {
    let onEvent!: (event: unknown) => void;
    let finishInstall!: () => void;
    let finishPrepare!: () => void;
    let closed = 0;
    const current = await mount(async () => ({
      close: async () => { closed++; },
      installExecute: async (_id: string, _opts: unknown, handle: (event: unknown) => void) => { onEvent = handle; await new Promise<void>(resolve => { finishInstall = resolve; }); },
      installPrepare: async () => { await new Promise<void>(resolve => { finishPrepare = resolve; }); },
    }) as unknown as CoreSession);
    let pending!: Promise<void>;
    await act(async () => { pending = current().startInstall(instance, { instancesDir: "/fixture/instances", storeDir: "/fixture/store" }); });
    await act(async () => { onEvent({ kind: "event", data: { event: "stage", stage: "extracting" } }); });
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.stage).toBe("task.stage.java");
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.installProgress?.detail).toEqual({ kind: "java", phase: "extracting" });
    await act(async () => { finishInstall(); });
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.stage).toBe("task.stage.prepare");
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.installProgress).toBeUndefined();
    expect(closed).toBe(0);
    await act(async () => { finishPrepare(); await pending; });
    expect(current().taskFor("install", instance.id, "/fixture/instances")?.status).toBe("success"); expect(closed).toBe(1);
  });
});


describe("ordinary installation root identity", () => {
  test("same ID in two roots keeps independent progress, completion and clear actions", async () => {
    const requests = new Map<string, { emit: (event: unknown) => void; finish: () => void }>();
    let opens = 0;
    const current = await mount(async () => {
      opens++;
      return {
        close: async () => {},
        installExecute: async (_id: string, opts: { directory: string }, emit: (event: unknown) => void) => {
          await new Promise<void>(finish => requests.set(opts.directory, { emit, finish }));
        },
        installPrepare: async () => ({}),
      } as unknown as CoreSession;
    });
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = current().startInstall(instance, { instancesDir: "/root-a", storeDir: "/store" }); });
    expect(current().taskFor("install", instance.id, "/root-b")).toBeUndefined();
    expect(current().taskFor("install", instance.id)).toBeUndefined();
    await act(async () => { second = current().startInstall(instance, { instancesDir: "/root-b", storeDir: "/store" }); });
    expect(opens).toBe(2); expect(Object.keys(current().tasks)).toHaveLength(2);
    const event = (index: number) => ({ kind: "event", data: { event: "processor_started", source: "official", processor_started: { stage: "processor", index, total: 4, name: "fixture" } } });
    await act(async () => {
      requests.get("/root-a/fixture/.minecraft")!.emit(event(1));
      requests.get("/root-b/fixture/.minecraft")!.emit(event(3));
    });
    expect(current().taskFor("install", instance.id, "/root-a")?.installProgress?.detail).toEqual({ kind: "processor", index: 1, total: 4 });
    expect(current().taskFor("install", instance.id, "/root-b")?.installProgress?.detail).toEqual({ kind: "processor", index: 3, total: 4 });
    await act(async () => { await current().startInstall(instance, { instancesDir: "/root-a/./", storeDir: "/store" }); });
    expect(opens).toBe(2);
    await act(async () => { requests.get("/root-a/fixture/.minecraft")!.finish(); await first; });
    expect(current().taskFor("install", instance.id, "/root-a/")?.status).toBe("success");
    expect(current().taskFor("install", instance.id, "/root-b")?.status).toBe("running");
    await act(async () => { current().clearTask("install", instance.id, "/root-a/./"); });
    expect(current().taskFor("install", instance.id, "/root-a")).toBeUndefined();
    expect(current().taskFor("install", instance.id, "/root-b")?.status).toBe("running");
    await act(async () => { current().clearTask("install", instance.id); });
    expect(current().taskFor("install", instance.id, "/root-b")?.status).toBe("running");
    await act(async () => { requests.get("/root-b/fixture/.minecraft")!.finish(); await second; });
    expect(current().taskFor("install", instance.id, "/root-b")?.status).toBe("success");
  });
});
