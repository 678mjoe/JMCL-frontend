import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useServers } from "@/lib/servers";
import { useServerAdvanced } from "@/lib/serverAdvanced";
import { safeServerErrorKey } from "@/lib/serverErrorPresentation";
import type { MessageKey } from "@/lib/i18n";
import type { ServerManifest } from "@/lib/types";

type Props = { server: ServerManifest; state: "running" | "stopped" | "unknown" };
const fieldClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60";

/** A keyed subtree prevents a credential or edited value surviving source changes. */
export function ServerAdvancedPanel(props: Props) {
  const servers = useServers();
  const scope = servers.captureOperationScope();
  const key = JSON.stringify([props.server.id, scope?.endpointId, scope?.kind, scope?.directory, scope?.sourceRevision]);
  return <ScopedPanel key={key} {...props} />;
}

function ScopedPanel(props: Props) {
  const { t } = useSettings();
  const [shown, setShown] = useState(false);
  return <section className="mt-6 rounded-xl border p-5" aria-label={t("serverAdvanced.title")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{t("serverAdvanced.title")}</h2><p className="text-sm text-muted-foreground">{t("serverAdvanced.security")}</p></div>
      <Button variant="outline" onClick={() => setShown(!shown)}>{t(shown ? "serverAdvanced.close" : "serverAdvanced.open")}</Button>
    </div>
    {shown && <AdvancedControls {...props} />}
  </section>;
}

function AdvancedControls({ server, state }: Props) {
  const { t } = useSettings();
  const { endpointId } = useServers();
  const { snapshot, loadProperties, saveProperties, rcon, query, cancel } = useServerAdvanced(server);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [password, setPassword] = useState("");
  const [command, setCommand] = useState("");
  const [validation, setValidation] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(false);
  const properties = snapshot.properties?.properties;
  const pending = snapshot.pending;
  const stopped = state === "stopped";
  const running = state === "running";
  useEffect(() => { if (!running) setPassword(""); }, [running]);
  const change = (key: string, value: string) => { setEdits((previous) => ({ ...previous, [key]: value })); setSaved(false); };
  const add = (event: FormEvent) => {
    event.preventDefault();
    // Secret configuration is deliberately not part of this editor.
    if (!newKey.trim() || newKey !== newKey.trim() || /[\s=:\0]/.test(newKey) || newKey.toLowerCase() === "rcon.password" || Object.hasOwn(properties ?? {}, newKey) || Object.hasOwn(edits, newKey)) {
      setValidation("serverAdvanced.invalidKey"); return;
    }
    change(newKey, newValue); setNewKey(""); setNewValue(""); setValidation(null);
  };
  const save = async () => {
    setSaved(false);
    if (await saveProperties(edits)) { setEdits({}); setSaved(true); }
  };
  const sendRcon = (event: FormEvent) => {
    event.preventDefault();
    if (!command.trim() || /[\r\n\0]/.test(command) || !password) { setValidation("serverAdvanced.invalidRcon"); return; }
    setValidation(null);
    const immediatePassword = password;
    setPassword("");
    void rcon(command, immediatePassword);
  };
  const discard = () => { setPassword(""); setCommand(""); setEdits({}); setNewKey(""); setNewValue(""); setValidation(null); setSaved(false); void cancel(); };
  const keys = Array.from(new Set([...Object.keys(properties ?? {}), ...Object.keys(edits)])).sort();
  const errorKey: Record<string, MessageKey> = {
    BUSY: "serverAdvanced.busy",
    JAVA_NOT_FOUND: endpointId === "local" ? "servers.javaMissingLocal" : "servers.javaMissingRemote",
    JAVA_INCOMPATIBLE: endpointId === "local" ? "servers.javaIncompatibleLocal" : "servers.javaIncompatibleRemote",
    SERVER_NOT_FOUND: "servers.notFoundHint",
    UNSUPPORTED_PLATFORM: "serverAdvanced.unsupported",
    SERVER_PROPERTIES_NOT_FOUND: "serverAdvanced.propertiesMissing",
    SERVER_PROPERTIES_INVALID: "serverAdvanced.propertiesInvalid",
    SERVER_RCON_DISABLED: "serverAdvanced.rconDisabled",
    SERVER_QUERY_DISABLED: "serverAdvanced.queryDisabled",
    SERVER_RCON_AUTH_FAILED: "serverAdvanced.authFailed",
    SERVER_RCON_UNAVAILABLE: "serverAdvanced.unavailable",
    SERVER_QUERY_UNAVAILABLE: "serverAdvanced.unavailable",
    SERVER_RCON_PROTOCOL_ERROR: "serverAdvanced.protocolError",
    SERVER_QUERY_PROTOCOL_ERROR: "serverAdvanced.protocolError",
    SERVER_ALREADY_RUNNING: "serverAdvanced.stoppedOnly",
    SERVER_NOT_RUNNING: "serverAdvanced.runningOnly",
    SERVER_NOT_INSTALLED: "serverAdvanced.propertiesMissing",
    SERVER_STATUS_FAILED: "serverAdvanced.unknownState",
    INVALID_PARAMS: "serverAdvanced.invalidInput",
  };
  return <div className="mt-5 space-y-6">
    <div className="flex items-center gap-3"><Button variant="outline" onClick={discard}>{t("serverAdvanced.cancel")}</Button>{pending && <span role="status" className="text-sm text-muted-foreground">{t("serverAdvanced.pending")}</span>}</div>
    {snapshot.error && <p role="alert" className="text-sm text-destructive">{t(errorKey[snapshot.error] ?? safeServerErrorKey(snapshot.error, "serverAdvanced.failed"))}</p>}
    {validation && <p role="alert" className="text-sm text-destructive">{t(validation)}</p>}
    {state === "unknown" && <p className="text-sm text-muted-foreground">{t("serverAdvanced.unknownState")}</p>}
    <section aria-label={t("serverAdvanced.properties")} className="space-y-3">
      <h3 className="font-medium">{t("serverAdvanced.properties")}</h3>
      <p className="text-sm text-muted-foreground">{t("serverAdvanced.propertiesHint")}</p>
      <Button variant="outline" disabled={pending || Object.keys(edits).length > 0} onClick={() => { setSaved(false); void loadProperties(); }}>{t("serverAdvanced.load")}</Button>
      {properties && <>
        <div className="max-h-96 space-y-2 overflow-auto">
          {keys.map((key) => <label key={key} className="grid gap-1 sm:grid-cols-2 sm:items-center"><span className="break-all font-mono text-sm">{key}</span><input aria-label={key} className={fieldClass} value={key.toLowerCase() === "rcon.password" ? t("serverAdvanced.redacted") : edits[key] ?? properties[key] ?? ""} disabled={pending || !stopped || key.toLowerCase() === "rcon.password"} onChange={(event) => change(key, event.target.value)} autoComplete="off" spellCheck={false} /></label>)}
        </div>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input aria-label={t("serverAdvanced.newKey")} placeholder={t("serverAdvanced.newKey")} value={newKey} onChange={(event) => setNewKey(event.target.value)} disabled={pending || !stopped} className={`${fieldClass} flex-1`} />
          <input aria-label={t("serverAdvanced.newValue")} placeholder={t("serverAdvanced.newValue")} value={newValue} onChange={(event) => setNewValue(event.target.value)} disabled={pending || !stopped} className={`${fieldClass} flex-1`} />
          <Button type="submit" variant="outline" disabled={pending || !stopped}>{t("serverAdvanced.add")}</Button>
        </form>
        <Button disabled={pending || !stopped || Object.keys(edits).length === 0} onClick={() => void save()}>{t("serverAdvanced.save")}</Button>
        {saved && <p role="status" className="text-sm">{t("serverAdvanced.saved")}</p>}
      </>}
      {!stopped && <p className="text-sm text-muted-foreground">{t("serverAdvanced.stoppedOnly")}</p>}
    </section>
    <section aria-label="RCON" className="space-y-3">
      <h3 className="font-medium">RCON</h3><p className="text-sm text-muted-foreground">{t("serverAdvanced.passwordHint")}</p>
      <form onSubmit={sendRcon} className="grid gap-2">
        <label className="grid gap-1 text-sm">{t("serverAdvanced.password")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={fieldClass} disabled={pending || !running} autoComplete="off" spellCheck={false} /></label>
        <label className="grid gap-1 text-sm">{t("serverAdvanced.command")}<input value={command} onChange={(event) => setCommand(event.target.value)} className={fieldClass} disabled={pending || !running} autoComplete="off" spellCheck={false} /></label>
        <Button type="submit" disabled={pending || !running || !password || !command.trim()}>{t("serverAdvanced.send")}</Button>
      </form>
      {!running && <p className="text-sm text-muted-foreground">{t("serverAdvanced.runningOnly")}</p>}
      {snapshot.rcon && <><pre aria-label={t("serverAdvanced.reply")} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{snapshot.rcon.text}</pre>{snapshot.rcon.truncated && <p className="text-sm">{t("serverAdvanced.truncated")}</p>}</>}
    </section>
    <section aria-label="Query" className="space-y-3">
      <h3 className="font-medium">Query</h3><div className="flex gap-2"><Button variant="outline" disabled={pending || !running} onClick={() => void query("basic")}>{t("serverAdvanced.basic")}</Button><Button variant="outline" disabled={pending || !running} onClick={() => void query("full")}>{t("serverAdvanced.full")}</Button></div>
      {snapshot.query && <><dl className="grid gap-2 sm:grid-cols-2">{(["mode", "hostname", "game_type", "map", "version", "players", "max_players", "host_port", "host_ip", "plugins"] as const).map((key) => <div key={key}><dt className="font-mono text-xs text-muted-foreground">{key}</dt><dd className="break-words text-sm">{snapshot.query![key] === null ? t("serverAdvanced.notProvided") : snapshot.query![key] === "" ? t("serverAdvanced.empty") : String(snapshot.query![key])}</dd></div>)}</dl><h4 className="text-sm font-medium">{t("serverAdvanced.players")}</h4>{snapshot.query.player_names.length ? <ul className="list-inside list-disc text-sm">{snapshot.query.player_names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t("serverAdvanced.noPlayers")}</p>}</>}
    </section>
  </div>;
}
