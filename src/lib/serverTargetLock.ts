import { useSyncExternalStore } from "react";
import type { ServerOperationScope } from "./servers";

// Physical operations survive view/controller and source revision changes.
const active = new Set<string>();
const listeners = new Set<() => void>();
const key = (scope: ServerOperationScope, id: string) => JSON.stringify([scope.endpointId, scope.kind, scope.directory, id]);
const notify = () => { for (const listener of listeners) listener(); };
export function acquireServerTarget(scope: ServerOperationScope, id: string): (() => void) | null {
  const target = key(scope, id);
  if (active.has(target)) return null;
  active.add(target); notify();
  let released = false;
  return () => { if (!released) { released = true; active.delete(target); notify(); } };
}
export function serverTargetBusy(scope: ServerOperationScope | null, id: string): boolean {
  return scope !== null && active.has(key(scope, id));
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useServerTargetBusy(scope: ServerOperationScope | null, id: string): boolean {
  return useSyncExternalStore(subscribe, () => serverTargetBusy(scope, id), () => false);
}
