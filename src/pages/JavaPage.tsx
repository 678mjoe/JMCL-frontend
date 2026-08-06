import { useState } from "react";
import { Coffee, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/components/InstallTaskProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useJavaCatalog } from "@/lib/java";
import { errorText, useLauncher } from "@/lib/launcher";
import type { CoreSession, EventHandler } from "@/lib/rpc";
import { useSettings } from "@/lib/settings";
import type { JavaRuntime, ManagedJavaRuntime } from "@/lib/types";

/** Majors offered for managed install, covering all Minecraft generations. */
const INSTALLABLE_MAJORS = [8, 16, 17, 21, 25] as const;

function runtimeLabel(r: JavaRuntime): string {
  const major = r.major_version != null ? `Java ${r.major_version}` : "Java";
  return r.version ? `${major} · ${r.version}` : major;
}

function LocalRow({ runtime }: { runtime: JavaRuntime }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{runtimeLabel(runtime)}</span>
        {runtime.architecture && (
          <Badge variant="outline">{runtime.architecture}</Badge>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {runtime.vendor ? `${runtime.vendor} · ` : ""}
        {runtime.executable}
      </p>
    </li>
  );
}

function ManagedRow({
  runtime,
  pending,
  confirming,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  runtime: ManagedJavaRuntime;
  pending: boolean;
  confirming: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const { t } = useSettings();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Java {runtime.major_version}
            {runtime.version ? ` · ${runtime.version}` : ""}
          </span>
          <Badge variant="secondary">{runtime.provider}</Badge>
          <Badge variant="outline">{runtime.platform}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {runtime.bytes_total ? `${formatBytes(runtime.bytes_total)} · ` : ""}
          {runtime.executable}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-destructive">
            {t("content.removeConfirm")}
          </span>
          <Button size="sm" variant="destructive" disabled={pending} onClick={onRemove}>
            {t("content.remove")}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancelRemove}>
            {t("content.removeCancel")}
          </Button>
        </div>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          onClick={onAskRemove}
          aria-label={t("content.remove")}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      )}
    </li>
  );
}

function SliceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useSettings();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <span className="text-destructive">
        {t("java.loadFailed")}: {message}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-4" />
        {t("common.retry")}
      </Button>
    </div>
  );
}

/**
 * Java runtime management: locally detected runtimes, managed runtimes in the
 * shared store, and managed installs by major version (docs/java.md).
 */
export function JavaPage() {
  const { openSession } = useLauncher();
  const { settings, t } = useSettings();
  const { local, managed, reload, satisfiedMajors } = useJavaCatalog();
  const [installingMajor, setInstallingMajor] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const install = async (major: number) => {
    setInstallingMajor(major);
    setProgress(null);
    let session: CoreSession | null = null;
    try {
      session = await openSession();
      const trackProgress: EventHandler = (event) => {
        if (event.kind !== "event") return;
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
        { store_directory: settings.storeDir },
        trackProgress,
      );
      toast.success(t("java.installedToast", { major }));
      await reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      if (session) void session.close();
      setInstallingMajor(null);
      setProgress(null);
    }
  };

  const remove = async (name: string) => {
    setRemovingName(name);
    setConfirmName(null);
    try {
      const session = await openSession();
      try {
        await session.javaRuntimeRemove(name, settings.storeDir);
      } finally {
        void session.close();
      }
      toast.success(t("java.removedToast"));
      await reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRemovingName(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Coffee className="size-6" />
          {t("java.title")}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          title={t("instances.refresh")}
          onClick={() => void reload()}
          disabled={local.status === "loading" || managed.status === "loading"}
        >
          <RefreshCw
            className={
              local.status === "loading" || managed.status === "loading"
                ? "animate-spin"
                : undefined
            }
          />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("java.installMajor")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {INSTALLABLE_MAJORS.map((major) => {
            const satisfied = satisfiedMajors.has(major);
            const installing = installingMajor === major;
            return (
              <Button
                key={major}
                variant={satisfied ? "secondary" : "outline"}
                disabled={satisfied || installingMajor !== null}
                onClick={() => void install(major)}
              >
                {installing && <Loader2 className="animate-spin" />}
                {installing
                  ? progress && progress.total > 0
                    ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)}`
                    : t("java.installing")
                  : satisfied
                    ? `Java ${major} · ${t("java.satisfied")}`
                    : `Java ${major}`}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("java.managed")}</CardTitle>
        </CardHeader>
        <CardContent>
          {managed.status === "loading" ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : managed.status === "error" ? (
            <SliceError message={managed.error ?? ""} onRetry={() => void reload()} />
          ) : managed.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("java.emptyManaged")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {managed.items.map((runtime) => (
                <ManagedRow
                  key={runtime.name}
                  runtime={runtime}
                  pending={removingName === runtime.name}
                  confirming={confirmName === runtime.name}
                  onAskRemove={() => setConfirmName(runtime.name)}
                  onCancelRemove={() => setConfirmName(null)}
                  onRemove={() => void remove(runtime.name)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("java.local")}</CardTitle>
        </CardHeader>
        <CardContent>
          {local.status === "loading" ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : local.status === "error" ? (
            <SliceError message={local.error ?? ""} onRetry={() => void reload()} />
          ) : local.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("java.emptyLocal")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {local.items.map((runtime) => (
                <LocalRow key={runtime.executable} runtime={runtime} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
