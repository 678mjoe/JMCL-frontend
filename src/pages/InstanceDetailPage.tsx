import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Gamepad2,
  Loader2,
  Play,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DeleteInstanceDialog } from "@/components/DeleteInstanceDialog";
import { InstallTaskProgress } from "@/components/InstallTaskProgress";
import { LogSheet } from "@/components/LogSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import { makeOfflineSession } from "@/lib/offline";
import { RpcError } from "@/lib/rpc";
import { useSettings } from "@/lib/settings";
import { useTasks, type TaskStatus } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

export interface InstanceDetailPageProps {
  instanceId: string;
  onBack: () => void;
}

function loaderLabel(instance: InstanceManifest): string {
  if (instance.fabric_loader) return `Fabric ${instance.fabric_loader}`;
  if (instance.neoforge_version) return `NeoForge ${instance.neoforge_version}`;
  if (instance.forge_version) return `Forge ${instance.forge_version}`;
  return "";
}

export function InstanceDetailPage({
  instanceId,
  onBack,
}: InstanceDetailPageProps) {
  const { status, session, error: coreError } = useLauncher();
  const { settings, t } = useSettings();
  const { taskFor, startValidate, startInstall, startLaunch, clearTask } = useTasks();

  const [manifest, setManifest] = useState<InstanceManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const coreReady = status === "ready";
  const dirs = { instancesDir: settings.instancesDir, storeDir: settings.storeDir };
  const installTask = taskFor("install", instanceId);
  const launchTask = taskFor("launch", instanceId);
  const validateTask = taskFor("validate", instanceId);
  const installing = installTask?.status === "running";
  const launching = launchTask?.status === "running";
  const validating = validateTask?.status === "running";

  const refresh = useCallback(async () => {
    if (status !== "ready" || !session) return;
    if (!settings.instancesDir) {
      // Settings resolves its app-data defaults asynchronously on first run.
      setLoading(true);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const result = await session.instanceGet(settings.instancesDir, instanceId);
      setManifest(result);
    } catch (e) {
      setManifest(null);
      setNotFound(
        e instanceof RpcError &&
          e.kind === "rpc" &&
          e.code === "INSTANCE_NOT_FOUND",
      );
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [status, session, settings.instancesDir, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The install task owns progress; only its success edge refreshes the
  // authoritative manifest. Repeated success renders do not re-query core.
  const previousInstallStatus = useRef<TaskStatus | undefined>(installTask?.status);
  useEffect(() => {
    const current = installTask?.status;
    if (current === "success" && previousInstallStatus.current !== "success") {
      void refresh();
    }
    previousInstallStatus.current = current;
  }, [installTask?.status, refresh]);

  const beginInstall = () => {
    if (!manifest) return;
    void startInstall(manifest, dirs);
  };

  const retryValidate = () => {
    if (!manifest) return;
    void startValidate(manifest).then((ok) => {
      if (ok) beginInstall();
    });
  };

  const beginLaunch = () => {
    if (!manifest) return;
    void startLaunch(manifest, dirs, makeOfflineSession(settings.playerName));
    setLogOpen(true);
  };

  const confirmDelete = async () => {
    if (!manifest || !session) return;
    setDeleting(true);
    try {
      await session.instanceDelete(settings.instancesDir, manifest.id);
      clearTask("validate", manifest.id);
      clearTask("install", manifest.id);
      clearTask("launch", manifest.id);
      setDeleteOpen(false);
      toast.success(t("detail.deleted", { name: manifest.name }));
      onBack();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  if (
    status === "starting" ||
    (loading && !manifest && !loadError && !notFound)
  ) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {t("detail.back")}
        </Button>
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <Gamepad2 className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("core.error")}</p>
          <p className="text-sm text-muted-foreground">
            {loadError ?? coreError}
          </p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {t("detail.back")}
        </Button>
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <Gamepad2 className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("detail.notFound")}</p>
          <p className="text-sm text-muted-foreground">
            {t("detail.notFoundDescription")}
          </p>
          <Button variant="outline" onClick={onBack}>
            {t("detail.back")}
          </Button>
        </div>
      </div>
    );
  }

  if (loadError || !manifest) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {t("detail.back")}
        </Button>
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <Gamepad2 className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("detail.loadError")}</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw />
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const loader = loaderLabel(manifest);
  const sourceLabel =
    manifest.source === "bmclapi"
      ? t("settings.source.bmclapi")
      : t("settings.source.official");
  const instanceDirectory = settings.instancesDir
    ? `${settings.instancesDir}/${manifest.id}`
    : manifest.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft />
            {t("detail.back")}
          </Button>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{manifest.name}</h1>
            <Badge variant="secondary">{manifest.version_id}</Badge>
            {loader && <Badge variant="outline">{loader}</Badge>}
            {!manifest.installed && (
              <Badge variant="secondary" className="text-muted-foreground">
                {t("instances.notInstalled")}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            title={t("instances.refresh")}
            onClick={() => void refresh()}
            disabled={!coreReady || loading || deleting}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          {!manifest.installed ? (
            <Button
              onClick={beginInstall}
              disabled={!coreReady || installing || validating || deleting}
            >
              {installing && <Loader2 className="animate-spin" />}
              {t("instances.install")}
            </Button>
          ) : (
            <Button
              onClick={beginLaunch}
              disabled={!coreReady || installing || launching || validating || deleting}
            >
              {launching ? <Loader2 className="animate-spin" /> : <Play />}
              {t("instances.launch")}
            </Button>
          )}
          {launchTask && (
            <Button
              variant="outline"
              size="icon"
              title={t("instances.log")}
              onClick={() => setLogOpen(true)}
            >
              <ScrollText />
            </Button>
          )}
          <Button
            variant="outline"
            onClick={beginInstall}
            disabled={!coreReady || installing || validating || deleting}
          >
            <RefreshCw />
            {t("instances.reinstall")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            <Trash2 />
            {t("instances.delete")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.info")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("detail.id")}</dt>
                <dd className="mt-1 font-mono text-sm">{manifest.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("detail.minecraftVersion")}
                </dt>
                <dd className="mt-1 text-sm">{manifest.version_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("detail.loader")}</dt>
                <dd className="mt-1 text-sm">
                  {loader || t("detail.loaderNone")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("detail.downloadSource")}
                </dt>
                <dd className="mt-1 text-sm">{sourceLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("detail.installState")}
                </dt>
                <dd className="mt-1 text-sm">
                  {manifest.installed
                    ? t("detail.installed")
                    : t("instances.notInstalled")}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {t("detail.directory")}
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {instanceDirectory}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("detail.status")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {validating && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("task.stage.validate")}</span>
              </p>
            )}
            {validateTask?.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {t("task.validate")} · {t("task.failed")}
                </p>
                <p className="text-xs text-destructive">{validateTask.message}</p>
                <Button variant="outline" size="xs" onClick={retryValidate}>
                  {t("task.retryValidate")}
                </Button>
              </div>
            )}
            {installTask?.status === "running" && installTask && (
              <InstallTaskProgress task={installTask} />
            )}
            {installTask?.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {t("task.failed")}
                </p>
                <p className="text-xs text-destructive">{installTask.message}</p>
              </div>
            )}
            {installTask?.status === "success" && (
              <p className="text-sm text-muted-foreground">
                {t("task.install")} · {t("task.success")}
              </p>
            )}
            {launchTask?.status === "running" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>
                  {t("task.stage.launch")}
                  {launchTask.pid != null && ` · pid ${launchTask.pid}`}
                </span>
              </p>
            )}
            {launchTask?.status === "success" && (
              <p className="text-sm text-muted-foreground">
                {t("task.launch")} · {launchTask.message ?? t("task.success")}
              </p>
            )}
            {launchTask?.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {t("task.launch")} · {t("task.failed")}
                </p>
                <p className="text-xs text-destructive">{launchTask.message}</p>
              </div>
            )}
            {!installTask && !launchTask && !validateTask && (
              <p className="text-sm text-muted-foreground">
                {manifest.installed
                  ? t("detail.readyDescription")
                  : t("detail.installRequired")}
              </p>
            )}
          </CardContent>
          {(installTask || launchTask || validateTask?.status === "error") && (
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogOpen(true)}
                disabled={!launchTask}
              >
                <ScrollText />
                {t("instances.log")}
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>

      <LogSheet
        instanceId={logOpen ? instanceId : null}
        onOpenChange={(open) => {
          if (!open) setLogOpen(false);
        }}
      />
      <DeleteInstanceDialog
        instance={deleteOpen ? manifest : null}
        deleting={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
