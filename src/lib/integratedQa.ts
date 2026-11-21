import { GENERAL_GUI_TEST } from "./generalGuiTest";
import { invoke } from "@tauri-apps/api/core";

export type QaIntent = "offline" | "microsoft_enabled";
export const INTEGRATED_QA = import.meta.env?.VITE_JMCL_INTEGRATED_GUI_TEST === "1";
let boot: Promise<void> | undefined;
let intent: QaIntent | undefined;

export function parseQaIntent(value: unknown): QaIntent {
  if (value === "offline" || value === "microsoft_enabled") return value;
  throw new Error("Invalid integrated QA intent");
}

export function initializeIntegratedQa(): Promise<void> {
  if (!INTEGRATED_QA) return Promise.resolve();
  return boot ??= invoke<unknown>("qa_intent").then(value => { intent = parseQaIntent(value); });
}

export function currentQaIntent(): QaIntent | null {
  if (!INTEGRATED_QA) return null;
  if (!intent) throw new Error("The native QA intent is unavailable");
  return intent;
}

export function qaSettingsKey(mode: QaIntent | null): string | null {
  if (mode === "offline") return "jmcl.integrated-qa.offline.settings.v1";
  if (mode === "microsoft_enabled") return "jmcl.integrated-qa.microsoft.settings.v1";
  return null;
}

export function usesMicrosoftAccounts(mode: QaIntent | null): boolean {
  return mode !== "offline";
}

export function qaLaunchAccess(mode: QaIntent | null, activeAccountId: string | null):
  "ordinary" | "fixture-offline" | "authenticated-play" {
  if (mode === null) return "ordinary";
  return mode === "microsoft_enabled" && activeAccountId
    ? "authenticated-play"
    : "fixture-offline";
}

export function openIntegratedQaMicrosoftLink(): Promise<void> {
  if (!GENERAL_GUI_TEST && currentQaIntent() !== "microsoft_enabled") {
    return Promise.reject(new Error("Microsoft verification is unavailable"));
  }
  return invoke<void>("qa_open_microsoft_link");
}
