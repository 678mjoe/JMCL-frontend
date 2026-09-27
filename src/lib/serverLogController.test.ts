import { describe, expect, test } from "bun:test";
import { ServerLogController, MAX_SERVER_LOG_BUFFER_CHARS, isNearLogBottom } from "./serverLogController";
import type { ServerLogResult } from "./types";
import { translate } from "./i18n";

type Scope = { directory: string; sourceRevision: number };
const result = (text: string, patch: Partial<ServerLogResult> = {}): ServerLogResult => ({
  stage: "server.logs", id: "demo", text, file_id: 7, start_cursor: 0,
  next_cursor: text.length, eof: true, reset: false, truncated: false, ...patch,
});
function harness(options: { reads?: Array<() => Promise<ServerLogResult>>; commands?: Array<() => Promise<{ stage: "server.command"; id: string; accepted: true; pid: number }>>; now?: () => number } = {}) {
  let scope: Scope | null = { directory: "/a", sourceRevision: 1 };
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let timers = new Map<number, () => void>();
  let nextTimer = 0;
  let closes = 0, opens = 0;
  const reads = [...(options.reads ?? [async () => result("hello")])];
  const commands = [...(options.commands ?? [async () => ({ stage: "server.command" as const, id: "demo", accepted: true as const, pid: 3 })])];
  const controller = new ServerLogController({
    serverId: "demo",
    captureScope: () => scope,
    isScopeCurrent: (candidate) => !!scope && scope.directory === candidate.directory && scope.sourceRevision === candidate.sourceRevision,
    openSession: async () => {
      opens++;
      return {
        close: async () => { closes++; },
        serverLogs: async (...args: unknown[]) => { calls.push({ method: "logs", args }); const read = reads.shift(); if (read) return read(); return result("later"); },
        serverCommand: async (...args: unknown[]) => { calls.push({ method: "command", args }); const command = commands.shift(); if (command) return command(); throw { code: "SERVER_NOT_RUNNING" }; },
      };
    },
    setTimer: (callback, _delay) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });
  return { controller, calls, setScope: (value: Scope | null) => { scope = value; }, tick: () => { const entries = [...timers.values()]; timers.clear(); entries.forEach((fn) => fn()); }, timerCount: () => timers.size, opens: () => opens, closes: () => closes };
}

