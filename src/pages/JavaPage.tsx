import { downloadOptions } from "@/lib/downloadOptions";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Coffee, Download, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/components/InstallTaskProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useJavaCatalog } from "@/lib/java";
import { errorText, useLauncher } from "@/lib/launcher";
import type { CoreSession, EventHandler } from "@/lib/rpc";
import { useSettings } from "@/lib/settings";
import type { JavaRuntime, ManagedJavaRuntime } from "@/lib/types";

/** Majors offered for managed install, covering all Minecraft generations. */
const INSTALLABLE_MAJORS = [8, 16, 17, 21, 25] as const;
const TARGET_PLATFORMS = { linux: "Linux", windows: "Windows", osx: "macOS" };

function runtimeLabel(r: JavaRuntime): string {
  const major = r.major_version != null ? `Java ${r.major_version}` : "Java";
  return r.version ? `${major} · ${r.version}` : major;
}

function LocalRow({ runtime }: { runtime: JavaRuntime }) {
  return (
    <li className="flex min-w-0 items-center gap-3 px-(--jmcl-panel-padding) py-3">
      <Coffee className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold [overflow-wrap:anywhere]">{runtimeLabel(runtime)}</span>
          {runtime.vendor && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{runtime.vendor}</span>}
          {runtime.architecture && <Badge variant="outline">{runtime.architecture}</Badge>}
        </div>
        <p className="font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {runtime.executable}
        </p>
      </div>
    </li>
  );
}

