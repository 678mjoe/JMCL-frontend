import { expect, test } from "bun:test";
import { CoreSession } from "./rpc";
import { mockRequest, resetMockFixture } from "./mockTransport";

const profile = { id: "0123456789abcdef0123456789abcdef", player_name: "SyntheticPlayer", client_id: "00001111-aaaa-2222-bbbb-3333cccc4444" };

test("account save sends required nested metadata; get unwraps the Core envelope", async () => {
  const calls: unknown[] = [];
  const stored = { schema_version: 1, ...profile, xuid: null };
  const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return { stage: method === "account.microsoft.save" ? "save" : "account_get", account: stored } as T;
  });
  expect(await session.accountSave(profile)).toEqual({ stage: "save", account: stored });
  expect(await session.accountGet(profile.id)).toEqual(stored);
  expect(calls).toEqual([
    { method: "account.microsoft.save", params: { account: profile } },
    { method: "account.microsoft.get", params: { id: profile.id } },
  ]);
});

test("post-exchange metadata round trip uses the real envelope, including absent XUID", async () => {
  resetMockFixture("empty");
  const session = CoreSession.createForTesting(<T>(method: string, params: Record<string, unknown>) => mockRequest<T>(method, params));
  await expect(mockRequest("account.microsoft.save", profile)).rejects.toMatchObject({ code: "INVALID_PARAMS", message: "Account metadata parameters are invalid" });
  await session.accountSave(profile);
  expect((await session.accountList()).accounts).toEqual([{ schema_version: 1, ...profile, xuid: null }]);
  expect(await session.accountGet(profile.id)).toEqual({ schema_version: 1, ...profile, xuid: null });
  await session.accountSave({ ...profile, player_name: "RenamedFixture", xuid: "123456789" });
  expect((await session.accountGet(profile.id)).player_name).toBe("RenamedFixture");
  expect((await session.accountList()).accounts).toHaveLength(1);
  await session.accountDelete(profile.id);
  expect((await session.accountList()).accounts).toEqual([]);
  await expect(session.accountGet(profile.id)).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
});