describe("ServerLogController", () => {
  test("initial read omits cursor and resume sends the exact cursor and file id", async () => {
    const h = harness({ reads: [async () => result("one", { next_cursor: 19, file_id: 41 }), async () => result("two", { start_cursor: 19, next_cursor: 22, file_id: 41 })] });
    await h.controller.open(); await h.controller.retry();
    expect(h.calls[0]?.args[2]).toEqual({ max_bytes: expect.any(Number) });
    expect(h.calls[1]?.args[2]).toEqual({ cursor: 19, file_id: 41, max_bytes: expect.any(Number) });
    expect(h.controller.getSnapshot().text).toBe("onetwo");
  });

  test("reset replaces text and rotates the paired cursor; truncation and local buffer omissions are visible", async () => {
    const h = harness({ reads: [async () => result("first", { truncated: true }), async () => result("replacement\n", { reset: true, file_id: 8, next_cursor: 12 }), async () => result("x".repeat(MAX_SERVER_LOG_BUFFER_CHARS + 2))] });
    await h.controller.open(); expect(h.controller.getSnapshot().truncated).toBe(true);
    await h.controller.retry(); expect(h.controller.getSnapshot().text).toBe("replacement\n");
    await h.controller.retry();
    expect(h.controller.getSnapshot().localOmission).toBe(true);
    expect(h.controller.getSnapshot().text.length).toBeLessThanOrEqual(MAX_SERVER_LOG_BUFFER_CHARS);
    expect(h.calls[2]?.args[2]).toMatchObject({ cursor: 12, file_id: 8 });
  });

  test("LOGS_NOT_FOUND is empty while other errors remain retryable", async () => {
    const h = harness({ reads: [async () => { throw { code: "SERVER_LOGS_NOT_FOUND" }; }, async () => { throw { code: "SERVER_IO", message: "file failed" }; }, async () => result("recovered")] });
    await h.controller.open(); expect(h.controller.getSnapshot()).toMatchObject({ notFound: true, error: null, empty: true });
    await h.controller.retry(); expect(h.controller.getSnapshot()).toMatchObject({ notFound: false, error: "SERVER_IO", loading: false });
    await h.controller.retry(); expect(h.controller.getSnapshot()).toMatchObject({ error: null, text: "recovered" });
  });

  test("polls only while running, serializes reads, and performs one final read after stop", async () => {
    let resolve!: (value: ServerLogResult) => void;
    const h = harness({ reads: [async () => result("first"), () => new Promise<ServerLogResult>((r) => { resolve = r; }), async () => result("final")] });
    await h.controller.open(); h.controller.setRunning(true); expect(h.calls.filter((c) => c.method === "logs")).toHaveLength(2);
    h.tick(); expect(h.calls.filter((c) => c.method === "logs")).toHaveLength(2);
    h.controller.setRunning(false); resolve(result("running")); await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(h.calls.filter((c) => c.method === "logs")).toHaveLength(3);
    await Promise.resolve(); expect(h.timerCount()).toBe(0);
  });

  test("stopped to running resumes polling once and timers are cleaned on close", async () => {
    const h = harness(); await h.controller.open(); h.controller.setRunning(true); await Promise.resolve();
    expect(h.timerCount()).toBe(1); h.tick(); await Promise.resolve();
    expect(h.calls.filter((c) => c.method === "logs").length).toBe(3);
    await h.controller.close(); expect(h.timerCount()).toBe(0); expect(h.closes()).toBe(1);
  });

  test("running prop set while closed starts one clean polling session and survives reopen", async () => {
    const h = harness({
      reads: [async () => result("boot"), async () => result("boot again"), async () => result("stopped reopen")],
      commands: [
        async () => ({ stage: "server.command", id: "demo", accepted: true, pid: 3 }),
        async () => ({ stage: "server.command", id: "demo", accepted: true, pid: 4 }),
      ],
    });
    // React runs the prop synchronization effect while the panel is still closed.
    h.controller.setRunning(true);
    expect(h.calls.filter((call) => call.method === "logs")).toHaveLength(0);
    expect(h.timerCount()).toBe(0);
    await h.controller.open();
    expect(h.controller.getSnapshot()).toMatchObject({ open: true, running: true, text: "boot" });
    expect(h.calls.filter((call) => call.method === "logs")).toHaveLength(1);
    expect(h.timerCount()).toBe(1);
    expect(await h.controller.submitCommand("say ready")).toBe(true);
    expect(h.calls.filter((call) => call.method === "command")).toHaveLength(1);
    await h.controller.close();
    expect(h.controller.getSnapshot().running).toBe(false);
    await h.controller.open();
    expect(h.controller.getSnapshot()).toMatchObject({ open: true, running: true, text: "boot again" });
    expect(h.calls.filter((call) => call.method === "logs")).toHaveLength(2);
    expect(h.timerCount()).toBe(1);
    expect(await h.controller.submitCommand("say again")).toBe(true);
    expect(h.calls.filter((call) => call.method === "command")).toHaveLength(2);
    await h.controller.close();
    h.controller.setRunning(false);
    await h.controller.open();
    expect(h.controller.getSnapshot()).toMatchObject({ open: true, running: false, text: "stopped reopen" });
    expect(h.timerCount()).toBe(0);
    expect(await h.controller.submitCommand("say stopped")).toBe(false);
  });

  test("close and source switch make stale responses inert and scope state independent", async () => {
    let resolve!: (value: ServerLogResult) => void;
    const h = harness({ reads: [() => new Promise<ServerLogResult>((r) => { resolve = r; })] });
    const pending = h.controller.open(); await Promise.resolve(); await h.controller.close();
    resolve(result("stale")); await pending; expect(h.controller.getSnapshot().text).toBe(""); expect(h.closes()).toBe(1);
    h.setScope({ directory: "/b", sourceRevision: 2 }); await h.controller.open();
    expect(h.controller.getSnapshot().text).not.toBe("stale");
  });

  test("switching an open panel to a new source closes its session and starts a clean read", async () => {
    let resolve!: (value: ServerLogResult) => void;
    const h = harness({ reads: [() => new Promise<ServerLogResult>((r) => { resolve = r; }), async () => result("new source")] });
    const oldRead = h.controller.open(); await Promise.resolve();
    h.setScope({ directory: "/b", sourceRevision: 2 });
    const newRead = h.controller.open(); resolve(result("stale source"));
    await Promise.all([oldRead, newRead]);
    expect(h.closes()).toBe(1);
    expect(h.controller.getSnapshot().text).toBe("new source");
    expect(h.calls[1]?.args.slice(0, 2)).toEqual(["/b", "demo"]);
  });

  test("a source change detected by a late response closes the stale session and ignores its result", async () => {
    let resolve!: (value: ServerLogResult) => void;
    const h = harness({ reads: [() => new Promise<ServerLogResult>((r) => { resolve = r; }), async () => result("new scope")] });
    const pending = h.controller.open(); await Promise.resolve();
    h.setScope({ directory: "/b", sourceRevision: 2 });
    resolve(result("stale")); await pending;
    expect(h.closes()).toBe(1);
    expect(h.controller.getSnapshot()).toMatchObject({ open: false, text: "" });
    // The shown panel's scope effect calls open after invalidation, even though state.open is false.
    await h.controller.open();
    expect(h.controller.getSnapshot()).toMatchObject({ open: true, text: "new scope" });
    expect(h.calls[1]?.args.slice(0, 2)).toEqual(["/b", "demo"]);
  });

  test("close during an RPC error still closes the session once and cancels its timer", async () => {
    const h = harness({ reads: [async () => { throw { code: "SERVER_IO" }; }] });
    await h.controller.open(); h.controller.setRunning(true);
    await h.controller.close(); await h.controller.close();
    expect(h.closes()).toBe(1); expect(h.timerCount()).toBe(0);
    expect(h.controller.getSnapshot().open).toBe(false);
  });

  test("repeated open is idempotent and commands validate, serialize, and do not append optimistically", async () => {
    const h = harness(); await Promise.all([h.controller.open(), h.controller.open()]);
    expect(h.opens()).toBe(1);
    h.controller.setRunning(true);
    expect(await h.controller.submitCommand("  \n ")).toBe(false);
    expect(h.controller.getSnapshot().validationError).toBe("empty");
    expect(await h.controller.submitCommand("\nsay hello")).toBe(false);
    expect(h.controller.getSnapshot().validationError).toBe("multiline");
    expect(await h.controller.submitCommand("say hello\nthere")).toBe(false);
    expect(h.calls.filter((c) => c.method === "command")).toHaveLength(0);
    const textBeforeCommand = h.controller.getSnapshot().text;
    expect(await h.controller.submitCommand("  say hello  ")).toBe(true);
    expect(h.calls.filter((c) => c.method === "command")[0]?.args[2]).toBe("say hello");
    expect(h.controller.getSnapshot().text).toBe(textBeforeCommand);
    expect(h.controller.getSnapshot().acceptedNotice).toBe(true);
  });

  test("accepted commands leave log text unchanged and make no follow-up RPC", async () => {
    const h = harness({ reads: [async () => result("existing output") ] });
    await h.controller.open();
    h.controller.setRunning(true);
    await Promise.resolve();
    const textBefore = h.controller.getSnapshot().text;
    const logCallsBefore = h.calls.filter((call) => call.method === "logs").length;
    const statusCallsBefore = h.calls.filter((call) => call.method === "status").length;
    expect(await h.controller.submitCommand("say hello")).toBe(true);
    expect(h.controller.getSnapshot().text).toBe(textBefore);
    expect(h.calls.filter((call) => call.method === "command")).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === "logs")).toHaveLength(logCallsBefore);
    expect(h.calls.filter((call) => call.method === "status")).toHaveLength(statusCallsBefore);
  });

  test("stopped consoles cannot submit commands", async () => {
    const h = harness(); await h.controller.open();
    expect(await h.controller.submitCommand("say no")).toBe(false);
    expect(h.calls.filter((call) => call.method === "command")).toHaveLength(0);
  });

  test("a pending command is exclusive, sends once, and a close makes its completion inert", async () => {
    let resolve!: (value: { stage: "server.command"; id: string; accepted: true; pid: number }) => void;
    const h = harness({ commands: [() => new Promise((r) => { resolve = r; })] });
    await h.controller.open(); h.controller.setRunning(true);
    const beforeLogs = h.calls.filter((c) => c.method === "logs").length;
    const pending = h.controller.submitCommand("say hi");
    expect(h.controller.getSnapshot().commandPending).toBe(true);
    expect(await h.controller.submitCommand("say twice")).toBe(false);
    expect(h.calls.filter((c) => c.method === "command")).toHaveLength(1);
    expect(h.calls.filter((c) => c.method === "logs")).toHaveLength(beforeLogs);
    await h.controller.close(); resolve({ stage: "server.command", id: "demo", accepted: true, pid: 3 });
    expect(await pending).toBe(false); expect(h.controller.getSnapshot().acceptedNotice).toBe(false);
  });

  test("command errors expose stable codes and leave log text untouched", async () => {
    const h = harness({ commands: [async () => { throw { code: "COMMAND_REJECTED", message: "unstable wording" }; }] });
    await h.controller.open(); h.controller.setRunning(true);
    await h.controller.retry();
    const textBefore = h.controller.getSnapshot().text;
    expect(await h.controller.submitCommand("say hi")).toBe(false);
    expect(h.controller.getSnapshot()).toMatchObject({ commandPending: false, commandError: "COMMAND_REJECTED", text: textBefore });
  });

  test("near-bottom helper distinguishes follow from user scrollback", () => {
    expect(isNearLogBottom({ scrollTop: 80, scrollHeight: 100, clientHeight: 30 })).toBe(true);
    expect(isNearLogBottom({ scrollTop: 5, scrollHeight: 100, clientHeight: 30 })).toBe(false);
  });

  test("console labels are present in both zh and en", () => {
    expect(translate("zh", "serverConsole.open")).toBe("打开控制台");
    expect(translate("en", "serverConsole.open")).toBe("Open console");
    expect(translate("zh", "serverConsole.accepted")).toContain("输出会在日志中显示");
    expect(translate("en", "serverConsole.accepted")).toContain("output will appear in logs");
  });
});
