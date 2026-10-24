import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useServers } from "@/lib/servers";
import { useServerWorlds } from "@/lib/serverWorlds";
import { safeServerErrorKey } from "@/lib/serverErrorPresentation";
import type { MessageKey } from "@/lib/i18n";
import type { ServerManifest } from "@/lib/types";

type Props = { server: ServerManifest; state: "running" | "stopped" | "unknown" };
type Action = { kind: "rename" | "delete" | "restore"; name: string };
const fieldClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60";

export function ServerWorldsPanel(props: Props) {
  const scope = useServers().captureOperationScope();
  return <ScopedPanel key={JSON.stringify([props.server.id, scope])} {...props} />;
}
function ScopedPanel(props: Props) {
  const { t } = useSettings();
  const [shown, setShown] = useState(false);
  return <section className="mt-6 rounded-xl border p-5" aria-label={t("serverWorlds.title")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{t("serverWorlds.title")}</h2><p className="text-sm text-muted-foreground">{t("serverWorlds.scope")}</p></div>
      <Button variant="outline" onClick={() => setShown(!shown)}>{t(shown ? "serverWorlds.close" : "serverWorlds.open")}</Button>
    </div>
    {shown && <WorldControls {...props} />}
  </section>;
}
function WorldControls({ server, state }: Props) {
  const { t, settings } = useSettings();
  const { snapshot, load, get, rename, deleteWorld, backup, restore, cancel } = useServerWorlds(server);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [newName, setNewName] = useState("");
  const [replace, setReplace] = useState(false);
  const [label, setLabel] = useState("");
  const [done, setDone] = useState(false);
  const pending = snapshot.pending;
  const stopped = state === "stopped" && snapshot.status?.running === false;
  const clear = () => { setAction(null); setConfirmation(""); setNewName(""); setReplace(false); setDone(false); };
  const choose = (next: Action) => { clear(); setAction(next); };
  const discard = () => { clear(); setLabel(""); cancel(); };
  const submit = async () => {
    if (!action || pending || !stopped || confirmation !== action.name) return;
    const ok = action.kind === "rename" ? await rename(action.name, newName, confirmation) : action.kind === "delete" ? await deleteWorld(action.name, confirmation) : await restore(action.name, replace, confirmation);
    if (ok) { clear(); setDone(true); }
  };
  const errors: Record<string, MessageKey> = {
    BUSY: "serverAdvanced.busy", SERVER_ALREADY_RUNNING: "serverWorlds.stoppedOnly", SERVER_STATUS_FAILED: "serverAdvanced.unknownState",
    SERVER_NOT_FOUND: "servers.notFoundHint", WORLD_NOT_FOUND: "serverWorlds.notFound", BACKUP_NOT_FOUND: "serverWorlds.backupMissing",
    WORLD_EXISTS: "serverWorlds.exists", WORLD_LOCKED: "serverWorlds.lockedError", INVALID_PARAMS: "serverWorlds.invalid",
    INVALID_WORLD_NAME: "serverWorlds.invalid", SERVER_PROPERTIES_NOT_FOUND: "serverAdvanced.propertiesMissing", SERVER_PROPERTIES_INVALID: "serverAdvanced.propertiesInvalid",
  };
  const error = (code: string) => t(errors[code] ?? safeServerErrorKey(code, "serverWorlds.failed"));
  const timestamp = (value: number | null) => value === null || !Number.isFinite(value) || Number.isNaN(new Date(value).getTime()) ? t("serverWorlds.unknown") : new Intl.DateTimeFormat(settings.language, { dateStyle: "medium", timeStyle: "short" }).format(value);
  const metadata = snapshot.detail?.world;
  return <div className="mt-5 space-y-5">
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || action !== null} onClick={() => { setDone(false); void load(); }}>{t("serverWorlds.load")}</Button><Button variant="outline" onClick={discard}>{t("serverWorlds.cancel")}</Button></div>
    {pending && <p role="status" className="text-sm text-muted-foreground">{t("serverWorlds.pending")}</p>}
    {snapshot.error && <p role="alert" className="text-sm text-destructive">{error(snapshot.error)}</p>}
    {snapshot.refreshError && <p role="alert" className="text-sm text-destructive">{t("serverWorlds.refreshFailed")} {error(snapshot.refreshError)}</p>}
    {done && <p role="status" className="text-sm">{t("serverWorlds.done")}</p>}
    {!stopped && <p className="text-sm text-muted-foreground">{t("serverWorlds.stoppedOnly")}</p>}
    <p className="text-sm">{t("serverWorlds.base")}: <span className="break-all font-mono">{snapshot.baseWorld ?? t("serverWorlds.unknown")}</span></p>
    {snapshot.worlds && <div className="space-y-2">{snapshot.worlds.length === 0 && <p className="text-sm text-muted-foreground">{t("serverWorlds.empty")}</p>}{snapshot.worlds.map((world) => <article key={world.name} className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h3 className="break-all font-mono text-sm font-medium">{world.name}</h3><p className="text-xs text-muted-foreground">{world.name === snapshot.baseWorld ? t("serverWorlds.base") : t("serverWorlds.dimension")} · {world.size_bytes.toLocaleString(settings.language)} {t("serverWorlds.bytes")} · {world.locked ? t("serverWorlds.locked") : t("serverWorlds.unlocked")}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || action !== null} onClick={() => void get(world.name)}>{t("serverWorlds.details")}</Button><Button variant="outline" disabled={pending || !stopped || world.locked} onClick={() => choose({ kind: "rename", name: world.name })}>{t("serverWorlds.rename")}</Button><Button variant="destructive" disabled={pending || !stopped || world.locked} onClick={() => choose({ kind: "delete", name: world.name })}>{t("serverWorlds.delete")}</Button></div></div>
    </article>)}</div>}
    {metadata && <section className="rounded-lg bg-muted/40 p-3" aria-label={t("serverWorlds.details")}><h3 className="mb-3 break-all font-medium">{metadata.name}</h3>
      {snapshot.detail?.icon_png_base64 && <img className="mb-3 size-16 rounded-md" src={`data:image/png;base64,${snapshot.detail.icon_png_base64}`} alt={t("serverWorlds.icon")} />}
      <dl className="grid gap-3 sm:grid-cols-2">{(["level_name", "version_name", "version_id", "game_mode", "hardcore", "cheats", "difficulty", "size_bytes", "version_relation"] as const).map((key) => <div key={key}><dt className="font-mono text-xs text-muted-foreground">{key}</dt><dd className="break-all text-sm">{metadata[key] === null ? t("serverWorlds.unknown") : typeof metadata[key] === "boolean" ? t(metadata[key] ? "serverWorlds.yes" : "serverWorlds.no") : String(metadata[key])}</dd></div>)}<div><dt className="text-xs text-muted-foreground">{t("serverWorlds.lastPlayed")}</dt><dd className="text-sm">{timestamp(metadata.last_played_ms)}</dd></div></dl>
    </section>}
    <section className="space-y-3" aria-label={t("serverWorlds.backups")}><h3 className="font-medium">{t("serverWorlds.backups")}</h3><p className="text-sm text-muted-foreground">{t("serverWorlds.backupHint")}</p>
      <div className="flex flex-wrap gap-2"><input aria-label={t("serverWorlds.label")} placeholder={t("serverWorlds.label")} className={`${fieldClass} flex-1`} value={label} disabled={pending || !stopped || action !== null} onChange={(event) => setLabel(event.target.value)} /><Button disabled={pending || !stopped || action !== null} onClick={() => { setDone(false); void backup(label || undefined).then((ok) => { if (ok) { setLabel(""); setDone(true); } }); }}>{t("serverWorlds.backup")}</Button></div>
      {snapshot.backups?.length === 0 && <p className="text-sm text-muted-foreground">{t("serverWorlds.noBackups")}</p>}
      {snapshot.backups?.map((entry) => <div key={entry.file} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div className="min-w-0"><p className="break-all font-mono text-sm">{entry.file}</p><p className="text-xs text-muted-foreground">{timestamp(entry.created_ms)} · {entry.size_bytes.toLocaleString(settings.language)} {t("serverWorlds.bytes")} · {entry.world ?? t("serverWorlds.allWorlds")}</p></div><Button variant="outline" disabled={pending || !stopped} onClick={() => choose({ kind: "restore", name: entry.file })}>{t("serverWorlds.restore")}</Button></div>)}
    </section>
    {action && <section aria-label={t("serverWorlds.confirmTitle")} className="space-y-3 rounded-lg border border-amber-500/50 p-4">
      <h3 className="break-all font-medium">{t(action.kind === "rename" ? "serverWorlds.rename" : action.kind === "delete" ? "serverWorlds.delete" : "serverWorlds.restore")}: {action.name}</h3>
      <p className="text-sm">{t(action.kind === "rename" ? "serverWorlds.renameHint" : action.kind === "delete" ? "serverWorlds.deleteHint" : "serverWorlds.restoreHint")}</p>
      {action.kind !== "restore" && action.name === snapshot.baseWorld && <p className="break-all text-sm">{t("serverWorlds.siblings")}: {(snapshot.worlds ?? []).filter((item) => item.name === `${action.name}_nether` || item.name === `${action.name}_the_end`).map((item) => item.name).join(", ") || t("serverWorlds.none")}</p>}
      {action.kind === "rename" && <label className="grid gap-1 text-sm">{t("serverWorlds.newName")}<input aria-label={t("serverWorlds.newName")} className={fieldClass} value={newName} disabled={pending} onChange={(event) => setNewName(event.target.value)} /></label>}
      {action.kind === "restore" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={replace} disabled={pending} onChange={(event) => setReplace(event.target.checked)} />{t("serverWorlds.replace")}</label>}
      <label className="grid gap-1 break-all text-sm">{t("serverWorlds.confirmName", { name: action.name })}<input aria-label={t("serverWorlds.confirmInput")} autoComplete="off" className={fieldClass} value={confirmation} disabled={pending} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <Button variant={action.kind === "delete" || replace ? "destructive" : "default"} disabled={pending || !stopped || confirmation !== action.name || (action.kind === "rename" && !newName.trim())} onClick={() => void submit()}>{t("serverWorlds.confirm")}</Button>
    </section>}
  </div>;
}
