import { expect, test } from "bun:test";
import { canUpdate, createUpdateController, unconfiguredUpdate, type UpdateSnapshot, type UpdateTransport } from "./updates";
const snapshot = (phase: UpdateSnapshot["phase"]): UpdateSnapshot => ({ ...unconfiguredUpdate, phase, channel: "synthetic", version: "0.2.0" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
test("default/browser transport is unconfigured and ignores runtime preferences", async () => {
  const controller = createUpdateController();
  await controller.refresh();
  expect(controller.getSnapshot().snapshot.phase).toBe("unconfigured");
  await controller.act("check");
  expect(controller.getSnapshot().snapshot.phase).toBe("unconfigured");
});
test("single flight, stale status fencing, verified phase ordering and discard", async () => {
  const result = deferred<UpdateSnapshot>();
  let calls = 0;
  const transport: UpdateTransport = { status: async () => snapshot("available"), action: async () => { calls++; return result.promise; } };
  const controller = createUpdateController(transport);
  await controller.refresh();
  await controller.act("install");
  expect(calls).toBe(0);
  const first = controller.act("download");
  await controller.act("download");
  await controller.act("discard");
  expect(calls).toBe(1);
  result.resolve(snapshot("downloaded"));
  await first;
  expect(controller.getSnapshot().snapshot.phase).toBe("downloaded");
  expect(canUpdate("downloaded", "install")).toBe(true);
  expect(canUpdate("downloaded", "restart")).toBe(false);
});
test("late pre-operation status never overwrites completed action", async () => {
  const late = deferred<UpdateSnapshot>(); let reads = 0;
  const controller = createUpdateController({ status: () => ++reads === 1 ? Promise.resolve(snapshot("available")) : late.promise, action: async () => snapshot("downloaded") });
  await controller.refresh(); const pending = controller.refresh();
  await controller.act("download"); late.resolve(snapshot("available")); await pending;
  expect(controller.getSnapshot().snapshot.phase).toBe("downloaded");
});
test("bridge errors block actions until successful status recovery; native error retries check only", async () => {
  let fail = true; let calls = 0;
  const controller = createUpdateController({ status: async () => snapshot("idle"), action: async () => { calls++; if (fail) throw Error("secret transport details"); return snapshot("error"); } });
  await controller.refresh(); await controller.act("check");
  expect(controller.getSnapshot().bridgeError).toBe(true);
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("secret");
  await controller.act("check"); expect(calls).toBe(1);
  fail = false; await controller.refresh(); await controller.act("check");
  expect(controller.getSnapshot().snapshot.phase).toBe("error");
  expect(canUpdate("error", "install")).toBe(false);
  expect(canUpdate("error", "check")).toBe(true);
});
