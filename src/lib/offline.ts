import { md5Hex } from "./md5";
import type { AuthSession } from "./types";

/**
 * Build a client-side offline-mode session (contract §4):
 * uuid = hex MD5 of `"OfflinePlayer:" + name` (no dashes),
 * access_token = "offline". The core treats it like any other session.
 */
export function makeOfflineSession(playerName: string): AuthSession {
  return {
    player_name: playerName,
    uuid: md5Hex(`OfflinePlayer:${playerName}`),
    access_token: "offline",
    user_type: "legacy",
  };
}
