import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canInstallServer, useServerOperations } from "@/lib/serverOperations";
import { openUrl } from "@/lib/native";
import { useSettings } from "@/lib/settings";
import type { ServerManifest } from "@/lib/types";

export function ServerInstallDialog({ open, onOpenChange, server }: { open: boolean; onOpenChange: (open: boolean) => void; server: ServerManifest }) {
  const { t } = useSettings();
  const { install, operationFor } = useServerOperations();
  const [consent, setConsent] = useState(false);
  const operation = operationFor(server.id);
  const pending = operation?.pending === true;
  const needsConsent = !server.accept_eula;
  const submit = async () => {
    try { if (await install(server, canInstallServer(server, consent))) { setConsent(false); onOpenChange(false); } } catch { /* error is shown in the dialog */ }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) { if (!value) setConsent(false); onOpenChange(value); } }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t(server.installed ? "serverInstall.repairTitle" : "serverInstall.title")}</DialogTitle></DialogHeader>
      <p>{t(server.installed ? "serverInstall.repairDescription" : "serverInstall.description")}</p>
      {needsConsent && <div className="space-y-3 rounded-md border p-3">
        <button type="button" className="text-primary underline" onClick={() => void openUrl("https://www.minecraft.net/eula")}>{t("serverInstall.eulaLink")}</button>
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} /><span>{t("serverInstall.eulaConsent")}</span></label>
      </div>}
      {operation?.error && <p role="alert" className="text-sm text-destructive">{operation.error}</p>}
      {operation?.progress?.event === "progress" && <p className="text-sm text-muted-foreground">{t("serverInstall.files", { completed: operation.progress.progress.files_completed, total: operation.progress.progress.files_total })}</p>}
      {pending && <p className="text-sm text-muted-foreground">{t(operation?.stage === "finishing" ? "serverInstall.finishing" : "serverInstall.installing")}</p>}
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button disabled={pending || !canInstallServer(server, consent)} onClick={() => void submit()}>{t(pending ? "serverInstall.installing" : server.installed ? "serverInstall.repair" : "serverInstall.install")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
