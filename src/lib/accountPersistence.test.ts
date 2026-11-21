import { expect, test } from "bun:test";
import { finishDeviceLogin, persistRefreshResult, PENDING_DEVICE_LOGIN } from "./accountPersistence";
import type { RefreshExchangeResult } from "./types";

const profile = { id: "0123456789abcdef0123456789abcdef", player_name: "Fixture", client_id: "fixture-client" };

function memoryWrites() {
  const vault = new Map([[PENDING_DEVICE_LOGIN, "fixture-pending"], ["production-sentinel", "untouched"]]);
  const operations: string[] = [];
  const writes = {
    credentialSet: async (id: string, value: string) => { vault.set(id, value); operations.push("credential_write"); },
    credentialDelete: async (id: string) => { vault.delete(id); operations.push("credential_delete"); },
    accountSave: async () => { operations.push("account_write"); return { stage: "save" as const, account: profile }; },
  };
  return { vault, operations, writes };
}

test("device login commits profile then clears only the pending slot", async () => {
  const { vault, writes, operations } = memoryWrites();
  await finishDeviceLogin(profile, "fixture-final", writes);
  expect(operations).toEqual(["credential_write", "account_write", "credential_delete"]);
  expect(vault.get(profile.id)).toBe("fixture-final");
  expect(vault.has(PENDING_DEVICE_LOGIN)).toBe(false);
  expect(vault.get("production-sentinel")).toBe("untouched");
});

test("failed or mismatched metadata acknowledgment preserves recovery slot", async () => {
  const { vault, writes, operations } = memoryWrites();
  await expect(finishDeviceLogin(profile, "fixture-final", {
    ...writes, accountSave: async () => { throw new Error("test refusal"); },
  })).rejects.toThrow("test refusal");
  await expect(finishDeviceLogin(profile, "fixture-final", {
    ...writes, accountSave: async () => ({ stage: "save", account: { ...profile, id: "not-the-profile" } }),
  })).rejects.toThrow("not acknowledged");
  expect(vault.get(PENDING_DEVICE_LOGIN)).toBe("fixture-pending");
  expect(operations).toEqual(["credential_write", "credential_write"]);
});

test("exchange failure retains rotated token so the next request can use it", async () => {
  const { vault, writes, operations } = memoryWrites();
  vault.set(profile.id, "fixture-old");
  const failed: RefreshExchangeResult = { state: "exchange_failed", refresh_token: "fixture-rotated" };
  const received = await persistRefreshResult(profile.id, failed, writes.credentialSet);
  expect(received.state).toBe("exchange_failed");
  expect(vault.get(profile.id)).toBe("fixture-rotated");
  expect(operations).toEqual(["credential_write"]);
  expect(vault.get("production-sentinel")).toBe("untouched");
});
