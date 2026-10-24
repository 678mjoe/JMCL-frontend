import { invoke, isTauri } from "@tauri-apps/api/core";
import { isMockTransport } from "./transportMode";

export type UpdatePhase = "unconfigured" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "installing" | "installed" | "error";
export type UpdateAction = "check" | "download" | "install" | "discard" | "restart";
export interface UpdateSnapshot {
  phase: UpdatePhase;
  channel: string | null;
  version: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
}
export const unconfiguredUpdate: UpdateSnapshot = Object.freeze({ phase: "unconfigured", channel: null, version: null, downloaded: 0, total: null, error: null });
export const updateBusy = (phase: UpdatePhase) => ["checking", "downloading", "installing"].includes(phase);
export function canUpdate(phase: UpdatePhase, action: UpdateAction): boolean {
  switch (action) {
    case "check": return ["idle", "current", "error"].includes(phase);
    case "download": return phase === "available";
    case "install": return phase === "downloaded";
    case "discard": return ["available", "downloaded", "error"].includes(phase);
    case "restart": return phase === "installed";
  }
}
export interface UpdateTransport {
  status(): Promise<UpdateSnapshot>;
  action(action: UpdateAction): Promise<UpdateSnapshot>;
}
const nativeTransport: UpdateTransport = {
  status: () => isMockTransport() || !isTauri() ? Promise.resolve(unconfiguredUpdate) : invoke("updater_status"),
  action: (action) => isMockTransport() || !isTauri() ? Promise.reject(new Error("unconfigured")) : invoke("updater_action", { action }),
};

/** Native owns resources and operation state; remounting cannot start a new job.
 * There is no runtime endpoint, public-key, channel or arbitrary-byte input. */
export function createUpdateController(transport: UpdateTransport = nativeTransport) {
  let state = { snapshot: unconfiguredUpdate, pending: false, bridgeError: false };
  let generation = 0;
  let readSequence = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async refresh() {
      const token = generation;
      const read = ++readSequence;
      try {
        const snapshot = await transport.status();
        if (token === generation && read === readSequence) publish({ snapshot, bridgeError: false });
      } catch { if (token === generation && read === readSequence) publish({ bridgeError: true }); }
    },
    async act(action: UpdateAction) {
      if (state.pending || state.bridgeError || !canUpdate(state.snapshot.phase, action)) return;
      generation++;
      publish({ pending: true, bridgeError: false });
      try { publish({ snapshot: await transport.action(action) }); }
      catch { publish({ bridgeError: true }); }
      finally { generation++; publish({ pending: false }); }
    },
  };
}
export const updateController = createUpdateController();
export type UpdateController = ReturnType<typeof createUpdateController>;