function ManagedRow({
  runtime,
  pending,
  confirming,
  removing,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  runtime: ManagedJavaRuntime;
  pending: boolean;
  confirming: boolean;
  removing: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const { t } = useSettings();
  return (
    <li className="min-w-0 px-(--jmcl-panel-padding) py-3">
      <div className="flex min-w-0 items-center gap-3">
        <HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold [overflow-wrap:anywhere]">
              Java {runtime.major_version}
              {runtime.version ? ` · ${runtime.version}` : ""}
            </span>
            <Badge variant="secondary">{runtime.provider}</Badge>
            <Badge variant="outline">{runtime.platform}</Badge>
          </div>
          <p className="font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {runtime.bytes_total ? `${formatBytes(runtime.bytes_total)} · ` : ""}
            {runtime.executable}
          </p>
        </div>
        {!confirming && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            onClick={onAskRemove}
            title={t(removing ? "java.removing" : "content.remove")}
            aria-label={t(removing ? "java.removing" : "content.remove")}
          >
            {removing
              ? <Loader2 className="text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
              : <Trash2 className="text-muted-foreground" aria-hidden="true" />}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">
            {t("content.removeConfirm")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" autoFocus disabled={pending} onClick={onCancelRemove}>
              {t("content.removeCancel")}
            </Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={onRemove}>
              {t("content.remove")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function SliceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useSettings();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-(--jmcl-panel-padding) py-3 text-sm">
      <div role="alert" className="flex min-w-0 items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{t("java.loadFailed")}</p>
          {message && <p className="text-muted-foreground [overflow-wrap:anywhere]">{message}</p>}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t("common.retry")}
      </Button>
    </div>
  );
}

function CatalogLoading() {
  const { t } = useSettings();
  return (
    <div role="status" className="space-y-2 px-(--jmcl-panel-padding) py-3.5">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton aria-hidden="true" className="h-3 w-28" />
      <Skeleton aria-hidden="true" className="h-2.5 w-2/3" />
    </div>
  );
}

/**
 * Java runtime management: locally detected runtimes, managed runtimes in the
 * shared store, and managed installs by major version (docs/java.md).
 */
export function JavaPage() {
  const { openSession, status, error } = useLauncher();
  const { settings, t } = useSettings();
  const { local, managed, reload, satisfiedMajors, target } = useJavaCatalog();
  const [installingMajor, setInstallingMajor] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const mounted = useRef(false);
  const busy = useRef(false);
  const currentStore = useRef(settings.storeDir);
  const scopeRevision = useRef(0);
  if (currentStore.current !== settings.storeDir) { currentStore.current = settings.storeDir; scopeRevision.current++; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setConfirmName(null); setProgress(null); }, [settings.storeDir]);

  const install = async (major: number) => {
    if (busy.current || !settings.storeDir) return;
    busy.current = true;
    const store = settings.storeDir;
    const tuning = downloadOptions(settings);
    const revision = scopeRevision.current;
    const current = () => mounted.current && scopeRevision.current === revision;
    setInstallingMajor(major);
    setProgress(null);
    let session: CoreSession | null = null;
    try {
      session = await openSession();
      const trackProgress: EventHandler = (event) => {
        if (!current() || event.kind !== "event") return;
        const e = event.data as {
          event?: string;
          progress?: { bytes_processed: number; bytes_total: number };
        };
        if (e.event === "progress" && e.progress) {
          setProgress({
            done: e.progress.bytes_processed,
            total: e.progress.bytes_total,
          });
        }
      };
      await session.javaRuntimeInstall(
        { major },
        { store_directory: store, ...tuning },
        trackProgress,
      );
      if (current()) { toast.success(t("java.installedToast", { major })); await reload(); }
    } catch (e) {
      if (current()) toast.error(errorText(e));
    } finally {
      if (session) void session.close();
      busy.current = false;
      if (mounted.current) { setInstallingMajor(null); setProgress(null); }
    }
  };

  const remove = async (name: string) => {
    if (busy.current || !settings.storeDir) return;
    busy.current = true;
    const store = settings.storeDir;
    const revision = scopeRevision.current;
    const current = () => mounted.current && scopeRevision.current === revision;
    setRemovingName(name);
    setConfirmName(null);
    try {
      const session = await openSession();
      try {
        await session.javaRuntimeRemove(name, store);
      } finally {
        void session.close();
      }
      if (current()) { toast.success(t("java.removedToast")); await reload(); }
    } catch (e) {
      if (current()) toast.error(errorText(e));
    } finally {
      busy.current = false;
      if (mounted.current) setRemovingName(null);
    }
  };

  const loading = local.status === "loading" || managed.status === "loading";
  const operating = installingMajor !== null || removingName !== null;
  const knownProgress = progress && Number.isFinite(progress.done) && Number.isFinite(progress.total) && progress.total > 0 ? progress : null;

  return (
    <div className="jmcl-page @container/java">
      <header className="jmcl-page-header">
        <div className="min-w-0">
          <h1 className="jmcl-page-title">{t("java.title")}</h1>
          {target && (
            <p className="jmcl-page-description">
              {t("java.target", { platform: TARGET_PLATFORMS[target.os], arch: target.arch })}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={status !== "ready" || loading || operating}>
          <RefreshCw className={status === "ready" && settings.storeDir && loading ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
          {t("instances.refresh")}
        </Button>
      </header>

      {status === "error" ? (
        <div role="alert" className="jmcl-state jmcl-panel">
          <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
          <p className="text-sm font-semibold">{t("core.error")}</p>
          {error && <p className="max-w-xl text-sm text-muted-foreground">{error}</p>}
        </div>
      ) : status === "starting" ? (
        <div role="status" className="jmcl-state jmcl-panel">
          <Loader2 className="size-6 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
          <p className="text-sm font-medium">{t("core.starting")}</p>
        </div>
      ) : !settings.storeDir ? (
        <div role="status" className="jmcl-state jmcl-panel">
          <HardDrive className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">{t("java.storeRequired")}</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4">
          <section className="jmcl-panel @container/install space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="java-install-title">
            <header>
              <h2 id="java-install-title" className="text-base font-semibold tracking-tight">{t("java.installMajor")}</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("java.installHint")}</p>
            </header>
            <div className="grid grid-cols-2 gap-2 @min-[18rem]/install:grid-cols-3 @min-[22rem]/install:grid-cols-5">
              {INSTALLABLE_MAJORS.map((major) => {
                const satisfied = satisfiedMajors.has(major);
                const label = `Java ${major}`;
                return (
                  <Button
                    key={major}
                    variant={satisfied ? "secondary" : "outline"}
                    className="h-12 w-full min-w-0 flex-col gap-0.5 border-border px-2 text-center leading-none"
                    disabled={operating}
                    aria-label={satisfied ? `${label} · ${t("java.satisfied")}` : label}
                    onClick={() => void install(major)}
                  >
                    <span>{label}</span>
                    <span className="flex h-3.5 items-center text-[0.6875rem] text-muted-foreground">
                      {satisfied ? t("java.satisfied") : <Download className="size-3" aria-hidden="true" />}
                    </span>
                  </Button>
                );
              })}
            </div>
            {installingMajor !== null && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div role="status" className="flex items-center gap-1.5 font-medium">
                    <Loader2 className="size-3.5 text-primary motion-safe:animate-spin" aria-hidden="true" />
                    Java {installingMajor} · {t("java.installing")}
                  </div>
                  {knownProgress && (
                    <span className="text-muted-foreground tabular-nums">
                      {formatBytes(knownProgress.done)} / {formatBytes(knownProgress.total)}
                    </span>
                  )}
                </div>
                {knownProgress && (
                  <Progress value={Math.min(100, Math.max(0, knownProgress.done / knownProgress.total * 100))} aria-label={t("java.installing")} />
                )}
              </div>
            )}
          </section>

          <div className="grid min-w-0 gap-4 @min-[48rem]/java:grid-cols-2">
            <section aria-labelledby="java-managed-title" className="jmcl-panel">
              <h2 id="java-managed-title" className="border-b px-(--jmcl-panel-padding) py-3 text-base font-semibold tracking-tight">{t("java.managed")}</h2>
              {managed.status === "loading" ? (
                <CatalogLoading />
              ) : managed.status === "error" ? (
                <SliceError message={managed.error ?? ""} onRetry={() => void reload()} />
              ) : managed.items.length === 0 ? (
                <p className="px-(--jmcl-panel-padding) py-3 text-sm text-muted-foreground">{t("java.emptyManaged")}</p>
              ) : (
                <ul className="divide-y">
                  {managed.items.map((runtime) => (
                    <ManagedRow
                      key={runtime.name}
                      runtime={runtime}
                      pending={operating}
                      confirming={confirmName === runtime.name}
                      removing={removingName === runtime.name}
                      onAskRemove={() => setConfirmName(runtime.name)}
                      onCancelRemove={() => setConfirmName(null)}
                      onRemove={() => void remove(runtime.name)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="java-local-title" className="jmcl-panel">
              <h2 id="java-local-title" className="border-b px-(--jmcl-panel-padding) py-3 text-base font-semibold tracking-tight">{t("java.local")}</h2>
              {local.status === "loading" ? (
                <CatalogLoading />
              ) : local.status === "error" ? (
                <SliceError message={local.error ?? ""} onRetry={() => void reload()} />
              ) : local.items.length === 0 ? (
                <p className="px-(--jmcl-panel-padding) py-3 text-sm text-muted-foreground">{t("java.emptyLocal")}</p>
              ) : (
                <ul className="divide-y">
                  {local.items.map((runtime) => (
                    <LocalRow key={runtime.executable} runtime={runtime} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
