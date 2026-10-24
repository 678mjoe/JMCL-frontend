import { beforeEach, expect, test } from "bun:test";
import { mockRequest, resetMockFixture } from "./mockTransport";
import type { InstanceManifest, ModpackInstallResult } from "./types";
const directory = "/mock/jmcl/instances";
beforeEach(() => resetMockFixture("default"));

test("synthetic import creates isolated fixture instance and progress, then executes base installation", async () => {
  const events: unknown[] = [];
  const result = await mockRequest<ModpackInstallResult>("modpack.install", { directory, id: "new-pack", file: "/mock/fabric.mrpack" }, event => events.push(event));
  expect(result).toMatchObject({ id: "new-pack", version_id: "1.21.4", loader: { name: "fabric", version: "0.16.10" } });
  expect(events).toHaveLength(2);
  const manifest = () => mockRequest<InstanceManifest>("instance.get", { directory, id: "new-pack" });
  expect(await manifest()).toMatchObject({ installed: false, fabric_loader: "0.16.10" });
  expect((await mockRequest<{instances: InstanceManifest[]}>("instance.list", { directory })).instances.map(i => i.id)).toContain("new-pack");
  await expect(mockRequest("modpack.install", { directory, id: "new-pack", file: "/mock/pack.mrpack" })).rejects.toMatchObject({ code: "INSTANCE_EXISTS" });
  await mockRequest("install.execute", { directory: `${directory}/new-pack/.minecraft`, id: "1.21.4" });
  await mockRequest("install.prepare", { directory: `${directory}/new-pack/.minecraft`, id: "1.21.4" });
  expect((await manifest()).installed).toBe(true);
  await expect(mockRequest("instance.get", { directory: "/different/root", id: "new-pack" })).rejects.toMatchObject({ code: "INSTANCE_NOT_FOUND" });
});

test("unsupported/key-blocked archives leave fixture instance list unchanged", async () => {
  for (const [file, code] of [["/mock/curseforge.zip", "INVALID_PARAMS"], ["/mock/unknown.txt", "UNKNOWN_MODPACK_FORMAT"], ["/mock/unsafe.mrpack", "UNSAFE_MODPACK"], ["/mock/missing.mrpack", "MODPACK_NOT_FOUND"]]) {
    await expect(mockRequest("modpack.install", { directory, id: "blocked", file })).rejects.toMatchObject({ code });
    await expect(mockRequest("instance.get", { directory, id: "blocked" })).rejects.toMatchObject({ code: "INSTANCE_NOT_FOUND" });
  }
});
