/**
 * Shared local + managed Java runtime catalog (docs/java.md). Read-only;
 * mutations (runtime install/remove) live with their callers and trigger
 * `reload` afterwards.
 */

import { useCallback, useEffect, useState } from "react";
import { errorText, useLauncher } from "./launcher";
import { useSettings } from "./settings";
import type { JavaRuntime, ManagedJavaRuntime } from "./types";

interface Slice<T> {
  status: "loading" | "error" | "ready";
  items: T[];
  error: string | null;
}

function loadingSlice<T>(): Slice<T> {
  return { status: "loading", items: [], error: null };
}

export function useJavaCatalog() {
  const { session, status } = useLauncher();
  const { settings } = useSettings();
  const [local, setLocal] = useState<Slice<JavaRuntime>>(loadingSlice());
  const [managed, setManaged] = useState<Slice<ManagedJavaRuntime>>(loadingSlice());

  const reload = useCallback(async () => {
    if (!session || status !== "ready" || !settings.storeDir) return;
    setLocal(loadingSlice());
    setManaged(loadingSlice());
    const [localResult, managedResult] = await Promise.allSettled([
      session.javaDetect(),
      session.javaRuntimeList(settings.storeDir),
    ]);
    setLocal(
      localResult.status === "fulfilled"
        ? { status: "ready", items: localResult.value.runtimes ?? [], error: null }
        : { status: "error", items: [], error: errorText(localResult.reason) },
    );
    setManaged(
      managedResult.status === "fulfilled"
        ? {
            status: "ready",
            items: [...managedResult.value.runtimes].sort(
              (a, b) => a.major_version - b.major_version,
            ),
            error: null,
          }
        : { status: "error", items: [], error: errorText(managedResult.reason) },
    );
  }, [session, status, settings.storeDir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Majors already usable for launch: local exact-match or managed. */
  const satisfiedMajors = new Set<number>();
  for (const r of local.items) {
    if (r.major_version != null) satisfiedMajors.add(r.major_version);
  }
  for (const r of managed.items) satisfiedMajors.add(r.major_version);

  return { local, managed, reload, satisfiedMajors };
}
