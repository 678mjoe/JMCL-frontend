import { expect, test } from "bun:test";
import { ModpackTaskRegistry } from "./modpackTasks";
import type { ModpackSession } from "./modpackImport";
const input = { directory: "/packs", storeDirectory: "/store", id: "fixture", file: "/fixture.mrpack", provider: "modrinth" as const };
test("unknown task identity uses normalized root and cannot be replayed through slash aliases", async () => {
  const registry = new ModpackTaskRegistry(); let calls = 0;
  const session = { instanceList: async () => ({ instances: [] }), modpackInstall: async () => { calls++; throw { code: "TRANSPORT_EOF" }; }, close: async () => {} } as unknown as ModpackSession;
  const task = registry.start(input, async () => session);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(task.controller.getSnapshot().error).toBe("IMPORT_OUTCOME_UNKNOWN");
  expect(registry.start({ ...input, directory: "/packs/./" }, async () => session)).toBe(task);
  expect(registry.start({ ...input, directory: "\\packs\\" }, async () => session)).toBe(task);
  expect(calls).toBe(1);
});
test("safe editable failures can be retired but unknown outcomes remain discoverable", async () => {
  const registry = new ModpackTaskRegistry();
  const session = { instanceList: async () => ({ instances: [{ id: input.id }] }), close: async () => {} } as unknown as ModpackSession;
  const task = registry.start(input, async () => session);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(task.controller.getSnapshot().canEdit).toBe(true);
  registry.dismiss(task.key); expect(registry.list()).toHaveLength(0);
  const unknown = registry.start(input, async () => ({ ...session, instanceList: async () => ({ instances: [] }), modpackInstall: async () => { throw { code: "TRANSPORT_EOF" }; } }) as ModpackSession);
  await new Promise(resolve => setTimeout(resolve, 0));
  registry.dismiss(unknown.key); expect(registry.list()).toHaveLength(1);
});
