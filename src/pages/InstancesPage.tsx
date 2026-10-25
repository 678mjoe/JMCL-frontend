import { javaPreferencesFor } from "@/lib/javaPreferences";
import { downloadOptions } from "@/lib/downloadOptions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useModpackTasks } from "@/lib/modpackTasks";
import { CreateInstanceDialog } from "@/components/CreateInstanceDialog";
import { DeleteInstanceDialog } from "@/components/DeleteInstanceDialog";
import { InstanceCard } from "@/components/InstanceCard";
import { LogSheet } from "@/components/LogSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import { AuthTransientError, ReloginRequiredError, useLaunchAuth } from "@/lib/auth";
import { launchOptionsFor } from "@/lib/launchOptions";
import { useSettings } from "@/lib/settings";
import { useTasks, type TaskStatus } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

export interface InstancesPageProps {
  onOpenDetail: (instanceId: string) => void;
  onOpenContent: (instanceId: string) => void;
}

export function InstancesPage({ onOpenDetail, onOpenContent }: InstancesPageProps) {
  const { status, session, error: coreError } = useLauncher();
  const { settings, t } = useSettings();
  const { tasks, taskFor, startValidate, startInstall, startLaunch, clearTask } = useTasks();
  const resolveLaunchAuth = useLaunchAuth();

  const rootRef = useRef(settings.instancesDir);
  const scopeGeneration = useRef(0);
  if (rootRef.current !== settings.instancesDir) scopeGeneration.current++;
  rootRef.current = settings.instancesDir;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scopeGeneration.current++; }; }, []);
  const refreshRevision = useRef(0);
  const [loaded, setLoaded] = useState<{ root: string; instances: InstanceManifest[] }>({ root: "", instances: [] });
  const instances = loaded.root === settings.instancesDir ? loaded.instances : [];
  const setInstances = (update: (current: InstanceManifest[]) => InstanceManifest[]) => {
    if (!mounted.current || rootRef.current !== settings.instancesDir) return;
    setLoaded(current => ({ root: settings.instancesDir, instances: update(current.root === settings.instancesDir ? current.instances : []) }));
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const modpacks = useModpackTasks();
  const [logInstanceId, setLogInstanceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstanceManifest | null>(null);
  const [deleting, setDeleting] = useState(false);

  const coreReady = status === "ready";
  const dirs = { instancesDir: settings.instancesDir, storeDir: settings.storeDir, ...downloadOptions(settings) };
  const beginInstall = (instance: InstanceManifest) => {
    void startInstall(instance, dirs, javaPreferencesFor(settings.javaPreferences, dirs.instancesDir, instance.id));
  };

  // Validate the version+loader online first, then auto-install. Validation
  // failures keep the instance and offer retry/delete instead of hiding the
  // error inside a download task.
  const validateThenInstall = (instance: InstanceManifest) => {
    void startValidate(instance).then((ok) => {
      if (ok) beginInstall(instance);
    });
  };

  const refresh = useCallback(async () => {
    if (status !== "ready" || !session || !settings.instancesDir) return;
    const generation = scopeGeneration.current;
    const revision = ++refreshRevision.current;
    const current = () => mounted.current && generation === scopeGeneration.current && revision === refreshRevision.current;
    try {
      const result = await session.instanceList(settings.instancesDir);
      if (current()) setLoaded({ root: settings.instancesDir, instances: result.instances });
    } catch (e) {
      if (current()) toast.error(errorText(e));
    }
  }, [status, session, settings.instancesDir]);

  // Load on mount and whenever the core becomes ready / the dir changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const terminalPacks = JSON.stringify(modpacks.registry.list().filter(task => task.controller.input.directory === settings.instancesDir && !task.controller.getSnapshot().busy).map(task => [task.key, task.controller.getSnapshot().phase, task.controller.getSnapshot().error]));
  useEffect(() => {
    // Terminal jobs can finish while this page is absent. Refresh once on return
    // and when a job settles, without tying the task to this page lifecycle.
    if (terminalPacks !== "[]") void refresh();
  }, [terminalPacks, settings.instancesDir, refresh]);

  // Refresh whenever an install attempt transitions to success. Tracking the
  // previous status (rather than task keys forever) also handles reinstalling
  // or recreating the same instance id within one app session.
  const previousInstallStatus = useRef<Record<string, TaskStatus>>({});
  useEffect(() => {
    const nextStatus: Record<string, TaskStatus> = {};
    let completed = false;
    for (const task of Object.values(tasks)) {
      if (task.kind !== "install") continue;
      if (
        task.status === "success" &&
        previousInstallStatus.current[task.key] !== "success"
      ) {
        completed = true;
      }
      nextStatus[task.key] = task.status;
    }
    previousInstallStatus.current = nextStatus;
    if (completed) void refresh();
  }, [tasks, refresh]);

  const handleCreated = (instance: InstanceManifest) => {
    if (!mounted.current || rootRef.current !== settings.instancesDir) return;
    setDialogOpen(false);
    setInstances((current) => {
      const index = current.findIndex((item) => item.id === instance.id);
      if (index >= 0) {
        const next = current.slice();
        next[index] = instance;
        return next;
      }
      const next = [...current, instance];
      next.sort((left, right) => left.id.localeCompare(right.id));
      return next;
    });
    validateThenInstall(instance);
    void refresh();
  };

  const handleLaunch = (instance: InstanceManifest) => {
    if (loaded.root !== settings.instancesDir || !instances.includes(instance)) return;
    const generation = scopeGeneration.current;
    void (async () => {
      try {
        const auth = await resolveLaunchAuth();
        if (!mounted.current || generation !== scopeGeneration.current || rootRef.current !== dirs.instancesDir) return;
        void startLaunch(instance, dirs, auth, javaPreferencesFor(settings.javaPreferences, settings.instancesDir, instance.id), launchOptionsFor(settings.launchOptions, dirs.instancesDir, instance.id));
        setLogInstanceId(instance.id);
      } catch (e) {
        toast.error(
          e instanceof ReloginRequiredError
            ? t("account.reloginRequired")
            : e instanceof AuthTransientError
              ? t("account.networkRetry")
              : errorText(e),
        );
      }
    })();
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || !session || loaded.root !== settings.instancesDir || !instances.includes(target)) return;
    setDeleting(true);
    try {
      await session.instanceDelete(settings.instancesDir, target.id);
      clearTask("validate", target.id);
      clearTask("install", target.id, settings.instancesDir);
      clearTask("launch", target.id);
      if (logInstanceId === target.id) setLogInstanceId(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("instances.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title={t("instances.refresh")}
            onClick={() => void refresh()}
            disabled={!coreReady}
          >
            <RefreshCw />
          </Button>
          <Button variant="outline" onClick={() => modpacks.show()} disabled={!coreReady}>{settings.language === "zh" ? "导入整合包" : "Import modpack"}</Button>
          <Button onClick={() => setDialogOpen(true)} disabled={!coreReady}>
            <Plus />
            {t("instances.new")}
          </Button>
        </div>
      </div>

      {status === "error" ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <Gamepad2 className="size-10 text-destructive" />
          <p className="text-sm font-medium">{t("core.error")}</p>
          {coreError && (
            <p className="max-w-xl text-sm text-muted-foreground">{coreError}</p>
          )}
        </div>
      ) : status === "starting" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <Gamepad2 className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("instances.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("instances.emptyHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {instances.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              installed={instance.installed}
              installTask={taskFor("install", instance.id, settings.instancesDir)}
              launchTask={taskFor("launch", instance.id)}
              validateTask={taskFor("validate", instance.id)}
              disabled={!coreReady}
              onInstall={() => beginInstall(instance)}
              onRetryValidate={() => validateThenInstall(instance)}
              onLaunch={() => handleLaunch(instance)}
              onShowLog={() => setLogInstanceId(instance.id)}
              onDelete={() => setDeleteTarget(instance)}
              onOpenDetail={() => onOpenDetail(instance.id)}
              onOpenContent={() => onOpenContent(instance.id)}
            />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
      <LogSheet
        instanceId={logInstanceId}
        onOpenChange={(open) => {
          if (!open) setLogInstanceId(null);
        }}
      />
      <DeleteInstanceDialog
        instance={deleteTarget && loaded.root === settings.instancesDir && instances.includes(deleteTarget) ? deleteTarget : null}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
