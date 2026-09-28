import { describe, expect, test } from "bun:test";
import {
  SessionOwner,
  withCancellableOpenedSession,
  withOpenedSession,
} from "./sessionLifecycle";

describe("withOpenedSession", () => {
  test("propagates an opening failure", async () => {
    await expect(withOpenedSession(async () => { throw new Error("open failed"); }, async () => "never")).rejects.toThrow("open failed");
  });

  test("propagates a closing failure after a successful RPC", async () => {
    await expect(withOpenedSession(async () => ({ close: async () => { throw new Error("close failed"); } }), async () => "ok")).rejects.toThrow("close failed");
  });

  test("closes a session that resolves after login cancellation", async () => {
    let closed = false;
    const result = await withCancellableOpenedSession(
      async () => ({ close: async () => { closed = true; } }),
      () => true,
      async () => "must not run",
    );
    expect(result).toBeUndefined();
    expect(closed).toBe(true);
  });
});

describe("SessionOwner", () => {
  test("source cleanup closes the persistent control session", async () => {
    let closeCount = 0;
    const owner = new SessionOwner<{ close: () => Promise<void> }>();
    const session = { close: async () => { closeCount++; } };
    expect(await owner.open(async () => session)).toBe(session);
    await owner.close();
    expect(closeCount).toBe(1);
  });

  test("unmount during session open closes the late session without adopting it", async () => {
    let resolve!: (session: { close: () => Promise<void> }) => void;
    let closeCount = 0;
    const owner = new SessionOwner<{ close: () => Promise<void> }>();
    const opening = owner.open(() => new Promise((r) => { resolve = r; }));
    await owner.close();
    resolve({ close: async () => { closeCount++; } });
    expect(await opening).toBeNull();
    expect(closeCount).toBe(1);
  });
});
