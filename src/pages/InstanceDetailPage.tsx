import { javaPreferencesFor } from "@/lib/javaPreferences";
import { downloadOptions } from "@/lib/downloadOptions";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Loader2,
  Package,
  Play,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DeleteInstanceDialog } from "@/components/DeleteInstanceDialog";
import { InstanceLaunchOptions } from "@/components/InstanceLaunchOptions";
import { InstanceJavaCard } from "@/components/InstanceJavaCard";
import { InstallTaskProgress } from "@/components/InstallTaskProgress";
import { LogSheet } from "@/components/LogSheet";
import { WorldsManager } from "@/components/WorldsManager";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import { AuthTransientError, ReloginRequiredError, useLaunchAuth } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { launchOptionsFor } from "@/lib/launchOptions";
import { instanceLaunchOptions } from "@/lib/instanceLaunch";
import { withOpenedSession } from "@/lib/sessionLifecycle";
import { useSettings } from "@/lib/settings";
import { useTasks, type TaskStatus } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

export interface InstanceDetailPageProps {
  instanceId: string;
  onBack: () => void;
  onOpenContent: () => void;
}

export function loaderLabel(instance: InstanceManifest): string {
  if (instance.fabric_loader) return `Fabric ${instance.fabric_loader}`;
  if (instance.neoforge_version) return `NeoForge ${instance.neoforge_version}`;
  if (instance.forge_version) return `Forge ${instance.forge_version}`;
  return "";
}

