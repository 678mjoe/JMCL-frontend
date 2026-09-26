import { invoke } from "@tauri-apps/api/core";
import { open as tauriOpen, save as tauriSave, type OpenDialogOptions, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import {
  mockCredentialDelete,
  mockCredentialGet,
  mockCredentialSet,
  mockServerStatusCacheRead,
  mockServerStatusCacheWrite,
} from "./mockTransport";
import type { ServerStatusCacheV1 } from "./serverStatusCache";
import { isMockTransport } from "./transportMode";

export { isMockTransport };

export async function appDataDirectories(): Promise<{
  instancesDir: string;
  storeDir: string;
  serversDir: string;
}> {
  if (isMockTransport()) {
    return {
      instancesDir: "/mock/jmcl/instances",
      storeDir: "/mock/jmcl/store",
      serversDir: "/mock/jmcl/servers",
    };
  }
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const base = await appDataDir();
  const [instancesDir, storeDir, serversDir] = await Promise.all([
    join(base, "instances"),
    join(base, "store"),
    join(base, "servers"),
  ]);
  return { instancesDir, storeDir, serversDir };
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

export async function readServerStatusCache(): Promise<ServerStatusCacheV1> {
  if (isMockTransport()) return mockServerStatusCacheRead();
  return invoke<ServerStatusCacheV1>("server_status_cache_read");
}

export async function writeServerStatusCache(cache: ServerStatusCacheV1): Promise<void> {
  if (isMockTransport()) {
    mockServerStatusCacheWrite(cache);
    return;
  }
  await invoke("server_status_cache_write", { cache });
}

export const openDialog = (options?: OpenDialogOptions) =>
  isMockTransport() ? Promise.resolve<string | null>("/mock/jmcl/import/world.zip") : tauriOpen(options);
export const saveDialog = (options?: SaveDialogOptions) =>
  isMockTransport() ? Promise.resolve<string | null>(`/mock/jmcl/${options?.defaultPath ?? "world.zip"}`) : tauriSave(options);
export const openUrl = (url: string) => isMockTransport() ? Promise.resolve(url) : tauriOpenUrl(url);
