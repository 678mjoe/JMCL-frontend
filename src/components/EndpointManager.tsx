import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { generateEndpointUuid, type SshEndpoint } from "@/lib/endpoints";
import { useEndpointContext } from "@/lib/endpointContext";
import { runEndpointConnectionTest, type EndpointConnectionState } from "@/lib/endpointConnectionTest";
import { closeEndpointSessions, endpointRepository } from "@/lib/native";
import { EndpointMutationQueue, deleteEndpointTransaction, saveEndpointTransaction } from "@/lib/endpointManagerTransactions";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";

type EndpointForm = { label: string; destination: string; serversDirectory: string };
type Feedback = { kind: "status" | "error" | "warning"; key: string };
type EndpointRepository = Pick<typeof endpointRepository, "read" | "write">;
type TestRunner = typeof runEndpointConnectionTest;

function blankForm(): EndpointForm { return { label: "", destination: "", serversDirectory: "" }; }

export function EndpointManager({
  repository = endpointRepository,
  testConnection = runEndpointConnectionTest,
  closeSessions = closeEndpointSessions,
}: {
  repository?: EndpointRepository;
  testConnection?: TestRunner;
  closeSessions?: (id: string) => Promise<void>;
}) {
  const { config, loading, error: configError, replaceConfig, selectedEndpointId } = useEndpointContext();
  const { update, t } = useSettings();
  const { prepareEndpointDeletion, cleanupEndpointCache } = useServers();
  const [editing, setEditing] = useState<SshEndpoint | null | "new">(null);
  const [form, setForm] = useState<EndpointForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SshEndpoint | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [connectionStates, setConnectionStates] = useState<Record<string, EndpointConnectionState>>({});
  const queue = useRef(new EndpointMutationQueue());
  const testRuns = useRef(new Map<string, { controller: AbortController; generation: number }>());
  const testGenerations = useRef(new Map<string, number>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const { controller } of testRuns.current.values()) controller.abort();
      testRuns.current.clear();
    };
  }, []);

  const cancelTest = (id: string) => {
    const current = testRuns.current.get(id);
    if (current) current.controller.abort();
    testRuns.current.delete(id);
    testGenerations.current.set(id, (testGenerations.current.get(id) ?? 0) + 1);
    setConnectionStates((states) => {
      const next = { ...states };
      delete next[id];
      return next;
    });
  };

  const openAdd = () => { setFeedback(null); setForm(blankForm()); setEditing("new"); };
  const openEdit = (endpoint: SshEndpoint) => {
    cancelTest(endpoint.id);
    setFeedback(null);
    setForm({ label: endpoint.label, destination: endpoint.destination, serversDirectory: endpoint.serversDirectory ?? "" });
    setEditing(endpoint);
  };

  const saveEndpoint = async () => {
    if (!config || (editing !== "new" && !editing) || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await queue.current.run(async () => {
        const next = await saveEndpointTransaction({
          repository,
          endpointId: editing === "new" ? null : editing.id,
          draft: form,
          randomUUID: generateEndpointUuid,
        });
        replaceConfig(next);
      });
      setEditing(null);
      setFeedback({ kind: "status", key: "endpoint.saved" });
    } catch {
      setFeedback({ kind: "error", key: "endpoint.validationOrSaveFailed" });
    } finally {
      setSaving(false);
    }
  };

  const removeEndpoint = async (endpoint: SshEndpoint) => {
    if (!config || deleting) return;
    cancelTest(endpoint.id);
    setDeleting(true);
    setFeedback(null);
    try {
      const result = await queue.current.run(() => deleteEndpointTransaction({
        repository,
        endpointId: endpoint.id,
        selectedEndpointId,
        persistSelectedEndpointId: (id) => update({ selectedServerEndpointId: id }),
        publishConfig: replaceConfig,
        prepareEndpointDeletion,
        closeEndpointSessions: closeSessions,
        cleanupEndpointCache,
      }));
      if (!result.deleted) {
        setFeedback({ kind: "error", key: "endpoint.deleteFailed" });
      } else {
        setConfirmDelete(null);
        setFeedback({ kind: result.cleanupComplete ? "status" : "warning", key: result.cleanupComplete ? "endpoint.deleted" : "endpoint.deletedCleanupWarning" });
      }
    } catch {
      setFeedback({ kind: "error", key: "endpoint.deleteFailed" });
    } finally {
      setDeleting(false);
    }
  };

  const runTest = async (endpoint: SshEndpoint) => {
    cancelTest(endpoint.id);
    const generation = (testGenerations.current.get(endpoint.id) ?? 0) + 1;
    testGenerations.current.set(endpoint.id, generation);
    const controller = new AbortController();
    testRuns.current.set(endpoint.id, { controller, generation });
    const isCurrent = () => mounted.current && testGenerations.current.get(endpoint.id) === generation;
    setConnectionStates((states) => ({ ...states, [endpoint.id]: { status: "connecting" } }));
    await testConnection(endpoint, undefined, {
      signal: controller.signal,
      onState: (state) => { if (isCurrent()) setConnectionStates((states) => ({ ...states, [endpoint.id]: state })); },
    });
    if (testRuns.current.get(endpoint.id)?.generation === generation) testRuns.current.delete(endpoint.id);
  };

  const connectionText = (state: EndpointConnectionState | undefined): string | null => {
    if (!state || state.status === "idle") return null;
    if (state.status === "connecting") return t("endpoint.testConnecting");
    if (state.status === "connected") return t("endpoint.testConnected", { version: state.core.version });
    if (state.status !== "error") return null;
    const keys = {
      "unknown-host-key": "endpoint.testUnknownHostKey",
      "changed-host-key": "endpoint.testChangedHostKey",
      "auth-required": "endpoint.testAuthRequired",
      "interactive-auth-unsupported": "endpoint.testInteractiveAuthUnsupported",
      timeout: "endpoint.testTimeout",
      "unsupported-protocol": "endpoint.testUnsupportedProtocol",
      disconnected: "endpoint.testDisconnected",
      failure: "endpoint.testFailure",
    } as const;
    return t(keys[state.code]);
  };

  return (
    <section className="space-y-4" aria-labelledby="endpoint-manager-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="endpoint-manager-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("settings.endpoints")}</h2>
          <p className="text-xs text-muted-foreground">{t("endpoint.description")}</p>
        </div>
        <Button variant="outline" onClick={openAdd} disabled={loading || !config}>{t("endpoint.add")}</Button>
      </div>
      {configError && <p role="status" className="text-sm text-destructive">{t("endpoint.configUnavailable")}</p>}
      {loading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : config && (
        <ul className="divide-y rounded-md border">
          {config.endpoints.map((endpoint) => endpoint.kind === "local" ? (
            <li key="local" className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <span className="text-sm font-medium">{t("endpoint.local")}</span>
              <span className="text-xs text-muted-foreground">{t("endpoint.localImmutable")}</span>
            </li>
          ) : (
            <li key={endpoint.id} className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{endpoint.label}</p><p className="text-xs text-muted-foreground">{t("endpoint.ssh")}</p></div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={saving || deleting} onClick={() => void runTest(endpoint)}>{t("endpoint.test")}</Button>
                  <Button size="sm" variant="outline" disabled={saving || deleting} onClick={() => openEdit(endpoint)}>{t("endpoint.edit")}</Button>
                  <Button size="sm" variant="destructive" disabled={saving || deleting} onClick={() => { cancelTest(endpoint.id); setConfirmDelete(endpoint); }}>{t("endpoint.delete")}</Button>
                </div>
              </div>
              {connectionText(connectionStates[endpoint.id]) && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{connectionText(connectionStates[endpoint.id])}</p>}
            </li>
          ))}
        </ul>
      )}
      {feedback && <p role={feedback.kind === "status" ? "status" : "alert"} className={feedback.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{t(feedback.key as Parameters<typeof t>[0])}</p>}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DialogContent aria-describedby="endpoint-form-description">
          <DialogHeader>
            <DialogTitle>{t(editing === "new" ? "endpoint.addTitle" : "endpoint.editTitle")}</DialogTitle>
            <DialogDescription id="endpoint-form-description">{t("endpoint.formHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="endpoint-label">{t("endpoint.label")}</Label><Input id="endpoint-label" autoFocus maxLength={80} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} aria-describedby="endpoint-label-help" /><p id="endpoint-label-help" className="text-xs text-muted-foreground">{t("endpoint.labelHelp")}</p></div>
            <div className="space-y-1.5"><Label htmlFor="endpoint-destination">{t("endpoint.destination")}</Label><Input id="endpoint-destination" autoComplete="off" spellCheck={false} value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} aria-describedby="endpoint-destination-help" /><p id="endpoint-destination-help" className="text-xs text-muted-foreground">{t("endpoint.destinationHelp")}</p></div>
            <div className="space-y-1.5"><Label htmlFor="endpoint-directory">{t("endpoint.directory")}</Label><Input id="endpoint-directory" autoComplete="off" spellCheck={false} value={form.serversDirectory} onChange={(event) => setForm({ ...form, serversDirectory: event.target.value })} aria-describedby="endpoint-directory-help" /><p id="endpoint-directory-help" className="text-xs text-muted-foreground">{t("endpoint.directoryHelp")}</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button disabled={saving} onClick={() => void saveEndpoint()}>{saving ? t("endpoint.saving") : t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open && !deleting) setConfirmDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endpoint.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("endpoint.deleteConfirm", { name: confirmDelete?.label ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" autoFocus disabled={deleting || !confirmDelete} onClick={() => confirmDelete && void removeEndpoint(confirmDelete)}>{deleting ? t("endpoint.deleting") : t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
