// Typed frontend contracts against real Core. Invalid-input guards stop before any network, Java execution, or install.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { instanceLaunchOptions } from "../src/lib/instanceLaunch";
import type { InstanceManifest } from "../src/lib/types";
import { CoreSession } from "../src/lib/rpc";

const executable = resolve(process.argv[2] ?? `backend-binaries/jmcl-core${process.platform === "win32" ? ".exe" : ""}`);
const cwd = await mkdtemp(join(tmpdir(), "jmcl-capability-contract-"));
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
const deadline = setTimeout(() => { fail(new Error("synthetic capability RPC timed out")); child.kill(); }, 30_000);
const session = CoreSession.createForTesting(<T>(method: string, params: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
  const id = `capability-${++sequence}`;
  pending.set(id, { resolve: value => resolve(value as T), reject });
  child.stdin.write(JSON.stringify({ protocol: 1, id, method, params }) + "\n", error => { if (error) { pending.delete(id); reject(new Error("synthetic Core pipe failed")); } });
}));
const auth = {player_name: "Synthetic", uuid: "00000000000000000000000000000000", access_token: "synthetic-not-a-token"};
const instance = {source:"official"} as InstanceManifest;
const invalid = (message: string) => (error: any) => error.code === "INVALID_PARAMS" && error.message === message;
try {
  assert.equal((await session.request<{protocol:number}>("core.version")).protocol, 1);
  for (const policy of ["auto", "local", "managed"] as const) {
    const launch = instanceLaunchOptions(instance, join(cwd,"store"), {policy, paths:[join(cwd,"never-executed-java")]});
    // Deliberately conflicting override proves the valid policy passed parsing,
    // then stops at the exclusivity guard before metadata or executable probing.
    await assert.rejects(session.launchPlan("synthetic",cwd,join(cwd,"natives"),auth,{...launch,java_override:join(cwd,"never-executed-override")}),invalid("java_override is mutually exclusive with java_paths"));
    await assert.rejects(session.launchExecute("synthetic",cwd,auth,{...launch,java_override:join(cwd,"never-executed-override")}),invalid("java_override is mutually exclusive with java_paths"));
  }
  for (const workers of [0,33,-1,1.5]) await assert.rejects(session.installExecute("synthetic",{directory:cwd,store_directory:join(cwd,"store"),workers,retries:2}), (error:any)=>error.code==="INVALID_PARAMS");
  for (const retries of [-1,6,1.5]) await assert.rejects(session.installExecute("synthetic",{directory:cwd,store_directory:join(cwd,"store"),workers:8,retries}), (error:any)=>error.code==="INVALID_PARAMS");
  for (const [workers,retries] of [[1,0],[32,5],[8,2]]) {
    // Invalid policy is validated after bounds and before planning/download.
    await assert.rejects(session.installExecute("synthetic",{directory:cwd,store_directory:join(cwd,"store"),workers,retries,java_policy:"invalid" as never}),invalid("java_policy must be auto, local, or managed"));
  }
  assert.deepEqual((await session.javaRuntimeList(join(cwd,"store"))).runtimes,[]);
  assert.equal(stderrBytes,0);
  console.log("Typed Java policy/exclusivity and download-bound guards passed against real Core; no network, Java execution, or downloads.");
} finally {
  clearTimeout(deadline);
  child.kill();
  await exited;
  lines.close();
  await rm(cwd, { recursive: true, force: true });
}
