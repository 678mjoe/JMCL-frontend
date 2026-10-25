/**
 * Shared local + managed Java runtime catalog (docs/java.md). Read-only;
 * mutations (runtime install/remove) live with their callers and trigger
 * `reload` afterwards.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, useLauncher } from "./launcher";
import { runtimeTarget, type RuntimeTarget } from "./native";
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
  const [target, setTarget] = useState<RuntimeTarget | null>(null);
  const [local, setLocal] = useState<Slice<JavaRuntime>>(loadingSlice());
  const [managed, setManaged] = useState<Slice<ManagedJavaRuntime>>(loadingSlice());

  const generation = useRef(0);
  const mounted = useRef(false);
  const scope = useRef({ session, status, store: settings.storeDir });
  scope.current = { session, status, store: settings.storeDir };

  const reload = useCallback(async () => {
    const current = scope.current;
    if (!mounted.current || current.session !== session || current.status !== status || current.store !== settings.storeDir) return;
    const request = ++generation.current;
    if (!session || status !== "ready" || !settings.storeDir) {
      setLocal(loadingSlice());
      setManaged(loadingSlice());
      setTarget(null);
      return;
    }
    setLocal(loadingSlice());
    setManaged(loadingSlice());
    const [localResult, managedResult, targetResult] = await Promise.allSettled([
      session.javaDetect(),
      session.javaRuntimeList(settings.storeDir),
      runtimeTarget(),
    ]);
    if (request !== generation.current || scope.current.session !== session || scope.current.status !== status || scope.current.store !== settings.storeDir) return;
    setTarget(targetResult.status === "fulfilled" ? targetResult.value : null);
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
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current++; };
  }, [reload]);

  // Receipts are availability hints, not proof that an executable can launch.
  const satisfiedMajors = compatibleJavaMajors(local.items, managed.items, target);
  return { local, managed, reload, satisfiedMajors, target };
}

/** Mirror Core exact-major/arch matching and managed platform filtering. Unknown is not usable. */
export function compatibleJavaMajors(local: JavaRuntime[], managed: ManagedJavaRuntime[], target: RuntimeTarget | null): Set<number> {
  const result = new Set<number>();
  if (!target) return result;
  for (const runtime of local) {
    if (runtime.major_version && runtime.architecture === target.arch) result.add(runtime.major_version);
  }
  const platforms: Record<string, [string, string]> = {
    "windows-x64": ["windows", "x86_64"], "windows-x86": ["windows", "x86"], "windows-arm64": ["windows", "arm64"],
    "mac-os": ["osx", "x86_64"], "mac-os-arm64": ["osx", "arm64"],
    linux: ["linux", "x86_64"], "linux-i386": ["linux", "x86"], "linux-arm64": ["linux", "arm64"],
  };
  for (const runtime of managed) {
    const platform = platforms[runtime.platform];
    if (platform?.[0] === target.os && platform[1] === target.arch) result.add(runtime.major_version);
  }
  return result;
}
