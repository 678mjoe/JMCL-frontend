import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CreateInstanceDialog } from "@/components/CreateInstanceDialog";
import { DeleteInstanceDialog } from "@/components/DeleteInstanceDialog";
import { InstanceCard } from "@/components/InstanceCard";
import { LogSheet } from "@/components/LogSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import { makeOfflineSession } from "@/lib/offline";
import { useSettings } from "@/lib/settings";
import { useTasks, type TaskStatus } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

export interface InstancesPageProps {
  onOpenDetail: (instanceId: string) => void;
}

export function InstancesPage({ onOpenDetail }: InstancesPageProps) {
  const { status, session } = useLauncher();
  const { settings, t } = useSettings();
  const { tasks, taskFor, startValidate, startInstall, startLaunch, clearTask } = useTasks();

  const [instances, setInstances] = useState<InstanceManifest[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logInstanceId, setLogInstanceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstanceManifest | null>(null);
  const [deleting, setDeleting] = useState(false);

  const coreReady = status === "ready";
  const dirs = { instancesDir: settings.instancesDir, storeDir: settings.storeDir };
  const beginInstall = (instance: InstanceManifest) => {
    void startInstall(instance, dirs);
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
    try {
      const result = await session.instanceList(settings.instancesDir);
      setInstances(result.instances);
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [status, session, settings.instancesDir]);

  // Load on mount and whenever the core becomes ready / the dir changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    void startLaunch(instance, dirs, makeOfflineSession(settings.playerName));
    setLogInstanceId(instance.id);
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || !session) return;
    setDeleting(true);
    try {
      await session.instanceDelete(settings.instancesDir, target.id);
      clearTask("validate", target.id);
      clearTask("install", target.id);
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
          <Button onClick={() => setDialogOpen(true)} disabled={!coreReady}>
            <Plus />
            {t("instances.new")}
          </Button>
        </div>
      </div>

      {status === "starting" ? (
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
              installTask={taskFor("install", instance.id)}
              launchTask={taskFor("launch", instance.id)}
              validateTask={taskFor("validate", instance.id)}
              disabled={!coreReady}
              onInstall={() => beginInstall(instance)}
              onRetryValidate={() => validateThenInstall(instance)}
              onLaunch={() => handleLaunch(instance)}
              onShowLog={() => setLogInstanceId(instance.id)}
              onDelete={() => setDeleteTarget(instance)}
              onOpenDetail={() => onOpenDetail(instance.id)}
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
        instance={deleteTarget}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