export function InstanceDetailPage({
  instanceId,
  onBack,
  onOpenContent,
}: InstanceDetailPageProps) {
  const { status, session, openSession, error: coreError } = useLauncher();
  const { settings, t } = useSettings();
  const { taskFor, startValidate, startInstall, startLaunch, clearTask } = useTasks();
  const resolveLaunchAuth = useLaunchAuth();

  const currentScope = `${settings.instancesDir}\0${instanceId}`;
  const scopeRef = useRef(currentScope);
  const scopeGeneration = useRef(0);
  if (scopeRef.current !== currentScope) scopeGeneration.current++;
  scopeRef.current = currentScope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scopeGeneration.current++; }; }, []);
  const refreshRevision = useRef(0);
  const [manifestScope, setManifestScope] = useState("");
  const [manifest, setManifest] = useState<InstanceManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const coreReady = status === "ready";
  const dirs = { instancesDir: settings.instancesDir, storeDir: settings.storeDir, ...downloadOptions(settings) };
  const installTask = taskFor("install", instanceId, settings.instancesDir);
  const launchTask = taskFor("launch", instanceId, settings.instancesDir);
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
    const revision = ++refreshRevision.current;
    const scope = currentScope;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const result = await session.instanceGet(settings.instancesDir, instanceId);
      if (!mounted.current || revision !== refreshRevision.current || scopeRef.current !== scope) return;
      setManifestScope(scope);
      setManifest(result);
    } catch (e) {
      if (!mounted.current || revision !== refreshRevision.current || scopeRef.current !== scope) return;
      setManifest(null);
      setNotFound(
        e instanceof RpcError &&
          e.kind === "rpc" &&
          e.code === "INSTANCE_NOT_FOUND",
      );
      setLoadError(errorText(e));
    } finally {
      if (mounted.current && revision === refreshRevision.current && scopeRef.current === scope) setLoading(false);
    }
  }, [status, session, settings.instancesDir, instanceId, currentScope]);

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
    if (!manifest || manifestScope !== currentScope) return;
    void startInstall(manifest, dirs, javaPreferencesFor(settings.javaPreferences, dirs.instancesDir, manifest.id));
  };

  const retryValidate = () => {
    if (!manifest || manifestScope !== currentScope) return;
    void startValidate(manifest).then((ok) => {
      if (ok) beginInstall();
    });
  };

  const beginLaunch = () => {
    if (!manifest || manifestScope !== currentScope) return;
    const generation = scopeGeneration.current;
    void (async () => {
      try {
        const auth = await resolveLaunchAuth();
        if (!mounted.current || generation !== scopeGeneration.current || scopeRef.current !== currentScope) return;
        void startLaunch(manifest, dirs, auth, javaPreferencesFor(settings.javaPreferences, settings.instancesDir, manifest.id), launchOptionsFor(settings.launchOptions, dirs.instancesDir, manifest.id));
        setLogOpen(true);
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
    if (!manifest || !session || manifestScope !== currentScope) return;
    setDeleting(true);
    try {
      await session.instanceDelete(settings.instancesDir, manifest.id);
      clearTask("validate", manifest.id);
      clearTask("install", manifest.id, settings.instancesDir);
      clearTask("launch", manifest.id, settings.instancesDir);
      setDeleteOpen(false);
      toast.success(t("detail.deleted", { name: manifest.name }));
      onBack();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  const backButton = (
    <Button variant="ghost" size="sm" className="jmcl-back" onClick={onBack}>
      <ArrowLeft />
      {t("detail.back")}
    </Button>
  );
  const waiting = status === "starting" ||
    (coreReady && (loading || manifestScope !== currentScope) && !loadError && !notFound);

  if (waiting || status === "error" || notFound || loadError || !manifest) {
    const failureTitle = status === "error" ? "core.error" : notFound ? "detail.notFound" : "detail.loadError";
    const failureMessage = status === "error" ? coreError : notFound ? t("detail.notFoundDescription") : loadError;
    return (
      <div className="jmcl-page">
        {backButton}
        {waiting ? (
          <div className="space-y-4" role="status">
            <span className="sr-only">{t(status === "starting" ? "core.starting" : "common.loading")}</span>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <section className="jmcl-panel jmcl-state">
            <div role="alert" className="flex min-w-0 flex-col items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-7 text-destructive" />
              <h1 className="text-base font-semibold">{t(failureTitle)}</h1>
              {failureMessage && <p className="max-w-lg break-words text-sm text-muted-foreground">{failureMessage}</p>}
            </div>
            {coreReady && !notFound && (
              <Button variant="outline" onClick={() => void refresh()}>
                <RefreshCw />
                {t("common.retry")}
              </Button>
            )}
          </section>
        )}
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
    <div className="jmcl-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {backButton}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("instances.refresh")}
          title={t("instances.refresh")}
          onClick={() => void refresh()}
          disabled={!coreReady || loading || deleting}
        >
          <RefreshCw />
        </Button>
      </div>

      <header className="jmcl-page-header">
        <div className="min-w-0">
          <h1 className="jmcl-page-title">{manifest.name}</h1>
          <p className="jmcl-page-description wrap-anywhere">
            Minecraft {manifest.version_id}{loader && <> <span aria-hidden="true">·</span> {loader}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="min-w-26 gap-2 px-4 font-semibold"
            onClick={manifest.installed ? beginLaunch : beginInstall}
            disabled={!coreReady || installing || (manifest.installed && launching) || validating || deleting}
          >
            {installing || (manifest.installed && launching)
              ? <Loader2 className="animate-spin" />
              : manifest.installed ? <Play className="fill-current" /> : <Download />}
            {t(manifest.installed ? "instances.launch" : "instances.install")}
          </Button>
          <Button
            variant="outline"
            className="gap-2 px-4"
            onClick={onOpenContent}
            disabled={deleting}
          >
            <Package />
            {t("instances.content")}
          </Button>
          {launchTask && (
            <Button variant="outline" className="gap-2 px-4" onClick={() => setLogOpen(true)}>
              <ScrollText />
              {t("instances.log")}
            </Button>
          )}
        </div>
      </header>

      <div className="jmcl-panel grid divide-y divide-border lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:divide-x lg:divide-y-0">
        <section className="flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-labelledby="instance-info-title">
          <h2 id="instance-info-title" className="text-base font-semibold">{t("detail.info")}</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("detail.id")}</dt>
              <dd className="mt-1 break-all font-mono text-sm">{manifest.id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("detail.downloadSource")}</dt>
              <dd className="mt-1 break-words text-sm">{sourceLabel}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("detail.installState")}</dt>
              <dd className="mt-1 text-sm">{t(manifest.installed ? "detail.installed" : "instances.notInstalled")}</dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t("detail.directory")}</dt>
              <dd className="mt-1 break-all font-mono text-xs leading-relaxed">{instanceDirectory}</dd>
            </div>
          </dl>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={beginInstall}
              disabled={!coreReady || installing || validating || deleting}
            >
              <RefreshCw />
              {t("instances.reinstall")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              <Trash2 />
              {t("instances.delete")}
            </Button>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3 p-4 sm:p-5" aria-labelledby="instance-status-title">
          <h2 id="instance-status-title" className="text-base font-semibold">{t("detail.status")}</h2>
          <div className="min-w-0 space-y-3 break-words">
            {validating && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
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
            {installTask?.status === "running" && (
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
              <p className="text-sm text-muted-foreground" role="status">
                {t("task.install")} · {t("task.success")}
              </p>
            )}
            {launchTask?.status === "running" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" />
                <span>
                  {t(launchTask.stage)}
                  {launchTask.pid != null && ` · pid ${launchTask.pid}`}
                </span>
              </p>
            )}
            {launchTask?.status === "success" && (
              <p className="text-sm text-muted-foreground" role="status">
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
            {!installTask && !launchTask && (!validateTask || validateTask.status === "success") && (
              <p className="text-sm text-muted-foreground">
                {t(manifest.installed ? "detail.readyDescription" : "detail.installRequired")}
              </p>
            )}
          </div>
        </section>
      </div>

      <WorldsManager instance={manifest} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <InstanceJavaCard instance={manifest} />
        </div>
        <div className="min-w-0">
          <InstanceLaunchOptions instance={manifest} onPreview={async (options) => {
            if (manifestScope !== currentScope) throw new Error("Stale instance");
            const generation = scopeGeneration.current;
            const auth = await resolveLaunchAuth();
            if (!mounted.current || generation !== scopeGeneration.current || scopeRef.current !== currentScope) throw new Error("Stale instance");
            const directory = `${settings.instancesDir}/${manifest.id}/.minecraft`;
            return withOpenedSession(openSession, (previewSession) => {
              if (!mounted.current || generation !== scopeGeneration.current) throw new Error("Stale instance");
              return previewSession.launchPlan(
                manifest.version_id, directory, `${directory}/.jmcl-preview-natives`, auth,
                instanceLaunchOptions(manifest, settings.storeDir, javaPreferencesFor(settings.javaPreferences, settings.instancesDir, manifest.id), options),
              );
            });
          }} />
        </div>
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
