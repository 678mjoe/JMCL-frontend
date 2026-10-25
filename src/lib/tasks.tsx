/**
 * Long-running task manager: game installs and launches.
 *
 * Each task runs on its own dedicated RPC session (protocol v1 is
 * synchronous per session; contract §1). Progress events and game output
 * stream into React state for the UI.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLauncher, errorText } from "./launcher";
import type { AuthSession, InstanceManifest, LoaderFields, LaunchOptions } from "./types";
import {
  appendLaunchOutput,
  runLaunchRequest,
  runtimeInstallEvent,
} from "./launchRunner";
import { instanceLaunchOptions } from "./instanceLaunch";
import { withOpenedSession } from "./sessionLifecycle";
import { instanceMutationKey } from "./instanceCoordinator";
import { initialInstallProgress, reduceInstallProgress, type InstallProgressState } from "./installProgress";

export type TaskKind = "install" | "launch" | "validate";
export type TaskStatus = "running" | "success" | "error";

export interface TaskProgress {
  filesCompleted: number;
  filesTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
}

export interface LogLine {
  stream: "stdout" | "stderr" | "core";
  text: string;
}

export interface Task {
  key: string;
  kind: TaskKind;
  instanceId: string;
  instancesDir?: string;
  status: TaskStatus;
  /** i18n key for the current stage. */
  stage:
    | "task.stage.validate"
    | "task.stage.download"
    | "task.stage.processor"
    | "task.stage.prepare"
    | "task.stage.java"
    | "task.stage.launch";
  progress: TaskProgress | null;
  installProgress?: InstallProgressState;
  pid: number | null;
  lines: LogLine[];
  /** Terminal summary or error text. */
  message: string | null;
}

const MAX_LOG_LINES = 5000;

interface StartDirs {
  instancesDir: string;
  storeDir: string;
}

