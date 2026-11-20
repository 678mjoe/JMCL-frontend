import { RefreshCw, Server as ServerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <li className="min-w-0 cursor-pointer px-4 py-4 transition-colors first:rounded-t-[inherit] last:rounded-b-[inherit] hover:bg-muted/40 sm:px-5" onClick={onOpen}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 @xl/server-list:grid-cols-[minmax(0,1fr)_minmax(10rem,0.6fr)_auto]">
        <div className="col-span-2 min-w-0 @xl/server-list:col-span-1">
          <button
            type="button"
            className="flex max-w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => { event.stopPropagation(); onOpen(); }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <ServerIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 wrap-anywhere">
              <span className="block text-sm font-semibold">{server.name}</span>
              <span className="block font-mono text-xs text-muted-foreground">{server.id}</span>
            </span>
          </button>
          <dl className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 ps-12 text-xs text-muted-foreground">
            <div>
              <dt className="sr-only">{t("servers.minecraftVersion")}</dt>
              <dd className="wrap-anywhere">{server.version_id}</dd>
            </div>
            <div>
              <dt className="sr-only">{t("servers.loader")}</dt>
              <dd className="wrap-anywhere">{serverLoaderName(server, t("servers.loaderNone"))}</dd>
            </div>
            <div>
              <dt className="sr-only">{t("servers.source")}</dt>
              <dd>{sourceLabel}</dd>
            </div>
            <div>
              <dt className="sr-only">{t("servers.status")}</dt>
              <dd>
                <Badge variant={server.installed ? "secondary" : "outline"}>
                  {server.installed ? t("servers.installed") : t("servers.notInstalled")}
                </Badge>
              </dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0 wrap-anywhere text-sm">
          <div className="flex items-start gap-2 font-medium">
            <span aria-hidden="true" className={cachedStatus?.state === "running" ? "mt-1.5 size-2 shrink-0 rounded-full bg-[var(--jmcl-online)]" : "mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50"} />
            <div className="min-w-0">
              <div>{lifecycle}</div>
              <div className="mt-0.5 text-xs font-normal text-muted-foreground tabular-nums">{statusDetail}</div>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-end"
          onClick={(event) => {
            event.stopPropagation();
            onRefreshStatus();
          }}
          disabled={pending}
        >
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          {pending ? t("servers.refreshingStatus") : t("servers.refreshStatus")}
        </Button>
      </div>
      {statusError && <p className="mt-3 wrap-anywhere text-xs text-destructive">{statusError}</p>}
    </li>
  );
}
