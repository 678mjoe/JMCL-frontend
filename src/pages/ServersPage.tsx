import { useEffect, useState } from "react";
import { Plus, RefreshCw, Server as ServerIcon } from "lucide-react";
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

  return (
    <div className="mx-auto min-w-0 max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
        <h1 className="text-2xl font-semibold">{t("servers.title")}</h1>
        <div className="max-w-full space-y-1">
          <label htmlFor="server-endpoint" className="text-sm font-medium">{t("servers.endpointLabel")}</label>
          <select
            id="server-endpoint"
            aria-label={t("servers.endpointLabel")}
            aria-describedby="server-endpoint-help"
            value={selectedEndpointId}
            disabled={endpointsLoading || !config}
            onChange={(event) => { selectEndpoint(event.currentTarget.value); }}
            className="block min-h-10 w-full max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-w-56 sm:max-w-sm"
          >
            {(config?.endpoints ?? []).map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.label}</option>)}
            {!config && <option value="local">{t("endpoint.local")}</option>}
          </select>
          <p id="server-endpoint-help" className="text-xs text-muted-foreground">{t("servers.endpointHelp")}</p>
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" title={t("servers.refresh")} onClick={() => void refreshList()} disabled={coreStatus !== "ready" || loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={coreStatus !== "ready" || !!listError || missingRemoteDirectory}>
            <Plus />{t("servers.new")}
          </Button>
        </div>
      </div>

      {missingRemoteDirectory ? (
        <section role="status" className="flex flex-col items-center gap-3 py-20 text-center">
          <ServerIcon className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("servers.remoteDirectoryRequired")}</p>
          <p className="max-w-lg text-sm text-muted-foreground">{t("servers.remoteDirectoryRequiredHint")}</p>
          <Button variant="outline" onClick={onOpenSettings}>{t("servers.openSettings")}</Button>
        </section>
      ) : coreStatus === "error" ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <ServerIcon className="size-10 text-destructive" />
          <p role="alert" className="text-sm font-medium">{t(endpointId === "local" ? "core.error" : safeCoreErrorKey)}</p>
          {endpointId === "local" && coreError && <p className="max-w-xl break-words text-sm text-muted-foreground">{coreError}</p>}
        </div>
      ) : listError ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <ServerIcon className="size-10 text-destructive" />
          <p className="text-sm font-medium">{t("servers.listError")}</p>
          {endpointId === "local"
            ? <p className="max-w-xl break-words text-sm text-muted-foreground">{listError}</p>
            : safeListErrorKey !== "servers.listError" && <p role="alert" className="max-w-xl break-words text-sm text-muted-foreground">{t(safeListErrorKey)}</p>}
          <Button variant="outline" onClick={() => void refreshList()}>{t("common.retry")}</Button>
        </div>
      ) : coreStatus === "starting" || loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("servers.loading")}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-3 rounded-xl border p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : manifests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <ServerIcon className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("servers.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("servers.emptyHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        </div>
      )}

      <CreateServerDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={created} />
    </div>
  );
}
