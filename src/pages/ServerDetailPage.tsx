import { useServerTargetBusy } from "@/lib/serverTargetLock";
import { ServerContentPanel } from "@/components/ServerContentPanel";
import { ServerWorldsPanel } from "@/components/ServerWorldsPanel";
import { ServerAdvancedPanel } from "@/components/ServerAdvancedPanel";
import { useState } from "react";
import { ArrowLeft, CircleAlert, Play, RefreshCw, RotateCcw, Server as ServerIcon, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerInstallDialog } from "@/components/ServerInstallDialog";
import { DeleteServerDialog } from "@/components/DeleteServerDialog";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import { deriveServerState } from "@/lib/serverState";
import { useServerOperations } from "@/lib/serverOperations";
import { serverLoaderName } from "@/lib/serverPresentation";
import { safeServerErrorKey, safeServerOperationError } from "@/lib/serverErrorPresentation";
import { useServerUptime } from "@/lib/serverUptime";
import { ServerConsolePanel } from "@/components/ServerConsolePanel";

export interface ServerDetailPageProps { serverId: string; onBack: () => void }

export function ServerDetailPage({ serverId, onBack }: ServerDetailPageProps) {
  const [installOpen, setInstallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { t, settings } = useSettings();
  const { manifests, cache, loading, listError, statusErrors, pendingStatus, directory, endpointId, refreshServerStatus, coreStatus, coreError, captureOperationScope } = useServers();
  const { operationFor, start, stop, restart } = useServerOperations();
  const targetBusy = useServerTargetBusy(captureOperationScope(), serverId);
  const server = manifests.find((item) => item.id === serverId);
  const selectedScope = cache.scopes[endpointId];
  const cached = selectedScope?.directory === directory ? selectedScope.servers[serverId] : undefined;
  const isDisplayingServer = coreStatus !== "error" && !listError && !loading && coreStatus !== "starting" && Boolean(server);
  const uptimeMs = useServerUptime(isDisplayingServer && cached?.state === "running", cached?.started_at_ms, serverId);
  if (coreStatus === "error") return <DetailMessage icon="error" title={t("core.error")} description={endpointId === "local" ? coreError ?? "" : t(safeServerErrorKey(coreError, "servers.connectionFailed"))} backLabel={t("servers.back")} onBack={onBack} />;
  if (listError) return <DetailMessage icon="error" title={t("servers.listError")} description={endpointId === "local" ? listError : t(safeServerErrorKey(listError, "servers.listError"))} backLabel={t("servers.back")} onBack={onBack} />;
  if (loading || coreStatus === "starting") return <DetailMessage icon="loading" title={t("common.loading")} description="" backLabel={t("servers.back")} onBack={onBack} />;
  if (!server) return <DetailMessage icon="error" title={t("servers.notFound")} description={t("servers.notFoundHint")} backLabel={t("servers.back")} onBack={onBack} />;

  const operation = operationFor(server.id);
  const busy = operation?.pending === true || targetBusy;
  const derived = deriveServerState({
    manifest: server,
    status: cached?.state === "running" || cached?.state === "stopped" ? { running: cached.state === "running", stale_state: false } : null,
    hasLogs: false,
    hasProperties: false,
    hasLoaderManifest: Boolean(server.fabric_loader || server.neoforge_version || server.forge_version),
  });
  const label = cached?.state === "running" ? t("servers.lastKnownRunning") : cached?.state === "stopped" ? t("servers.lastKnownStopped") : cached?.state === "created" ? t("servers.localCreated") : t("servers.unknown");
  const timestamp = (value: number) => new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" }).format(value);
  const time = cached?.checked_at_ms ? timestamp(cached.checked_at_ms) : null;
  const sourceLabel = server.source === "bmclapi" ? t("settings.source.bmclapi") : t("settings.source.official");
  const startedAt = cached?.started_at_ms;
  const uptime = uptimeMs === null ? null : `${Math.floor(uptimeMs / 3600000)}:${String(Math.floor(uptimeMs / 60000) % 60).padStart(2, "0")}:${String(Math.floor(uptimeMs / 1000) % 60).padStart(2, "0")}`;
  const run = (action: () => Promise<boolean>) => { void action().catch(() => undefined); };
  const knownLifecycle = server.installed && (cached?.state === "stopped" || cached?.state === "running");
  const serverState = cached?.state === "running" || cached?.state === "stopped" ? cached.state : "unknown";
  const checking = pendingStatus.has(server.id);

  return (
    <div className="jmcl-page min-w-0">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="jmcl-back" onClick={onBack}>
          <ArrowLeft />{t("servers.back")}
        </Button>
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground sm:size-12">
            <ServerIcon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="jmcl-page-title">{server.name}</h1>
            <p className="jmcl-page-description font-mono"><span className="sr-only">{t("servers.id")} </span>{server.id}</p>
          </div>
        </div>
      </header>

      <section className="jmcl-panel @container/server-status divide-y divide-border" aria-label={t("servers.status")}>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("servers.lastKnown")}</p>
            <p className="mt-1 flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className={serverState === "running" ? "size-2 shrink-0 rounded-full bg-[var(--jmcl-online)]" : "size-2 shrink-0 rounded-full bg-muted-foreground/50"} />
              {label}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{time ? `${t("servers.lastChecked")}: ${time}` : t("servers.noStatusRecorded")}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {derived.capabilities.installRepair && <Button disabled={busy} onClick={() => setInstallOpen(true)}>{t(server.installed ? "serverInstall.repair" : "serverInstall.install")}</Button>}
            {derived.capabilities.start && <Button disabled={busy} onClick={() => run(() => start(server))}><Play />{t("serverLifecycle.start")}</Button>}
            {derived.capabilities.stop && <Button variant="outline" disabled={busy} onClick={() => run(() => stop(server))}><Square />{t("serverLifecycle.stop")}</Button>}
            {derived.capabilities.restart && <Button variant="outline" disabled={busy} onClick={() => run(() => restart(server))}><RotateCcw />{t("serverLifecycle.restart")}</Button>}
            <Button
              variant="outline"
              disabled={checking || busy || !derived.capabilities.refreshStatus}
              onClick={() => void refreshServerStatus(server.id)}
            >
              <RefreshCw className={checking ? "animate-spin" : undefined} />
              {checking ? t("servers.refreshingStatus") : t("servers.refreshStatus")}
            </Button>
            {derived.capabilities.delete && <Button variant="destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 />{t("servers.delete")}</Button>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:p-5 @xl/server-status:grid-cols-4">
          <Info label={t("servers.minecraftVersion")} value={server.version_id} />
          <Info label={t("servers.loader")} value={serverLoaderName(server, t("servers.loaderNone"))} />
          <Info label={t("servers.status")} value={server.installed ? t("servers.installed") : t("servers.notInstalled")} />
          <Info label={t("servers.source")} value={sourceLabel} />
          {cached?.state === "running" && cached.pid !== null && <Info label={t("serverDetail.pid")} value={String(cached.pid)} />}
          {cached?.state === "running" && cached.java_path && <Info label={t("serverDetail.javaPath")} value={cached.java_path} />}
          {cached?.state === "running" && startedAt !== null && startedAt !== undefined && <Info label={t("serverDetail.startedAt")} value={timestamp(startedAt)} />}
          {uptime !== null && <Info label={t("serverDetail.uptime")} value={uptime} />}
        </dl>
        {cached?.last_stale_cleanup_at_ms !== null && cached?.last_stale_cleanup_at_ms !== undefined && (
          <p className="border-amber-500/40 bg-amber-500/10 p-4 text-sm last:rounded-b-[inherit] sm:px-5">
            {t("serverDetail.staleCleanup", { time: timestamp(cached.last_stale_cleanup_at_ms) })}
          </p>
        )}
        {statusErrors[server.id] && (
          <p role="alert" className="wrap-anywhere px-4 py-3 text-sm text-destructive sm:px-5">
            {endpointId === "local" ? statusErrors[server.id] : t(safeServerErrorKey(statusErrors[server.id], "servers.statusRefreshFailed"))}
          </p>
        )}
        {operation?.error && <p role="alert" className="wrap-anywhere px-4 py-3 text-sm text-destructive sm:px-5">{safeServerOperationError(operation.error, endpointId, t)}</p>}
        {busy && <p role="status" className="px-4 py-3 text-sm text-muted-foreground sm:px-5">{t(operation?.stage === "finishing" ? "serverInstall.finishing" : "serverLifecycle.pending")}</p>}
      </section>

      {knownLifecycle && <ServerConsolePanel server={server} running={cached.state === "running"} />}
      <ServerAdvancedPanel server={server} state={serverState} />
      <ServerWorldsPanel server={server} state={serverState} />
      <ServerContentPanel server={server} state={serverState} />
      <ServerInstallDialog open={installOpen} onOpenChange={setInstallOpen} server={server} />
      <DeleteServerDialog open={deleteOpen} onOpenChange={setDeleteOpen} server={server} onDeleted={onBack} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 wrap-anywhere text-sm font-medium">{value}</dd>
    </div>
  );
}

function DetailMessage({ icon, title, description, backLabel, onBack }: { icon: "error" | "loading"; title: string; description: string; backLabel: string; onBack: () => void }) {
  return (
    <div className="jmcl-page min-w-0">
      <Button variant="ghost" size="sm" className="jmcl-back" onClick={onBack}><ArrowLeft />{backLabel}</Button>
      <section className="jmcl-panel jmcl-state" role={icon === "error" ? "alert" : "status"}>
        {icon === "error" ? <CircleAlert className="size-6 text-destructive" /> : <ServerIcon className="size-6 animate-pulse text-muted-foreground" />}
        <h1 className="text-base font-semibold">{title}</h1>
        {description && <p className="max-w-xl wrap-anywhere text-sm text-muted-foreground">{description}</p>}
      </section>
    </div>
  );
}
