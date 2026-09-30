import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerOperations } from "@/lib/serverOperations";
import { safeServerOperationError } from "@/lib/serverErrorPresentation";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import type { ServerManifest } from "@/lib/types";

export function DeleteServerDialog({ open, onOpenChange, server, onDeleted }: { open: boolean; onOpenChange: (open: boolean) => void; server: ServerManifest; onDeleted: () => void }) {
  const { t } = useSettings();
  const { delete: deleteServer, operationFor } = useServerOperations();
  const { endpointId } = useServers();
  const operation = operationFor(server.id);
  const pending = operation?.pending === true;
  const submit = async () => { try { if (await deleteServer(server)) { onOpenChange(false); onDeleted(); } } catch { /* error is shown on the detail page */ } };
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value); }}><DialogContent>
    <DialogHeader><DialogTitle>{t("serverDelete.title")}</DialogTitle></DialogHeader>
    <p>{t("serverDelete.confirm", { name: server.name })}</p>
    {operation?.error && <p role="alert" className="text-sm text-destructive">{safeServerOperationError(operation.error, endpointId, t)}</p>}
    <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button variant="destructive" disabled={pending} onClick={() => void submit()}>{t(pending ? "serverDelete.deleting" : "servers.delete")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
