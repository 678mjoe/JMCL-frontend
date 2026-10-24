import { describe, expect, test } from "bun:test";
import { parseGcAge, StoreGcController, type StoreGcParams, type StoreGcResult, type StoreGcSession } from "./storeGc";
export const gcResult = (dry_run = true): StoreGcResult => ({ dry_run, min_age_seconds: 86400, summary: { objects_scanned: 10, objects_eligible: 3, objects_deleted: dry_run ? 0 : 2, bytes_eligible: 30, bytes_deleted: dry_run ? 0 : 20, objects_linked: 2, objects_young: 3, objects_ignored: 1, objects_busy: 2, errors: 0 } });
function harness(action: (params: StoreGcParams) => Promise<unknown> = async (params) => gcResult(params.dry_run)) {
  const calls: StoreGcParams[] = []; let closes = 0;
  const session: StoreGcSession = { storeGc: async (params) => { calls.push(params); return action(params); }, close: async () => { closes++; } };
  const controller = new StoreGcController(async () => session); controller.configure("/synthetic/store", 86400, "scope");
  return { controller, calls, session, get closes() { return closes; } };
}
describe("store GC safety", () => {
  test("age uses exact nonnegative safe integers, zero is explicit", () => {
    for (const bad of ["", "-1", "1.1", "1e3", " 1", "9007199254740992"]) expect(parseGcAge(bad)).toBeNull();
    expect(parseGcAge("0")).toBe(0); expect(parseGcAge("86400")).toBe(86400);
  });
  test("dry run required, exact directory confirmation, execute rescans and consumes preview", async () => {
    const h = harness(); expect(await h.controller.execute("/synthetic/store")).toBe(false);
    expect(await h.controller.preview()).toBe(true); expect(await h.controller.execute("store")).toBe(false);
    expect(await h.controller.execute("/synthetic/store")).toBe(true);
    expect(h.calls).toEqual([{ store_directory: "/synthetic/store", dry_run: true, min_age_seconds: 86400 }, { store_directory: "/synthetic/store", dry_run: false, min_age_seconds: 86400 }]);
    expect(h.controller.getSnapshot().result?.summary.objects_deleted).toBe(2);
    expect(await h.controller.execute("/synthetic/store")).toBe(false); expect(h.closes).toBe(2);
  });
  test("partial failure never invents a zero deletion summary or enables retry", async () => {
    const h = harness(async (p) => { if (p.dry_run) return gcResult(); throw { code: "STORE_GC_PARTIAL", message: "PRIVATE" }; });
    await h.controller.preview(); expect(await h.controller.execute("/synthetic/store")).toBe(false);
    expect(h.controller.getSnapshot()).toEqual({ pending: false, preview: null, result: null, error: "STORE_GC_PARTIAL" });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("PRIVATE"); expect(await h.controller.execute("/synthetic/store")).toBe(false);
  });
  test("path, age and settings changes invalidate preview", async () => {
    const h = harness();
    for (const args of [["/synthetic/other", 86400, "scope"], ["/synthetic/store", 0, "scope"], ["/synthetic/store", 86400, "new scope"]] as const) {
      h.controller.configure("/synthetic/store", 86400, "scope"); await h.controller.preview(); h.controller.configure(args[0], args[1], args[2]);
      expect(h.controller.getSnapshot().preview).toBeNull(); expect(await h.controller.execute(args[0])).toBe(false);
    }
  });
  test("duplicate requests are excluded and stale response discarded", async () => {
    let finish!: (value: unknown) => void; const h = harness(() => new Promise((resolve) => { finish = resolve; }));
    const first = h.controller.preview(); await Promise.resolve(); expect(await h.controller.preview()).toBe(false);
    h.controller.configure("/synthetic/new", 86400, "new"); finish(gcResult()); expect(await first).toBe(false);
    expect(h.controller.getSnapshot().preview).toBeNull(); expect(h.calls).toHaveLength(1); expect(h.closes).toBe(1);
  });
  test("late open after dispose is closed without RPC", async () => {
    const h = harness(); let finish!: (s: StoreGcSession) => void;
    const c = new StoreGcController(() => new Promise((resolve) => { finish = resolve; })); c.configure("/synthetic/store", 86400, "scope");
    const pending = c.preview(); c.dispose(); finish(h.session); expect(await pending).toBe(false); expect(h.calls).toHaveLength(0); expect(h.closes).toBe(1);
  });
  test("malformed or mismatched success is not accepted", async () => {
    for (const bad of [{}, { ...gcResult(), dry_run: false }, { ...gcResult(), min_age_seconds: 0 }, { ...gcResult(), summary: { ...gcResult().summary, errors: 1 } }, { ...gcResult(), summary: { ...gcResult().summary, objects_deleted: 1 } }]) {
      const h = harness(async () => bad); expect(await h.controller.preview()).toBe(false); expect(h.controller.getSnapshot().error).toBe("INVALID_RESULT"); expect(h.controller.getSnapshot().preview).toBeNull();
    }
  });
  test("cancel clears a preview, reopening needs another preview", async () => {
    const h = harness(); await h.controller.preview(); h.controller.cancelPreview(); expect(await h.controller.execute("/synthetic/store")).toBe(false); await h.controller.preview(); expect(h.controller.getSnapshot().preview).not.toBeNull();
  });
});
