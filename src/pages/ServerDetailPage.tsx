import { useState } from "react";
import { ArrowLeft, Play, RefreshCw, RotateCcw, Server as ServerIcon, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerInstallDialog } from "@/components/ServerInstallDialog";
import { DeleteServerDialog } from "@/components/DeleteServerDialog";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import { deriveServerState } from "@/lib/serverState";
import { useServerOperations } from "@/lib/serverOperations";
import { serverLoaderName } from "@/lib/serverPresentation";
import { useServerUptime } from "@/lib/serverUptime";

export interface ServerDetailPageProps { serverId: string; onBack: () => void }

export function ServerDetailPage({ serverId, onBack }: ServerDetailPageProps) {
  const [installOpen, setInstallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { t, settings } = useSettings();
  const { manifests, cache, loading, listError, statusErrors, pendingStatus, directory, refreshServerStatus, coreStatus, coreError } = useServers();
  const { operationFor, start, stop, restart } = useServerOperations();
  const server = manifests.find((item) => item.id === serverId);
  const cached = cache.scopes.local?.directory === directory ? cache.scopes.local.servers[serverId] : undefined;
  const isDisplayingServer = coreStatus !== "error" && !listError && !loading && coreStatus !== "starting" && Boolean(server);
  const uptimeMs = useServerUptime(isDisplayingServer && cached?.state === "running", cached?.started_at_ms, serverId);
  if (coreStatus === "error") return <DetailMessage icon="error" title={t("core.error")} description={coreError ?? ""} backLabel={t("servers.back")} onBack={onBack} />;
  if (listError) return <DetailMessage icon="error" title={t("servers.listError")} description={listError} backLabel={t("servers.back")} onBack={onBack} />;
  if (loading || coreStatus === "starting") return <DetailMessage icon="loading" title={t("common.loading")} description="" backLabel={t("servers.back")} onBack={onBack} />;
  if (!server) return <DetailMessage icon="error" title={t("servers.notFound")} description={t("servers.notFoundHint")} backLabel={t("servers.back")} onBack={onBack} />;

  const operation = operationFor(server.id);
  const busy = operation?.pending === true;
  const derived = deriveServerState({
    manifest: server,
    status: cached?.state === "running" || cached?.state === "stopped" ? { running: cached.state === "running", stale_state: false } : null,
    hasLogs: false,
    hasProperties: false,
    hasLoaderManifest: Boolean(server.fabric_loader || server.neoforge_version || server.forge_version),
  });
  const label = cached?.state === "running" ? t("servers.lastKnownRunning") : cached?.state === "stopped" ? t("servers.lastKnownStopped") : cached?.state === "created" ? t("servers.localCreated") : t("servers.unknown");
  const time = cached?.checked_at_ms ? new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" }).format(cached.checked_at_ms) : null;
  const sourceLabel = server.source === "bmclapi" ? t("settings.source.bmclapi") : t("settings.source.official");
  const startedAt = cached?.started_at_ms;
  const uptime = uptimeMs === null ? null : `${Math.floor(uptimeMs / 3600000)}:${String(Math.floor(uptimeMs / 60000) % 60).padStart(2, "0")}:${String(Math.floor(uptimeMs / 1000) % 60).padStart(2, "0")}`;
  const run = (action: () => Promise<boolean>) => { void action().catch(() => undefined); };
  const timestamp = (value: number) => new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" }).format(value);

  return <div className="mx-auto max-w-3xl p-6">
    <Button variant="ghost" onClick={onBack}><ArrowLeft />{t("servers.back")}</Button>
    <div className="mt-6 flex items-center gap-3"><ServerIcon className="size-8 text-muted-foreground" /><div><h1 className="text-2xl font-semibold">{server.name}</h1><p className="font-mono text-sm text-muted-foreground">{server.id}</p></div></div>
    <div className="mt-6 grid gap-4 rounded-xl border p-6 sm:grid-cols-2">
      <Info label={t("servers.id")} value={server.id} /><Info label={t("servers.minecraftVersion")} value={server.version_id} />
      <Info label={t("servers.loader")} value={serverLoaderName(server, t("servers.loaderNone"))} /><Info label={t("servers.installed")} value={server.installed ? t("servers.installed") : t("servers.notInstalled")} />
      <Info label={t("servers.source")} value={sourceLabel} /><Info label={t("servers.lastKnown")} value={label} />
      <Info label={t("servers.lastChecked")} value={time ?? t("servers.noStatusRecorded")} />
      {cached?.state === "running" && cached.pid !== null && <Info label={t("serverDetail.pid")} value={String(cached.pid)} />}
      {cached?.state === "running" && cached.java_path && <Info label={t("serverDetail.javaPath")} value={cached.java_path} />}
      {cached?.state === "running" && startedAt !== null && startedAt !== undefined && <Info label={t("serverDetail.startedAt")} value={timestamp(startedAt)} />}
      {uptime !== null && <Info label={t("serverDetail.uptime")} value={uptime} />}
    </div>
    {cached?.last_stale_cleanup_at_ms !== null && cached?.last_stale_cleanup_at_ms !== undefined && <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("serverDetail.staleCleanup", { time: timestamp(cached.last_stale_cleanup_at_ms) })}</p>}
    {statusErrors[server.id] && <p className="mt-4 text-sm text-destructive">{statusErrors[server.id]}</p>}
    {operation?.error && <p role="alert" className="mt-4 text-sm text-destructive">{operation.error}</p>}
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={pendingStatus.has(server.id) || busy || !derived.capabilities.refreshStatus} onClick={() => void refreshServerStatus(server.id)}><RefreshCw className={pendingStatus.has(server.id) ? "animate-spin" : undefined} />{pendingStatus.has(server.id) ? t("servers.refreshingStatus") : t("servers.refreshStatus")}</Button>
      {derived.capabilities.installRepair && <Button disabled={busy} onClick={() => setInstallOpen(true)}>{t(server.installed ? "serverInstall.repair" : "serverInstall.install")}</Button>}
      {derived.capabilities.start && <Button disabled={busy} onClick={() => run(() => start(server))}><Play />{t("serverLifecycle.start")}</Button>}
      {derived.capabilities.stop && <Button variant="outline" disabled={busy} onClick={() => run(() => stop(server))}><Square />{t("serverLifecycle.stop")}</Button>}
      {derived.capabilities.restart && <Button variant="outline" disabled={busy} onClick={() => run(() => restart(server))}><RotateCcw />{t("serverLifecycle.restart")}</Button>}
      {derived.capabilities.delete && <Button variant="destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 />{t("servers.delete")}</Button>}
    </div>
    {busy && <p className="mt-3 text-sm text-muted-foreground">{t(operation?.stage === "finishing" ? "serverInstall.finishing" : "serverLifecycle.pending")}</p>}
    <ServerInstallDialog open={installOpen} onOpenChange={setInstallOpen} server={server} />
    <DeleteServerDialog open={deleteOpen} onOpenChange={setDeleteOpen} server={server} onDeleted={onBack} />
  </div>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-words">{value}</div></div>; }
function DetailMessage({ icon, title, description, backLabel, onBack }: { icon: "error" | "loading"; title: string; description: string; backLabel: string; onBack: () => void }) {
  return <div className="mx-auto max-w-3xl p-6"><Button variant="ghost" onClick={onBack}><ArrowLeft />{backLabel}</Button><div className="flex flex-col items-center gap-2 py-24 text-center"><ServerIcon className={icon === "error" ? "size-10 text-destructive" : "size-10 animate-pulse text-muted-foreground"} /><p className="text-sm font-medium">{title}</p>{description && <p className="max-w-xl text-sm text-muted-foreground">{description}</p>}</div></div>;
}
