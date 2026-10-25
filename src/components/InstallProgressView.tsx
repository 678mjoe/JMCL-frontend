import { Progress } from "@/components/ui/progress";
import { useSettings } from "@/lib/settings";
import { formatBytes, installPercent, type InstallProgressState } from "@/lib/installProgress";

export function InstallProgressView({ state, label }: { state: InstallProgressState; label?: string }) {
  const { t } = useSettings();
  const stageLabel = label ?? t(state.stage === "java" ? "task.stage.java" : state.stage === "processor" ? "task.stage.processor" : "task.stage.download");
  const progress = state.progress;
  const percent = state.stage === "processor" ? null : installPercent(progress);
  const detail = state.detail;
  const description = detail?.kind === "processor"
    ? t("task.progress.processor", { index: String(detail.index), total: String(detail.total) })
    : detail?.kind === "retry"
      ? t("task.progress.retry", { attempt: String(detail.attempt), total: String(detail.maxAttempts), reason: t(`task.progress.retry.${detail.reason}`) })
      : detail?.kind === "file"
        ? t(`task.progress.file.${detail.status}`)
        : detail?.kind === "java" ? t(`task.progress.java.${detail.phase}`) : null;
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{stageLabel}</span>
      {percent !== null && <span className="shrink-0 tabular-nums">{percent.toFixed(percent < 1 ? 2 : percent < 10 ? 1 : 0)}%</span>}
    </div>
    {percent !== null && progress ? <>
      <Progress value={percent} aria-label={stageLabel} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{progress.bytesTotal > 0 ? `${formatBytes(progress.bytesProcessed)} / ${formatBytes(progress.bytesTotal)}` : ""}</span>
        {progress.filesTotal > 0 && <span>{t("task.progress.files", { completed: progress.filesCompleted.toLocaleString(), total: progress.filesTotal.toLocaleString() })}</span>}
      </div>
    </> : <div role="progressbar" aria-label={stageLabel} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
    </div>}
    {percent === null && progress && progress.bytesProcessed > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">{t("task.progress.processed", { bytes: formatBytes(progress.bytesProcessed) })}</p>}
    {state.stage === "java" && state.javaPhase && detail?.kind !== "java" && <p className="text-xs text-muted-foreground">{t(`task.progress.java.${state.javaPhase}`)}</p>}
    {description && <p className="text-xs text-muted-foreground" role="status">{description}</p>}
  </div>;
}
