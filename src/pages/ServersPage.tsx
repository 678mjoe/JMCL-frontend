import { useEffect, useState } from "react";
import { CircleAlert, Plus, RefreshCw, Server as ServerIcon } from "lucide-react";
import { CreateServerDialog } from "@/components/CreateServerDialog";
import { ServerCard } from "@/components/ServerCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import { useEndpointContext } from "@/lib/endpointContext";
import { safeServerErrorKey } from "@/lib/serverErrorPresentation";
import type { ServerManifest } from "@/lib/types";

export interface ServersPageProps {
  onOpenDetail: (serverId: string) => void;
  onOpenSettings: () => void;
}

export function ServersPage({ onOpenDetail, onOpenSettings }: ServersPageProps) {
  const { t, settings } = useSettings();
  const { config, selectedEndpoint, selectedEndpointId, selectEndpoint, loading: endpointsLoading } = useEndpointContext();
  const {
    manifests,
    cache,
    loading,
    listError,
    statusErrors,
    pendingStatus,
    directory,
    endpointId,
    refreshList,
    refreshServerStatus,
    coreStatus,
    coreError,
  } = useServers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const endpointDirectory = selectedEndpoint?.kind === "ssh" ? selectedEndpoint.serversDirectory : settings.serversDir;
  useEffect(() => { setDialogOpen(false); }, [selectedEndpointId, selectedEndpoint?.kind, endpointDirectory]);
  const selectedScope = cache.scopes[endpointId];
  const scope = selectedScope?.directory === directory ? selectedScope : undefined;

  const created = (server: ServerManifest) => {
    setDialogOpen(false);
    onOpenDetail(server.id);
  };
  const missingRemoteDirectory = selectedEndpoint?.kind === "ssh" && !selectedEndpoint.serversDirectory;
  const safeCoreErrorKey = safeServerErrorKey(coreError, endpointId === "local" ? "core.error" : "servers.connectionFailed");
  const safeListErrorKey = safeServerErrorKey(listError, "servers.listError");
  const localServerUnsupported = endpointId === "local" && listError?.startsWith("UNSUPPORTED_PLATFORM:");

  return (
    <div className="jmcl-page min-w-0">
      <header className="jmcl-page-header">
        <h1 className="jmcl-page-title">{t("servers.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title={t("servers.refresh")}
            onClick={() => void refreshList()}
            disabled={coreStatus !== "ready" || loading || !!localServerUnsupported}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={coreStatus !== "ready" || !!listError || missingRemoteDirectory}>
            <Plus />{t("servers.new")}
          </Button>
        </div>
      </header>

      <div className="jmcl-panel flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 sm:p-5">
        <div className="min-w-0 flex-[1_1_15rem]">
          <label htmlFor="server-endpoint" className="text-sm font-semibold">{t("servers.endpointLabel")}</label>
          <p id="server-endpoint-help" className="mt-1 text-sm text-muted-foreground">{t("servers.endpointHelp")}</p>
        </div>
        <div className="min-w-0 flex-[1_1_13rem] sm:max-w-xs">
          <select
            id="server-endpoint"
            aria-label={t("servers.endpointLabel")}
            aria-describedby="server-endpoint-help"
            value={selectedEndpointId}
            disabled={endpointsLoading || !config}
            onChange={(event) => { selectEndpoint(event.currentTarget.value); }}
            className="jmcl-field block h-9 w-full max-w-full truncate"
          >
            {(config?.endpoints ?? []).map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.label}</option>)}
            {!config && <option value="local">{t("endpoint.local")}</option>}
          </select>
        </div>
      </div>

      {missingRemoteDirectory ? (
        <section role="status" className="jmcl-panel jmcl-state">
          <ServerIcon className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("servers.remoteDirectoryRequired")}</h2>
          <p className="max-w-lg text-sm text-muted-foreground">{t("servers.remoteDirectoryRequiredHint")}</p>
          <Button variant="outline" onClick={onOpenSettings}>{t("servers.openSettings")}</Button>
        </section>
      ) : coreStatus === "error" ? (
        <div className="jmcl-panel jmcl-state">
          <CircleAlert className="size-6 text-destructive" />
          <h2 role="alert" className="text-base font-semibold">{t(endpointId === "local" ? "core.error" : safeCoreErrorKey)}</h2>
          {endpointId === "local" && coreError && <p className="max-w-xl break-words text-sm text-muted-foreground">{coreError}</p>}
        </div>
      ) : localServerUnsupported ? (
        <section role="status" className="jmcl-panel jmcl-state">
          <ServerIcon className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("servers.localUnsupportedPlatform")}</h2>
          <p className="max-w-lg text-sm text-muted-foreground">{t("servers.localUnsupportedPlatformHint")}</p>
          <Button variant="outline" onClick={onOpenSettings}>{t("servers.openSettings")}</Button>
        </section>
      ) : listError ? (
        <div className="jmcl-panel jmcl-state">
          <CircleAlert className="size-6 text-destructive" />
          <h2 className="text-base font-semibold">{t("servers.listError")}</h2>
          {endpointId === "local"
            ? <p className="max-w-xl break-words text-sm text-muted-foreground">{listError}</p>
            : safeListErrorKey !== "servers.listError" && <p role="alert" className="max-w-xl break-words text-sm text-muted-foreground">{t(safeListErrorKey)}</p>}
          <Button variant="outline" onClick={() => void refreshList()}>{t("common.retry")}</Button>
        </div>
      ) : coreStatus === "starting" || loading ? (
        <div className="jmcl-panel divide-y divide-border" role="status" aria-label={t("servers.loading")}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3 p-4 sm:p-5" aria-hidden="true">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="w-full max-w-56 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : manifests.length === 0 ? (
        <div className="jmcl-panel jmcl-state">
          <ServerIcon className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("servers.empty")}</h2>
          <p className="text-sm text-muted-foreground">{t("servers.emptyHint")}</p>
        </div>
      ) : (
        <ul className="jmcl-panel @container/server-list divide-y divide-border" aria-label={t("servers.title")}>
          {manifests.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              cachedStatus={scope?.servers[server.id]}
              pending={pendingStatus.has(server.id)}
              statusError={statusErrors[server.id]
                ? endpointId === "local" ? statusErrors[server.id] : t(safeServerErrorKey(statusErrors[server.id], "servers.statusRefreshFailed"))
                : undefined}
              onRefreshStatus={() => void refreshServerStatus(server.id)}
              onOpen={() => onOpenDetail(server.id)}
            />
          ))}
        </ul>
      )}

      <CreateServerDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={created} />
    </div>
  );
}
