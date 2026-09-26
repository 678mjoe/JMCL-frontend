import { ArrowLeft, RefreshCw, Server as ServerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import { serverLoaderName } from "@/lib/serverPresentation";

export interface ServerDetailPageProps {
  serverId: string;
  onBack: () => void;
}

export function ServerDetailPage({ serverId, onBack }: ServerDetailPageProps) {
  const { t, settings } = useSettings();
  const {
    manifests,
    cache,
    loading,
    listError,
    statusErrors,
    pendingStatus,
    directory,
    refreshServerStatus,
    coreStatus,
    coreError,
  } = useServers();
  const server = manifests.find((item) => item.id === serverId);
  const cached = cache.scopes.local?.directory === directory
    ? cache.scopes.local.servers[serverId]
    : undefined;

  if (coreStatus === "error") {
    return <DetailMessage icon="error" title={t("core.error")} description={coreError ?? ""} backLabel={t("servers.back")} onBack={onBack} />;
  }
  if (listError) {
    return <DetailMessage icon="error" title={t("servers.listError")} description={listError} backLabel={t("servers.back")} onBack={onBack} />;
  }
  if (loading || coreStatus === "starting") {
    return <DetailMessage icon="loading" title={t("common.loading")} description="" backLabel={t("servers.back")} onBack={onBack} />;
  }
  if (!server) {
    return <DetailMessage icon="error" title={t("servers.notFound")} description={t("servers.notFoundHint")} backLabel={t("servers.back")} onBack={onBack} />;
  }

  const lifecycle = cached?.state === "running"
    ? t("servers.lastKnownRunning")
    : cached?.state === "stopped"
      ? t("servers.lastKnownStopped")
      : cached?.state === "created"
        ? t("servers.localCreated")
        : t("servers.unknown");
  const timestamp = cached?.checked_at_ms
    ? new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" }).format(cached.checked_at_ms)
    : null;
  const confirmedStatus = cached?.state === "running" || cached?.state === "stopped";
  const locallyCreated = cached?.state === "created";
  const sourceLabel = server.source === "bmclapi"
    ? t("settings.source.bmclapi")
    : t("settings.source.official");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Button variant="ghost" onClick={onBack}><ArrowLeft />{t("servers.back")}</Button>
      <div className="mt-6 flex items-center gap-3">
        <ServerIcon className="size-8 text-muted-foreground" />
        <div><h1 className="text-2xl font-semibold">{server.name}</h1><p className="font-mono text-sm text-muted-foreground">{server.id}</p></div>
      </div>
      <div className="mt-6 grid gap-4 rounded-xl border p-6 sm:grid-cols-2">
        <Info label={t("servers.id")} value={server.id} />
        <Info label={t("servers.minecraftVersion")} value={server.version_id} />
        <Info label={t("servers.loader")} value={serverLoaderName(server, t("servers.loaderNone"))} />
        <Info label={t("servers.installed")} value={server.installed ? t("servers.installed") : t("servers.notInstalled")} />
        <Info label={t("servers.source")} value={sourceLabel} />
        <Info label={confirmedStatus ? t("servers.lastKnown") : locallyCreated ? t("servers.localCreated") : t("servers.status")} value={lifecycle} />
        <Info
          label={confirmedStatus ? t("servers.lastChecked") : locallyCreated ? t("servers.cacheTime") : t("servers.statusRecord")}
          value={confirmedStatus || locallyCreated ? timestamp ?? t("servers.noStatusRecorded") : t("servers.noStatusRecorded")}
        />
      </div>
      {statusErrors[server.id] && <p className="mt-4 text-sm text-destructive">{statusErrors[server.id]}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={pendingStatus.has(server.id)} onClick={() => void refreshServerStatus(server.id)}>
          <RefreshCw className={pendingStatus.has(server.id) ? "animate-spin" : undefined} />
          {pendingStatus.has(server.id) ? t("servers.refreshingStatus") : t("servers.refreshStatus")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("servers.lifecycleNextBatch")}</p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-words">{value}</div></div>;
}

function DetailMessage({ icon, title, description, backLabel, onBack }: { icon: "error" | "loading"; title: string; description: string; backLabel: string; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Button variant="ghost" onClick={onBack}><ArrowLeft />{backLabel}</Button>
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <ServerIcon className={icon === "error" ? "size-10 text-destructive" : "size-10 animate-pulse text-muted-foreground"} />
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="max-w-xl text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
