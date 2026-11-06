import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LauncherContext } from "@/lib/launcher";
import { SettingsProvider } from "@/lib/settings";
import { TasksProvider, useTasks } from "@/lib/tasks";
import { CoreSession, type CoreEvent, type EventHandler } from "@/lib/rpc";
import { mockRequest, resetMockFixture } from "@/lib/mockTransport";
import type { InstanceManifest } from "@/lib/types";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom, document: dom.document, localStorage: dom.localStorage,
  HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
  Event: dom.Event, MouseEvent: dom.MouseEvent,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  ResizeObserver: dom.ResizeObserver,
  MutationObserver: dom.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { LogSheet } = await import("./LogSheet");
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  dom.document.body.replaceChildren();
  localStorage.clear();
  resetMockFixture("default");
});

test("mock launch keeps a blank log row with its minimum-height class through close and reopen", async () => {
  resetMockFixture("default");
  localStorage.setItem("jmcl.settings.v1", JSON.stringify({
    language: "en", instancesDir: "/instances", storeDir: "/store", serversDir: "/servers",
  }));
  const instance: InstanceManifest = {
    id: "demo", name: "Demo", version_id: "fixture", source: "official", installed: true,
    fabric_loader: null, neoforge_version: null, forge_version: null,
  };
  let launches = 0;
  let closes = 0;
  // Use the same wrapper and Mock dispatcher as browser acceptance, including
  // its pre-existing core diagnostic rather than a separate partial fixture.
  const session = CoreSession.createForTesting(<T, E extends CoreEvent>(
    method: string, params: Record<string, unknown>, onEvent?: EventHandler<E>,
  ) => {
    if (method === "launch.execute") {
      launches++;
    }
    return mockRequest<T>(method, params, onEvent as never);
  });
  session.close = async () => { closes++; };
  let start!: () => Promise<void>;
  let reopen!: () => void;
  function Fixture() {
    const tasks = useTasks();
    const [open, setOpen] = useState(true);
    start = () => tasks.startLaunch(instance, { instancesDir: "/instances", storeDir: "/store" },
      { player_name: "Fixture", uuid: "fixture", access_token: "synthetic" });
    reopen = () => setOpen(true);
    return <LogSheet instanceId={open ? "demo" : null} onOpenChange={setOpen} />;
  }
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(
    <SettingsProvider>
      <LauncherContext.Provider value={{ status: "ready", core: null, error: null, session: null, openSession: async () => session }}>
        <TasksProvider><Fixture /></TasksProvider>
      </LauncherContext.Provider>
    </SettingsProvider>,
  ));
  await act(async () => start());
  const rows = () => [...dom.document.querySelectorAll('[data-slot="launch-log-line"]')];
  const expectedRows = ["[mock core] launch session connected", "[mock] starting", "[mock] ready", "", "[mock] warning"];
  expect(rows().map(row => row.textContent)).toEqual(expectedRows);
  expect(rows()[3]!.classList.contains("min-h-5")).toBe(true);
  expect(dom.document.body.textContent).toContain("Exited with code 0");
  const close = [...dom.document.querySelectorAll("button")].find(button => button.textContent === "Close")!;
  expect(close).toBeDefined();
  await act(async () => close.click());
  expect(dom.document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => reopen());
  expect(rows().map(row => row.textContent)).toEqual(expectedRows);
  expect(rows()[3]!.classList.contains("min-h-5")).toBe(true);
  expect(launches).toBe(1);
  expect(closes).toBe(1);
});
