/**
 * Launcher core lifecycle: one shared session for light operations
 * (lists, creates), plus a factory for dedicated sessions (install/launch
 * tasks, contract §1: one request at a time per session).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CoreSession, RpcError } from "./rpc";
import type { CoreIdentity } from "./types";

export type CoreStatus = "starting" | "ready" | "error";

interface LauncherContextValue {
  status: CoreStatus;
  core: CoreIdentity | null;
  error: string | null;
  /** Shared session for lightweight, non-overlapping calls. */
  session: CoreSession | null;
  /** Open a dedicated session for a long-running task; caller closes it. */
  openSession: () => Promise<CoreSession>;
}

const LauncherContext = createContext<LauncherContextValue | null>(null);

// Module-level singleton: survives StrictMode double-mount and remounts.
let sharedSessionPromise: Promise<CoreSession> | null = null;

function openSharedSession(): Promise<CoreSession> {
  sharedSessionPromise ??= CoreSession.open().catch((e) => {
    sharedSessionPromise = null; // allow retry on next mount
    throw e;
  });
  return sharedSessionPromise;
}

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: CoreStatus;
    session: CoreSession | null;
    error: string | null;
  }>({ status: "starting", session: null, error: null });

  useEffect(() => {
    let cancelled = false;
    openSharedSession()
      .then((session) => {
        if (!cancelled) setState({ status: "ready", session, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            status: "error",
            session: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<LauncherContextValue>(
    () => ({
      status: state.status,
      core: state.session?.core ?? null,
      error: state.error,
      session: state.session,
      openSession: () => CoreSession.open(),
    }),
    [state],
  );

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>;
}

export function useLauncher(): LauncherContextValue {
  const ctx = useContext(LauncherContext);
  if (!ctx) throw new Error("useLauncher outside LauncherProvider");
  return ctx;
}

/** Human-readable text for a thrown RPC/transport error. */
export function errorText(e: unknown): string {
  if (e instanceof RpcError) return e.code ? `${e.code}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}
