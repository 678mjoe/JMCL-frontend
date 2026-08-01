import { Progress } from "@/components/ui/progress";
import { useSettings } from "@/lib/settings";
import type { Task } from "@/lib/tasks";

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fractionDigits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
}

export interface InstallTaskProgressProps {
  task: Task;
}

/**
 * Shared byte-first install progress display. The contract ranks byte totals
 * above file counts; this component keeps that rule in one place for cards and
 * detail views.
 */
export function InstallTaskProgress({ task }: InstallTaskProgressProps) {
  const { t } = useSettings();
  const progress = task.progress;
  const hasByteProgress = progress != null && progress.bytesTotal > 0;
  const hasFileProgress = progress != null && progress.filesTotal > 0;
  const hasDeterminateProgress = hasByteProgress || hasFileProgress;

  let percent: number | null = null;
  if (progress && hasDeterminateProgress) {
    const completed = hasByteProgress
      ? progress.bytesProcessed
      : progress.filesCompleted;
    const total = hasByteProgress ? progress.bytesTotal : progress.filesTotal;
    percent = Math.min(100, Math.max(0, (completed / total) * 100));
  }

  const percentLabel =
    percent == null
      ? null
      : `${percent.toFixed(percent < 1 ? 2 : percent < 10 ? 1 : 0)}%`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t(task.stage)}</span>
        {percentLabel && (
          <span className="shrink-0 tabular-nums">{percentLabel}</span>
        )}
      </div>
      {hasDeterminateProgress && progress ? (
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
          aria-label={t(task.stage)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
        </div>
      )}
    </div>
  );
}
