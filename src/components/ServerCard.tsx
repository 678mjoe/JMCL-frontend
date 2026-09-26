import { RefreshCw, Server as ServerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/lib/settings";
import { serverLoaderName } from "@/lib/serverPresentation";
import type { CachedServerStatus } from "@/lib/serverStatusCache";
import type { ServerManifest } from "@/lib/types";

export interface ServerCardProps {
  server: ServerManifest;
  cachedStatus?: CachedServerStatus;
  pending: boolean;
  statusError?: string;
  onRefreshStatus: () => void;
  onOpen: () => void;
}

export function ServerCard({
  server,
  cachedStatus,
  pending,
  statusError,
  onRefreshStatus,
  onOpen,
}: ServerCardProps) {
  const { t, settings } = useSettings();
  const timestamp = cachedStatus?.checked_at_ms
    ? new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" })
        .format(cachedStatus.checked_at_ms)
    : null;
  const lifecycle = cachedStatus?.state === "running"
    ? t("servers.lastKnownRunning")
    : cachedStatus?.state === "stopped"
      ? t("servers.lastKnownStopped")
      : cachedStatus?.state === "created"
        ? t("servers.localCreated")
        : t("servers.unknown");
  const sourceLabel = server.source === "bmclapi"
    ? t("settings.source.bmclapi")
    : t("settings.source.official");
  const statusDetail = cachedStatus?.state === "running" || cachedStatus?.state === "stopped"
    ? timestamp ? `${t("servers.lastChecked")}: ${timestamp}` : t("servers.lastKnown")
    : cachedStatus?.state === "created"
      ? timestamp ? `${t("servers.cacheTime")}: ${timestamp}` : t("servers.localCreated")
      : t("servers.noStatusRecorded");

  return (
    <Card className="cursor-pointer transition-colors hover:ring-foreground/25" onClick={onOpen}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <button className="flex min-w-0 items-center gap-2 text-left" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          <ServerIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <CardTitle className="truncate">{server.name}</CardTitle>
            <span className="block truncate font-mono text-xs text-muted-foreground">{server.id}</span>
          </span>
        </button>
        <Badge variant={server.installed ? "default" : "outline"}>
          {server.installed ? t("servers.installed") : t("servers.notInstalled")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">{t("servers.minecraftVersion")}</div>
            <div>{server.version_id}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("servers.loader")}</div>
            <div>{serverLoaderName(server, t("servers.loaderNone"))}</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{sourceLabel}</div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <div>{lifecycle}</div>
          <div className="text-xs text-muted-foreground">{statusDetail}</div>
        </div>
        {statusError && <p className="text-xs text-destructive">{statusError}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onRefreshStatus();
          }}
          disabled={pending}
        >
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          {pending ? t("servers.refreshingStatus") : t("servers.refreshStatus")}
        </Button>
      </CardContent>
    </Card>
  );
}
