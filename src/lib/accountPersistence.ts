import type { AccountProfile, RefreshExchangeResult } from "./types";

export const PENDING_DEVICE_LOGIN = "pending-device-login";

type AccountWrites = {
  credentialSet: (id: string, refreshToken: string) => Promise<void>;
  credentialDelete: (id: string) => Promise<void>;
  accountSave: (profile: AccountProfile) => Promise<{ stage: "save"; account: AccountProfile }>;
};

/** Never delete the recovery slot until the Core positively acknowledges the metadata. */
export async function finishDeviceLogin(
  profile: AccountProfile,
  refreshToken: string,
  writes: AccountWrites,
): Promise<void> {
  await writes.credentialSet(profile.id, refreshToken);
  const receipt = await writes.accountSave(profile);
  if (receipt?.stage !== "save" || receipt.account?.id !== profile.id) {
    throw new Error("Account metadata was not acknowledged by the Core");
  }
  await writes.credentialDelete(PENDING_DEVICE_LOGIN);
}

/** Persist rotation whether the vendor's following exchange succeeds or fails. */
export async function persistRefreshResult(
  id: string,
  result: RefreshExchangeResult,
  credentialSet: AccountWrites["credentialSet"],
): Promise<RefreshExchangeResult> {
  await credentialSet(id, result.refresh_token);
  return result;
}
