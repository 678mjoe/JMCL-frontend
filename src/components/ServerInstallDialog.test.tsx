import { describe, expect, test } from "bun:test";
import { canInstallServer } from "@/lib/serverOperations";
import { translate } from "@/lib/i18n";
import type { ServerManifest } from "@/lib/types";

const server: ServerManifest = { id: "fresh", name: "Fresh", version_id: "1.21.4", fabric_loader: null, neoforge_version: null, forge_version: null, source: "official", accept_eula: false, java_path: null, installed: false };

describe("ServerInstallDialog EULA gating", () => {
  test("first install remains disabled until consent, while accepted EULA needs no new decision", () => {
    expect(canInstallServer(server, false)).toBe(false);
    expect(canInstallServer(server, true)).toBe(true);
    expect(canInstallServer({ ...server, accept_eula: true }, false)).toBe(true);
  });
  test("renders translated EULA labels in Chinese and English dictionaries", () => {
    expect(translate("zh", "serverInstall.eulaConsent")).toContain("我已阅读并同意");
    expect(translate("en", "serverInstall.eulaConsent")).toContain("I have read and agree");
    expect(translate("en", "serverInstall.eulaLink")).toContain("End User License Agreement");
  });
});
