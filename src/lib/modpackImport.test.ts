import { describe, expect, test } from "bun:test";
import { ModpackImportController, validModpackInstanceId, suggestedModpackInstanceId, type ModpackSession } from "./modpackImport";
import { instanceCoordinator, instanceMutationKey } from "./instanceCoordinator";
import type { InstanceManifest } from "./types";
const input = { directory: "/fixture/instances", storeDirectory: "/fixture/store", id: "pack", file: "/fixture/pack.mrpack" };
const manifest: InstanceManifest = { id: "pack", name: "Pack", version_id: "1.21.4", source: "official", fabric_loader: "0.16.10", forge_version: null, neoforge_version: null, installed: false };
function setup(overrides: Partial<ModpackSession> = {}) {
  const calls: string[] = []; const args: unknown[][] = [];
  const session: ModpackSession = {
    close: async () => { calls.push("close"); },
    instanceList: async () => { calls.push("list"); return { instances: [] }; },
    instanceGet: async () => { calls.push("get"); return manifest; },
    modpackInstall: async (...values) => { calls.push("archive"); args.push(values); return { id: "pack", name: "Pack", version_id: "1.21.4", loader: { name: "fabric", version: "0.16.10" }, files_installed: 2, files_skipped: 0, overrides_written: 1 }; },
    installExecute: async (...values) => { calls.push("install"); args.push(values); expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(true); return {}; },
    installPrepare: async (...values) => { calls.push("prepare"); args.push(values); return { native_directory: "fixture" }; }, ...overrides,
  };
  return { controller: new ModpackImportController(input, async () => session), calls, args, session };
}
describe("modpack import staged ownership", () => {
  test("CurseForge archive session is replaced before game setup without releasing ownership", async () => {
    const fixture = setup(); let opens = 0; const order: string[] = [];
    const archive = { ...fixture.session, close: async () => { order.push("archive-close"); }, instanceGet: async () => { throw new Error("credentialed session reused"); }, modpackInstall: async (...args: Parameters<ModpackSession["modpackInstall"]>) => {
      expect(args[3]).toEqual({ store_directory: input.storeDirectory, provider: "curseforge" });
      return fixture.session.modpackInstall(...args);
    } };
    const controller = new ModpackImportController({ ...input, provider: "curseforge" }, async () => {
      expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(true);
      order.push("open"); return ++opens === 1 ? archive : fixture.session;
    });
    await controller.run(); expect(opens).toBe(2); expect(order).toEqual(["open", "archive-close", "open"]);
    expect(controller.getSnapshot().phase).toBe("success");
  });
  test("disposal while closing credentialed archive session prevents reopening", async () => {
    const fixture = setup(); let opens = 0; let finish!: () => void;
    const controller = new ModpackImportController({ ...input, provider: "curseforge" }, async () => { opens++; return { ...fixture.session, close: async () => { await new Promise<void>((resolve) => { finish = resolve; }); } }; });
    const pending = controller.run(); await new Promise((resolve) => setTimeout(resolve, 0)); controller.dispose(); finish(); await pending;
    expect(opens).toBe(1); expect(fixture.calls).not.toContain("get");
    expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(false);
  });

  test("validates core-compatible IDs including Windows names", () => {
    for (const id of ["", "Pack", "../pack", "con", "aux.zip", "lpt1", "pack.", "a".repeat(65)]) expect(validModpackInstanceId(id)).toBe(false);
    expect(validModpackInstanceId("my-pack_1.2")).toBe(true);
  });
  test("imports archive then gets manifest and installs/prepares exact version and loader under one lease", async () => {
    const { controller, calls, args } = setup(); await controller.run(); await controller.run();
    expect(calls).toEqual(["list", "archive", "get", "install", "prepare", "close"]);
    expect(args[0].slice(0, 4)).toEqual([input.directory, input.id, input.file, { store_directory: input.storeDirectory }]);
    expect(args[1][0]).toBe("1.21.4"); expect(args[1][1]).toEqual({ directory: "/fixture/instances/pack/.minecraft", store_directory: "/fixture/store", source: "official", fabric_loader: "0.16.10" });
    expect(args[1][3]).toEqual({ coordinate: false }); expect(controller.getSnapshot().phase).toBe("success");
    expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(false);
  });
  test("prepare retry does not repeat archive or execute", async () => {
    let attempts = 0;
    const { controller, calls } = setup({ installPrepare: async () => { attempts++; if (attempts === 1) throw { code: "PREPARE_FAILED" }; return { native_directory: "fixture" }; } });
    await controller.run(); expect(controller.getSnapshot().canResume).toBe(true); await controller.run();
    expect(calls.filter((c) => c === "archive")).toHaveLength(1); expect(calls.filter((c) => c === "install")).toHaveLength(1); expect(attempts).toBe(2);
  });
  test("ambiguous archive failure cannot be blindly resubmitted and private diagnostics are not retained", async () => {
    let attempts = 0; const { controller } = setup({ modpackInstall: async () => { attempts++; throw { code: "PRIVATE_SECRET", message: "private diagnostic" }; } });
    await controller.run(); await controller.run(); expect(attempts).toBe(1); expect(controller.getSnapshot().canResume).toBe(false); expect(controller.getSnapshot().error).toBe("IMPORT_OUTCOME_UNKNOWN");
  });
  test("existing instance blocks archive and wrong returned instance blocks game mutation", async () => {
    const conflict = setup({ instanceList: async () => ({ instances: [manifest] }) }); await conflict.controller.run(); expect(conflict.calls).toEqual(["close"]); expect(conflict.controller.getSnapshot().error).toBe("INSTANCE_EXISTS");
    const wrong = setup({ instanceGet: async () => ({ ...manifest, id: "other" }) }); await wrong.controller.run(); expect(wrong.calls).not.toContain("install"); expect(wrong.controller.getSnapshot().error).toBe("INVALID_INSTANCE_RESULT");
  });
  test("repeated click and disposal while session opens close late session without writes", async () => {
    let finish!: (s: ModpackSession) => void; let opens = 0; let closed = 0;
    const controller = new ModpackImportController(input, () => { opens++; return new Promise((resolve) => { finish = resolve; }); });
    const pending = controller.run(); await controller.run(); controller.dispose(); finish({ close: async () => { closed++; } } as ModpackSession); await pending;
    expect(opens).toBe(1); expect(closed).toBe(1); expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(false);
  });
  test("same-instance competing mutation never opens session", async () => {
    const release = instanceCoordinator.tryAcquire(instanceMutationKey(input.directory, input.id), "launch");
    try { const { controller, calls } = setup(); await controller.run(); expect(calls).toEqual([]); expect(controller.getSnapshot().error).toBe("INSTANCE_BUSY"); } finally { release(); }
  });
  test("disposal during archive retains lease until terminal and does not start game setup", async () => {
    let finish!: () => void;
    const { controller, calls } = setup({ modpackInstall: async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { id: "pack", name: "Pack", version_id: "1.21.4", loader: null, files_installed: 1, files_skipped: 0, overrides_written: 0 }; } });
    const pending = controller.run(); await new Promise((resolve) => setTimeout(resolve, 0)); controller.dispose();
    expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(true);
    finish(); await pending; expect(calls).toEqual(["list", "close"]);
    expect(instanceCoordinator.isBusy(instanceMutationKey(input.directory, input.id))).toBe(false);
  });
  test("game install failure resumes execute without archive replay", async () => {
    let attempts = 0; const { controller, calls } = setup({ installExecute: async () => { attempts++; if (attempts === 1) throw { code: "INSTALL_FAILED" }; return {}; } });
    await controller.run(); await controller.run(); expect(attempts).toBe(2); expect(calls.filter((call) => call === "archive")).toHaveLength(1); expect(calls.filter((call) => call === "prepare")).toHaveLength(1);
  });
  test("malformed progress never enters state", async () => {
    const { controller } = setup({ installExecute: async (_id, _opts, onEvent) => {
      onEvent?.({ kind: "event", data: { event: "progress", source: "official", progress: { files_completed: NaN, files_total: 2, bytes_processed: 1, bytes_total: 2 } } } as never);
      expect(controller.getSnapshot().progress).toBeNull(); return {};
    } }); await controller.run();
  });

  test("resume rejects a changed instance identity instead of installing a replacement", async () => {
    let reads = 0; let writes = 0;
    const { controller } = setup({ instanceGet: async () => ({ ...manifest, version_id: ++reads === 1 ? "1.21.4" : "1.20.1" }), installExecute: async () => { writes++; throw { code: "INSTALL_FAILED" }; } });
    await controller.run(); await controller.run(); expect(writes).toBe(1); expect(controller.getSnapshot().error).toBe("INVALID_INSTANCE_RESULT"); expect(controller.getSnapshot().canResume).toBe(false);
  });

});

