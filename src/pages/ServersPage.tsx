import { useState } from "react";
import { Plus, RefreshCw, Server as ServerIcon } from "lucide-react";
import { CreateServerDialog } from "@/components/CreateServerDialog";
import { ServerCard } from "@/components/ServerCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import type { ServerManifest } from "@/lib/types";

export interface ServersPageProps {
  onOpenDetail: (serverId: string) => void;
}

export function ServersPage({ onOpenDetail }: ServersPageProps) {
  const { t } = useSettings();
  const {
    manifests,
    cache,
    loading,
    listError,
    statusErrors,
    pendingStatus,
    directory,
    refreshList,
    refreshServerStatus,
    coreStatus,
    coreError,
  } = useServers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const scope = cache.scopes.local?.directory === directory ? cache.scopes.local : undefined;

  const created = (server: ServerManifest) => {
    setDialogOpen(false);
    onOpenDetail(server.id);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("servers.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" title={t("servers.refresh")} onClick={() => void refreshList()} disabled={coreStatus !== "ready" || loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={coreStatus !== "ready"}>
            <Plus />{t("servers.new")}
          </Button>
        </div>
      </div>

      {coreStatus === "error" ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <ServerIcon className="size-10 text-destructive" />
          <p className="text-sm font-medium">{t("core.error")}</p>
          {coreError && <p className="max-w-xl text-sm text-muted-foreground">{coreError}</p>}
        </div>
      ) : listError ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <ServerIcon className="size-10 text-destructive" />
          <p className="text-sm font-medium">{t("servers.listError")}</p>
          <p className="max-w-xl text-sm text-muted-foreground">{listError}</p>
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
              statusError={statusErrors[server.id]}
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
