import { Loader2, MoreVertical, Play, ScrollText } from "lucide-react";
import { InstallTaskProgress } from "@/components/InstallTaskProgress";
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
import { useSettings } from "@/lib/settings";
import type { Task } from "@/lib/tasks";
import type { InstanceManifest } from "@/lib/types";

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
  onOpenDetail: () => void;
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
  onOpenDetail,
}: InstanceCardProps) {
  const { t } = useSettings();

  const installing = installTask?.status === "running";
  const launching = launchTask?.status === "running";

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

      <CardContent className="min-h-12 space-y-3">
        {installTask?.status === "running" && installTask && (
          <InstallTaskProgress task={installTask} />
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
            <DropdownMenuItem onClick={onOpenDetail}>
              {t("instances.detail")}
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
      </CardFooter>
    </Card>
  );
}
