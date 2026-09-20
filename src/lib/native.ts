import { invoke } from "@tauri-apps/api/core";
import { open as tauriOpen, save as tauriSave, type OpenDialogOptions, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { mockCredentialDelete, mockCredentialGet, mockCredentialSet } from "./mockTransport";
import { isMockTransport } from "./transportMode";

export { isMockTransport };

export async function appDataDirectories(): Promise<{ instancesDir: string; storeDir: string }> {
  if (isMockTransport()) return { instancesDir: "/mock/jmcl/instances", storeDir: "/mock/jmcl/store" };
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const base = await appDataDir();
  const [instancesDir, storeDir] = await Promise.all([join(base, "instances"), join(base, "store")]);
  return { instancesDir, storeDir };
}

export const credentialSet = async (accountId: string, refreshToken: string): Promise<void> => {
  if (isMockTransport()) { mockCredentialSet(accountId, refreshToken); return; }
  await invoke("credential_set", { accountId, refreshToken });
};
export const credentialGet = async (accountId: string): Promise<string | null> => {
  if (isMockTransport()) return mockCredentialGet(accountId);
  return invoke<string | null>("credential_get", { accountId });
};
export const credentialDelete = async (accountId: string): Promise<void> => {
  if (isMockTransport()) { mockCredentialDelete(accountId); return; }
  await invoke("credential_delete", { accountId });
};

export const openDialog = (options?: OpenDialogOptions) =>
  isMockTransport() ? Promise.resolve<string | null>("/mock/jmcl/import/world.zip") : tauriOpen(options);
export const saveDialog = (options?: SaveDialogOptions) =>
  isMockTransport() ? Promise.resolve<string | null>(`/mock/jmcl/${options?.defaultPath ?? "world.zip"}`) : tauriSave(options);
export const openUrl = (url: string) => isMockTransport() ? Promise.resolve(url) : tauriOpenUrl(url);