interface TasksContextValue {
  tasks: Record<string, Task>;
  taskFor: (kind: TaskKind, instanceId: string, instancesDir?: string) => Task | undefined;
  /** Resolves the version+loader online on a dedicated session; returns success. */
  startValidate: (instance: InstanceManifest) => Promise<boolean>;
  startInstall: (instance: InstanceManifest, dirs: StartDirs) => Promise<void>;
  startLaunch: (
    instance: InstanceManifest,
    dirs: StartDirs,
    auth: AuthSession,
    javaOverride?: string | null,
    options?: LaunchOptions,
  ) => Promise<void>;
  clearTask: (kind: TaskKind, instanceId: string, instancesDir?: string) => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

function taskKey(kind: TaskKind, instanceId: string, instancesDir?: string): string {
  // Install jobs are owned by a concrete instance path, not an ID that can be
  // reused after switching roots. Unscoped lookups deliberately cannot match
  // scoped installations. Launch/validation retain their existing semantics.
  return kind === "install" && instancesDir !== undefined
    ? `install:${instanceMutationKey(instancesDir, instanceId)}`
    : `${kind}:${instanceId}`;
}

export function loaderFieldsOf(m: InstanceManifest): LoaderFields {
  if (m.fabric_loader) return { fabric_loader: m.fabric_loader };
  if (m.neoforge_version) return { neoforge_version: m.neoforge_version };
  if (m.forge_version) return { forge_version: m.forge_version };
  return {};
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const { openSession } = useLauncher();
  const installsInFlight = useRef(new Set<string>());
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const patch = useCallback((key: string, p: Partial<Task>) => {
    setTasks((prev) =>
      prev[key] ? { ...prev, [key]: { ...prev[key], ...p } } : prev,
    );
  }, []);

  const appendLine = useCallback((key: string, line: LogLine) => {
    setTasks((prev) => {
      const task = prev[key];
      if (!task) return prev;
      const lines =
        task.lines.length >= MAX_LOG_LINES
          ? [...task.lines.slice(task.lines.length - MAX_LOG_LINES + 1), line]
          : [...task.lines, line];
      return { ...prev, [key]: { ...task, lines } };
    });
  }, []);

  const beginTask = useCallback(
    (kind: TaskKind, instanceId: string, stage: Task["stage"], instancesDir?: string): string => {
      const key = taskKey(kind, instanceId, instancesDir);
      setTasks((prev) => ({
        ...prev,
        [key]: {
          key,
          kind,
          instanceId,
          ...(instancesDir !== undefined ? { instancesDir } : {}),
          status: "running",
          stage,
          progress: null,
          pid: null,
          lines: [],
          message: null,
        },
      }));
      return key;
    },
    [],
  );

  const startValidate = useCallback(
    async (instance: InstanceManifest): Promise<boolean> => {
      const key = beginTask("validate", instance.id, "task.stage.validate");
      try {
        await withOpenedSession(openSession, (session) =>
          session.versionResolve(instance.version_id, {
            source: instance.source,
            ...loaderFieldsOf(instance),
          }),
        );
        patch(key, { status: "success", message: null });
        return true;
      } catch (e) {
        patch(key, { status: "error", message: errorText(e) });
        return false;
      }
    },
    [beginTask, openSession, patch],
  );

  const startInstall = useCallback(
    async (instance: InstanceManifest, dirs: StartDirs) => {
      const flightKey = instanceMutationKey(dirs.instancesDir, instance.id);
      if (installsInFlight.current.has(flightKey)) return;
      installsInFlight.current.add(flightKey);
      const key = beginTask("install", instance.id, "task.stage.download", dirs.instancesDir);
      const directory = `${dirs.instancesDir}/${instance.id}/.minecraft`;
      const loaders = loaderFieldsOf(instance);
      let installProgress = initialInstallProgress();
      patch(key, { installProgress, instancesDir: dirs.instancesDir });
      try {
        await withOpenedSession(openSession, async (activeSession) => {
            await activeSession.installExecute(
              instance.version_id,
              {
                directory,
                store_directory: dirs.storeDir,
                source: instance.source,
                ...loaders,
              },
              (event) => {
                const next = reduceInstallProgress(installProgress, event);
                if (next === installProgress) return;
                installProgress = next;
                patch(key, {
                  stage: next.stage === "java" ? "task.stage.java" : next.stage === "processor" ? "task.stage.processor" : "task.stage.download",
                  progress: next.progress,
                  installProgress: next,
                });
              },
            );
            patch(key, { stage: "task.stage.prepare", progress: null, installProgress: undefined });
            await activeSession.installPrepare(
              instance.version_id,
              {
                directory,
                source: instance.source,
                ...loaders,
              },
            );
        });
        patch(key, { status: "success", message: null });
      } catch (e) {
        patch(key, { status: "error", message: errorText(e) });
      } finally {
        installsInFlight.current.delete(flightKey);
      }
    },
    [beginTask, openSession, patch],
  );

  const startLaunch = useCallback(
    async (
      instance: InstanceManifest,
      dirs: StartDirs,
      auth: AuthSession,
      javaOverride?: string | null,
      options: LaunchOptions = {},
    ) => {
      const key = beginTask("launch", instance.id, "task.stage.launch");
      try {
        const result = await withOpenedSession(openSession, async (activeSession) => {
          return runLaunchRequest(
                (onEvent) =>
                  activeSession.launchExecute(
                    instance.version_id,
                    `${dirs.instancesDir}/${instance.id}/.minecraft`,
                    auth,
                    instanceLaunchOptions(instance, dirs.storeDir, javaOverride, options),
                    onEvent,
                  ),
                (event, buffer) => {
                  if (event.kind === "diagnostic") {
                    appendLine(key, { stream: "core", text: event.data });
                    return;
                  }

                  const e = event.data;
                  if (e.event === "started") {
                    const started = e.started as
                      | Record<string, unknown>
                      | undefined;
                    patch(key, {
                      pid: (started?.pid as number) ?? null,
                      progress: null,
                    });
                    return;
                  }
                  const runtime = runtimeInstallEvent(event);
                  if (runtime?.event === "stage") {
                    patch(key, { stage: "task.stage.java" });
                    return;
                  }
                  if (runtime?.event === "progress") {
                    const progress = runtime.data.progress as {
                      files_completed?: number;
                      files_total?: number;
                      bytes_processed?: number;
                      bytes_total?: number;
                    };
                    patch(key, {
                      stage: "task.stage.java",
                      progress: {
                        filesCompleted: progress.files_completed ?? 0,
                        filesTotal: progress.files_total ?? 0,
                        bytesProcessed: progress.bytes_processed ?? 0,
                        bytesTotal: progress.bytes_total ?? 0,
                      },
                    });
                    return;
                  }
                  appendLaunchOutput(event, buffer, (line) =>
                    appendLine(key, line),
                  );
                },
                (line) => appendLine(key, line),
              );
        });
        const process = result.process as
          | {
              termination?: string;
              exit_code?: number | null;
              signal?: number | null;
            }
          | undefined;
        const code = process?.exit_code;
        patch(key, {
          status: "success",
          message:
            process?.termination === "exited"
              ? `exited:${code ?? "?"}`
              : `terminated:${process?.termination ?? "unknown"}`,
        });
      } catch (e) {
        patch(key, { status: "error", message: errorText(e) });
      }
    },
    [appendLine, beginTask, openSession, patch],
  );

  const clearTask = useCallback((kind: TaskKind, instanceId: string, instancesDir?: string) => {
    const key = taskKey(kind, instanceId, instancesDir);
    setTasks((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const value = useMemo<TasksContextValue>(
    () => ({
      tasks,
      taskFor: (kind, instanceId, instancesDir) => tasks[taskKey(kind, instanceId, instancesDir)],
      startValidate,
      startInstall,
      startLaunch,
      clearTask,
    }),
    [tasks, startValidate, startInstall, startLaunch, clearTask],
  );

  return (
    <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
  );
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks outside TasksProvider");
  return ctx;
}

/** Exported for LogSheet/tests: parse the terminal message set by startLaunch. */
export function taskKeyOf(kind: TaskKind, instanceId: string, instancesDir?: string): string {
  return taskKey(kind, instanceId, instancesDir);
}
