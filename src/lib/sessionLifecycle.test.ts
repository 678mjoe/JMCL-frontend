import { describe, expect, test } from "bun:test";
import {
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
