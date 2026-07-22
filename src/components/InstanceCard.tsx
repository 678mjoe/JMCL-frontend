import { Loader2, MoreVertical, Play, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { useSettings } from "@/lib/settings";
import type { Task } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fractionDigits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
}

export interface InstanceCardProps {
  instance: InstanceManifest;
  installed: boolean;
  installTask?: Task;
  launchTask?: Task;
  /** Core not ready — disables install/launch actions. */
  disabled?: boolean;
  onInstall: () => void;
  onLaunch: () => void;
  onShowLog: () => void;
  onDelete: () => void;
}

export function InstanceCard({
  instance,
  installed,
  installTask,
  launchTask,
  disabled = false,
  onInstall,
  onLaunch,
  onShowLog,
  onDelete,
}: InstanceCardProps) {
  const { t } = useSettings();

  const installing = installTask?.status === "running";
  const launching = launchTask?.status === "running";

  const progress = installTask?.progress ?? null;
  const hasByteProgress = progress != null && progress.bytesTotal > 0;
  const hasFileProgress = progress != null && progress.filesTotal > 0;
  const hasDeterminateProgress = hasByteProgress || hasFileProgress;
  const completed = hasByteProgress
    ? progress.bytesProcessed
    : (progress?.filesCompleted ?? 0);
  const total = hasByteProgress
    ? progress.bytesTotal
    : (progress?.filesTotal ?? 0);
  const percent = hasDeterminateProgress
    ? Math.min(100, Math.max(0, (completed / total) * 100))
    : null;
  const percentLabel =
    percent == null
      ? null
      : `${percent.toFixed(percent < 1 ? 2 : percent < 10 ? 1 : 0)}%`;

  const loaderBadge = instance.fabric_loader
    ? "Fabric"
    : instance.neoforge_version
      ? "NeoForge"
      : instance.forge_version
        ? "Forge"
        : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="truncate font-medium">{instance.name}</CardTitle>
          {!installed && !installing && (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("instances.notInstalled")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">{instance.version_id}</Badge>
          {loaderBadge && <Badge variant="outline">{loaderBadge}</Badge>}
        </div>
      </CardHeader>

      <CardContent className="min-h-12 space-y-1.5">
        {installTask?.status === "running" && (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t(installTask.stage)}</span>
              {percentLabel && (
                <span className="shrink-0 tabular-nums">{percentLabel}</span>
              )}
            </div>
            {hasDeterminateProgress ? (
              <>
                <Progress value={percent} />
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  {hasByteProgress ? (
                    <span>
                      {formatBytes(progress.bytesProcessed)} /{" "}
                      {formatBytes(progress.bytesTotal)}
                    </span>
                  ) : (
                    <span />
                  )}
                  {hasFileProgress && (
                    <span className="shrink-0">
                      {t("task.progress.files", {
                        completed: progress.filesCompleted.toLocaleString(),
                        total: progress.filesTotal.toLocaleString(),
                      })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div
                role="progressbar"
                aria-label={t(installTask.stage)}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
              </div>
            )}
          </>
        )}
        {installTask?.status === "error" && (
          <p className="text-xs text-destructive">{installTask.message}</p>
        )}
        {launchTask?.status === "running" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>
              {t("task.stage.launch")}
              {launchTask.pid != null && ` · ${launchTask.pid}`}
            </span>
          </p>
        )}
      </CardContent>

      <CardFooter className="gap-1.5">
        {!installed ? (
          <Button
            size="sm"
            className="flex-1"
            onClick={onInstall}
            disabled={disabled || installing}
          >
            {t("instances.install")}
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            onClick={onLaunch}
            disabled={disabled || launching || installing}
          >
            <Play />
            {t("instances.launch")}
          </Button>
        )}
        {launchTask && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("instances.log")}
            onClick={onShowLog}
          >
            <ScrollText />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <MoreVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onInstall} disabled={installing}>
              {t("instances.reinstall")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              {t("instances.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}
