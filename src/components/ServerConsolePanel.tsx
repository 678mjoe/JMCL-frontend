import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import { deriveServerState } from "@/lib/serverState";
import { isNearLogBottom, ServerLogController, type ServerLogSession } from "@/lib/serverLogController";
import type { ServerManifest } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function ServerConsolePanel({ server, running }: { server: ServerManifest; running: boolean }) {
  const { t } = useSettings();
  const servers = useServers();
  const scope = servers.captureOperationScope();
  const controller = useMemo(() => new ServerLogController({
    serverId: server.id,
    captureScope: servers.captureOperationScope,
    isScopeCurrent: servers.isOperationScopeCurrent,
    openSession: async () => {
      const session = await servers.openSession();
      const dedicated: ServerLogSession = {
        close: () => session.close(),
        serverLogs: (directory, id, options) => session.serverLogs(directory, id, options),
        serverCommand: (directory, id, command) => session.serverCommand(directory, id, command),
      };
      return dedicated;
    },
  }), [server.id, servers.captureOperationScope, servers.isOperationScopeCurrent, servers.openSession]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [shown, setShown] = useState(false);
  const [command, setCommand] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);
  const scopeKey = scope ? `${scope.endpointId}\u0000${scope.kind}\u0000${scope.directory}\u0000${scope.sourceRevision}` : "none";
  const derived = deriveServerState({
    manifest: server,
    status: { running, stale_state: false },
    hasLogs: state.hasLogs,
    hasProperties: false,
    hasLoaderManifest: Boolean(server.fabric_loader || server.neoforge_version || server.forge_version),
  });
  const canCommand = shown && state.open && state.sessionReady && derived.capabilities.consoleCommand;

  useEffect(() => () => { void controller.close(); }, [controller]);
  useEffect(() => {
    if (shown && scope) void controller.open();
    // Scope changes replace the panel's dedicated session and invalidate its old work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => {
    controller.setRunning(running);
  }, [controller, running]);
  useEffect(() => {
    const log = logRef.current;
    if (log && followRef.current) log.scrollTop = log.scrollHeight;
  }, [state.text]);

  const open = () => { setShown(true); void controller.open(); };
  const close = () => { setShown(false); void controller.close(); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void controller.submitCommand(command).then((accepted) => { if (accepted) setCommand(""); });
  };

  return <section className="mt-6 rounded-xl border p-5" aria-label={t("serverConsole.title")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{t("serverConsole.title")}</h2><p className="text-sm text-muted-foreground">{t("serverConsole.description")}</p></div>
      {!shown
        ? <Button variant="outline" onClick={open}>{t("serverConsole.open")}</Button>
        : <Button variant="outline" onClick={close}>{t("serverConsole.close")}</Button>}
    </div>
    {shown && <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {state.loading && <span>{t("serverConsole.loading")}</span>}
        {state.running && state.open && <span>{t("serverConsole.polling")}</span>}
        {state.notFound && <span>{t("serverConsole.notFound")}</span>}
        {state.empty && !state.notFound && !state.loading && !state.error && <span>{t("serverConsole.empty")}</span>}
        {state.error && <><span role="alert" className="text-destructive">{t("serverConsole.readError", { code: state.error })}</span><Button variant="outline" size="sm" onClick={() => void controller.retry()}>{t("serverConsole.retry")}</Button></>}
      </div>
      {state.truncated && <p className="rounded-md bg-amber-500/10 p-2 text-sm">{t("serverConsole.truncated")}</p>}
      {state.localOmission && <p className="rounded-md bg-amber-500/10 p-2 text-sm">{t("serverConsole.localOmission")}</p>}
      <pre ref={logRef} aria-label={t("serverConsole.logLabel")} onScroll={(event) => { followRef.current = isNearLogBottom(event.currentTarget); }} className="max-h-96 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-sm leading-relaxed">{state.text}</pre>
      {canCommand && <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor={`server-command-${server.id}`}>{t("serverConsole.commandLabel")}</label>
        <input id={`server-command-${server.id}`} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-sm" value={command} onChange={(event) => setCommand(event.target.value)} autoComplete="off" aria-describedby={`server-command-help-${server.id}`} />
        <span id={`server-command-help-${server.id}`} className="sr-only">{t("serverConsole.commandHelp")}</span>
        <Button type="submit" disabled={state.commandPending}>{state.commandPending ? t("serverConsole.sending") : t("serverConsole.send")}</Button>
      </form>}
      {state.validationError && <p role="alert" className="text-sm text-destructive">{t(state.validationError === "empty" ? "serverConsole.validationEmpty" : "serverConsole.validationMultiline")}</p>}
      {state.commandError && <p role="alert" className="text-sm text-destructive">{t("serverConsole.commandError", { code: state.commandError })}</p>}
      {state.acceptedNotice && <p role="status" className="text-sm text-muted-foreground">{t("serverConsole.accepted")}</p>}
    </div>}
  </section>;
}