test("safe ID suggestions do not turn names into paths or reserved Windows names", () => {
  expect(suggestedModpackInstanceId("My Pack 1.2")).toBe("my-pack-1.2");
  for (const name of ["CON", "...", "整合包", "../CON", "A".repeat(90)]) expect(validModpackInstanceId(suggestedModpackInstanceId(name))).toBe(true);
});
test("known setup failures stay specific while transport uncertainty cannot resume", async () => {
  for (const code of ["DOWNLOAD_FAILED", "JAVA_DOWNLOAD_FAILED", "PROCESSOR_FAILED", "CACHE_INVALID", "UNSAFE_ARCHIVE", "PREPARE_CONFLICT"]) {
    const { controller } = setup({ installExecute: async () => { throw { code, message: "PRIVATE" }; } });
    await controller.run(); expect(controller.getSnapshot().error).toBe(code); expect(controller.getSnapshot().canResume).toBe(true);
  }
  const { controller } = setup({ installExecute: async () => { throw { code: "TRANSPORT_EOF" }; } });
  await controller.run(); expect(controller.getSnapshot().error).toBe("IMPORT_OUTCOME_UNKNOWN"); expect(controller.getSnapshot().canResume).toBe(false);
});
test("retains real modpack summary and rejects malformed identities before game mutation", async () => {
  const good = setup(); await good.controller.run(); expect(good.controller.getSnapshot().summary?.files_installed).toBe(2);
  const bad = setup({ modpackInstall: async () => ({ id: "another", name: "Pack", version_id: "1.21.4", loader: null, files_installed: 0, files_skipped: 0, overrides_written: 0 }) });
  await bad.controller.run(); expect(bad.controller.getSnapshot().error).toBe("INVALID_INSTANCE_RESULT"); expect(bad.calls).not.toContain("install");
});

test("malformed progress events are ignored without changing import outcome", async () => {
  const { controller } = setup({ installExecute: async (_version, _options, emit) => {
    for (const progress of [undefined, null, [], {}, { files_completed: -1 }]) emit?.({ kind: "event", data: { event: "progress", progress } } as never);
    emit?.({ kind: "event", data: null } as never);
    return {};
  } });
  await controller.run();
  expect(controller.getSnapshot().phase).toBe("success");
  expect(controller.getSnapshot().progress).toBeNull();
});
