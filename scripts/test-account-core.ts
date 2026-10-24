// Real Core RPC with synthetic public account metadata only. No OAuth/keychain.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { CoreSession } from "../src/lib/rpc";

const executable = resolve(process.argv[2] ?? `backend-binaries/jmcl-core${process.platform === "win32" ? ".exe" : ""}`);
const cwd = await mkdtemp(join(tmpdir(), "jmcl-account-contract-"));
const child = spawn(executable, ["rpc"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
let sequence = 0;
let stderrBytes = 0;
child.stderr.on("data", data => { stderrBytes += data.length; });
const fail = (error: Error) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
child.on("error", () => fail(new Error("synthetic Core could not start")));
const exited = new Promise<void>(resolve => child.on("close", () => { fail(new Error("synthetic Core closed before result")); resolve(); }));
const lines = createInterface({ input: child.stdout });
lines.on("line", line => {
  try {
    const reply = JSON.parse(line);
    const request = pending.get(reply.id);
    if (!request) return;
    if (reply.event === "result") { pending.delete(reply.id); request.resolve(reply.result); }
    if (reply.event === "error") { pending.delete(reply.id); request.reject(reply.error); }
  } catch { fail(new Error("synthetic Core returned malformed JSON")); }
});
const deadline = setTimeout(() => { fail(new Error("synthetic account RPC timed out")); child.kill(); }, 30_000);
const session = CoreSession.createForTesting(<T>(method: string, params: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
  const id = `account-${++sequence}`;
  pending.set(id, { resolve: value => resolve(value as T), reject });
  child.stdin.write(JSON.stringify({ protocol: 1, id, method, params }) + "\n", error => { if (error) { pending.delete(id); reject(new Error("synthetic Core pipe failed")); } });
}));
const account = { id: "0123456789abcdef0123456789abcdef", player_name: "SyntheticPlayer", client_id: "00001111-aaaa-2222-bbbb-3333cccc4444" };
try {
  assert.equal((await session.request<{ protocol: number }>("core.version")).protocol, 1);
  await assert.rejects(session.request("account.microsoft.save", account), (error: any) => error.code === "INVALID_PARAMS" && error.message === "Account metadata parameters are invalid");
  const expected = { schema_version: 1, ...account, xuid: null };
  assert.deepEqual(await session.accountSave(account), { stage: "save", account: expected });
  assert.deepEqual(await session.accountGet(account.id), expected);
  assert.deepEqual((await session.accountList()).accounts, [expected]);
  await session.accountSave({ ...account, player_name: "UpdatedFixture", xuid: "123456789" });
  assert.deepEqual(await session.accountGet(account.id), { ...expected, player_name: "UpdatedFixture", xuid: "123456789" });
  assert.equal((await session.accountList()).accounts.length, 1);
  await session.accountDelete(account.id);
  assert.deepEqual((await session.accountList()).accounts, []);
  await assert.rejects(session.accountGet(account.id), (error: any) => error.code === "ACCOUNT_NOT_FOUND");
  assert.equal(stderrBytes, 0);
  console.log("Typed account save/get/list/update/delete passed against real Core; synthetic metadata only.");
} finally {
  clearTimeout(deadline);
  child.kill();
  await exited;
  lines.close();
  await rm(cwd, { recursive: true, force: true });
}
