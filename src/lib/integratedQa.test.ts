import { expect, test } from "bun:test";
import { parseQaIntent, qaLaunchAccess, qaSettingsKey, usesMicrosoftAccounts } from "./integratedQa";

test("only the exact native integrated intents are recognized", () => {
  expect(parseQaIntent("offline")).toBe("offline");
  expect(parseQaIntent("microsoft_enabled")).toBe("microsoft_enabled");
  for (const ambiguous of [undefined, null, "", true, "microsoft", { intent: "offline" }]) {
    expect(() => parseQaIntent(ambiguous)).toThrow();
  }
});

test("offline never selects the Microsoft account policy or settings key", () => {
  expect(usesMicrosoftAccounts("offline")).toBe(false);
  expect(usesMicrosoftAccounts("microsoft_enabled")).toBe(true);
  expect(usesMicrosoftAccounts(null)).toBe(true);
  expect(qaSettingsKey("offline")).not.toBe(qaSettingsKey("microsoft_enabled"));
  expect(qaSettingsKey(null)).toBeNull();
  expect(qaLaunchAccess("offline", "stale-fixture")).toBe("fixture-offline");
  expect(qaLaunchAccess("microsoft_enabled", null)).toBe("fixture-offline");
  expect(qaLaunchAccess("microsoft_enabled", "fixture-account")).toBe("authenticated-play");
  expect(qaLaunchAccess(null, "fixture-account")).toBe("ordinary");
});
