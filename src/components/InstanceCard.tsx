import { Anvil, Box, Download, Flame, Layers3, Loader2, MoreHorizontal, Play, ScrollText } from "lucide-react";
import { InstallTaskProgress } from "@/components/InstallTaskProgress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/lib/settings";
import type { Task } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";
import { cn } from "@/lib/utils";

// An optional personal preview render stays outside public/ and the production bundle.
const featuredBlockPreview: string | undefined = import.meta.env.DEV
  ? import.meta.env.VITE_JMCL_FEATURE_BLOCK_PREVIEW
  : undefined;

export interface InstanceCardProps {
  instance: InstanceManifest;
  installed: boolean;
  featured?: boolean;
  installTask?: Task;
  launchTask?: Task;
  validateTask?: Task;
  /** Core not ready — disables install/launch actions. */
  disabled?: boolean;
  onInstall: () => void;
  onRetryValidate: () => void;
  onLaunch: () => void;
  onShowLog: () => void;
  onDelete: () => void;
  onOpenDetail: () => void;
  onOpenContent: () => void;
}

export function InstanceCard({
  instance,
  installed,
  featured = false,
  installTask,
  launchTask,
  validateTask,
  disabled = false,
  onInstall,
  onRetryValidate,
  onLaunch,
  onShowLog,
  onDelete,
  onOpenDetail,
  onOpenContent,
}: InstanceCardProps) {
  const { t } = useSettings();

  const installing = installTask?.status === "running";
  const launching = launchTask?.status === "running";
  const validating = validateTask?.status === "running";
  const validationFailed = validateTask?.status === "error";
  const installFailed = installTask?.status === "error";
  const launchFailed = launchTask?.status === "error";
  const active = installing || launching || validating;
  const statusError = validationFailed || installFailed || launchFailed;

  const loader = instance.fabric_loader
    ? { label: "Fabric", version: instance.fabric_loader, Icon: Layers3 }
    : instance.neoforge_version
      ? { label: "NeoForge", version: instance.neoforge_version, Icon: Flame }
      : instance.forge_version
        ? { label: "Forge", version: instance.forge_version, Icon: Anvil }
        : { label: t("instances.vanilla"), version: null, Icon: Box };

  let status = t(installed ? "detail.installed" : "instances.notInstalled");
  if (validationFailed) status = t("task.failed");
  else if (installFailed) status = t("instances.installFailed");
  else if (launchFailed) status = t("instances.launchFailed");

  const statusLabel = !active && (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
      featured ? "text-white/80" : statusError ? "text-destructive" : "text-muted-foreground",
    )}>
      <span aria-hidden="true" className={cn(
        "size-1.5 rounded-full",
        statusError
          ? featured ? "bg-red-300" : "bg-destructive"
          : installed ? "bg-emerald-600 dark:bg-emerald-300" : "bg-current opacity-70",
      )} />
      {status}
    </span>
  );

  const headingId = `instance-card-${instance.id}`;
  const ActionIcon = installed ? Play : Download;
  const featuredButton = "text-white/84 hover:bg-white/12 hover:text-white focus-visible:ring-white/50 dark:hover:bg-white/12";
  const instanceName = (
    <button
      type="button"
      className="max-w-full rounded-sm text-left [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={onOpenDetail}
    >
      {instance.name}
    </button>
  );
  const gameVersion = (
    <p className={cn("text-sm [overflow-wrap:anywhere]", featured ? "text-white/80" : "text-muted-foreground")}>
      {instance.version_id} <span aria-hidden="true" className="mx-0.5">·</span> {loader.label}{loader.version && ` ${loader.version}`}
    </p>
  );

  const activity = (active || validationFailed || installFailed) && (
    <div className={cn(
      "min-w-0 space-y-2 [overflow-wrap:anywhere]",
      featured
        ? "max-w-lg rounded-lg border border-white/15 bg-black/15 p-3 [--muted-foreground:#dce2e9] [--muted:#414b57]"
        : "mx-3 mb-3 rounded-lg bg-muted/45 p-3 sm:mx-4",
    )}>
      {validating && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>{t("task.stage.validate")}</span>
        </p>
      )}
      {validationFailed && (
        <div className="space-y-1.5">
          <p className={cn("text-xs text-destructive", featured && "text-red-200")}>{validateTask.message}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button variant={featured ? "ghost" : "outline"} size="xs" className={featured ? featuredButton : undefined} onClick={onRetryValidate}>
              {t("task.retryValidate")}
            </Button>
            <Button variant="destructive" size="xs" className={featured ? "bg-red-950/50 text-red-200 hover:bg-red-950/70" : undefined} onClick={onDelete}>
              {t("instances.delete")}
            </Button>
          </div>
        </div>
      )}
      {installing && <InstallTaskProgress task={installTask} />}
      {installFailed && (
        <p className={cn("text-xs text-destructive", featured && "text-red-200")}>{installTask.message}</p>
      )}
      {launching && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>
            {t(launchTask.stage)}
            {launchTask.pid != null && ` · ${launchTask.pid}`}
          </span>
        </p>
      )}
    </div>
  );

  const controls = (
    <>
      <Button
        variant={featured ? "default" : "ghost"}
        size={featured ? "lg" : "sm"}
        className={featured ? "px-4 sm:px-5" : undefined}
        onClick={installed ? onLaunch : onInstall}
        disabled={disabled || installing || validating || (installed && launching)}
      >
        <ActionIcon aria-hidden="true" />
        {t(installed ? "instances.launch" : "instances.install")}
      </Button>
      {featured && (
        <Button variant="ghost" size="lg" className={featuredButton} onClick={onOpenDetail}>
          {t("instances.detail")}
        </Button>
      )}
      {launchTask && (
        <Button
          variant="ghost"
          size={featured ? "icon-lg" : "icon-sm"}
          title={t("instances.log")}
          aria-label={t("instances.log")}
          className={featured ? featuredButton : undefined}
          onClick={onShowLog}
        >
          <ScrollText aria-hidden="true" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("instances.actions", { name: instance.name })}
          render={<Button variant="ghost" size={featured ? "icon-lg" : "icon-sm"} className={featured ? featuredButton : undefined} />}
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpenDetail}>
            {t("instances.detail")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenContent}>
            {t("instances.content")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onInstall} disabled={installing}>
            {t("instances.reinstall")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {t("instances.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  if (featured) {
    return (
      <article
        aria-labelledby={headingId}
        className="jmcl-feature flex min-h-60 min-w-0 flex-col justify-center gap-4 border sm:min-h-64"
      >
        {featuredBlockPreview ? (
          <img className="jmcl-feature-block jmcl-feature-block--preview" src={featuredBlockPreview} alt="" />
        ) : (
          <div className="jmcl-feature-block" aria-hidden="true">
            <span className="jmcl-feature-block-face jmcl-feature-block-face--top" />
            <span className="jmcl-feature-block-face jmcl-feature-block-face--left" />
            <span className="jmcl-feature-block-face jmcl-feature-block-face--right" />
          </div>
        )}
        <div className="min-w-0 max-w-2xl">
          {installed && <p className="mb-2 text-sm font-medium text-primary">{t("instances.featured")}</p>}
          <h2 id={headingId} className="text-[clamp(1.875rem,4vw,3.625rem)] leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">
            {instanceName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {gameVersion}
            {(statusError || !installed) && statusLabel}
          </div>
        </div>
        {activity}
        <div className="flex flex-wrap items-center gap-1.5">
          {controls}
        </div>
      </article>
    );
  }

  return (
    <article aria-labelledby={headingId} className="min-w-0 not-last:border-b">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 flex-[1_1_10rem] items-center gap-3">
          <loader.Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.65} aria-hidden="true" />
          <div className="min-w-0">
            <h3 id={headingId} className="text-sm font-semibold leading-snug">
              {instanceName}
            </h3>
            {gameVersion}
          </div>
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-1 sm:gap-x-2">
          {statusLabel}
          {controls}
        </div>
      </div>
      {activity}
    </article>
  );
}
