import { GENERAL_GUI_TEST } from "@/lib/generalGuiTest";
import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMicrosoftAccounts } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { openUrl } from "@/lib/native";
import { INTEGRATED_QA, openIntegratedQaMicrosoftLink } from "@/lib/integratedQa";
import { toast } from "sonner";

/**
 * Device-code login dialog (contract §6). Only the user code and the
 * verification URI are shown; the device code itself never leaves the
 * login loop in `auth.tsx`.
 */
export function MicrosoftLoginDialog() {
  const { login, cancelLogin } = useMicrosoftAccounts();
  const { settings, t } = useSettings();
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!login?.userCode) return;
    await navigator.clipboard.writeText(login.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const busy = login?.status === "starting" || login?.status === "finishing";

  return (
    <Dialog
      open={login !== null}
      onOpenChange={(open) => {
        if (!open) cancelLogin();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("account.login.title")}</DialogTitle>
          <DialogDescription>
            {login?.status === "error"
              ? login.error
              : t("account.login.instructions")}
          </DialogDescription>
        </DialogHeader>

        {login?.status === "starting" && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/45 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
            {t("account.login.starting")}
          </div>
        )}

        {(login?.status === "pending" ||
          login?.status === "finishing" ||
          login?.status === "error") &&
          login.userCode && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/45 p-3">
                <span className="min-w-0 font-mono text-2xl font-semibold tracking-widest wrap-anywhere">
                  {login.userCode}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void copyCode()}
                  aria-label={t("account.login.copy")}
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              {login.verificationUri && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (GENERAL_GUI_TEST || INTEGRATED_QA) {
                        void openIntegratedQaMicrosoftLink().catch(() => {
                          toast.error(settings.language === "zh" ? "无法打开 Microsoft 验证页面。" : "Could not open Microsoft verification.");
                        });
                      } else {
                        void openUrl(login.verificationUri!);
                      }
                    }}
                  >
                    <ExternalLink className="size-4" />
                    {t("account.login.openPage")}
                  </Button>
                </div>
              )}
              <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {login.status === "error" ? null : (
                  <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
                )}
                {login.status === "pending"
                  ? t("account.login.waiting")
                  : login.status === "finishing"
                    ? t("account.login.finishing")
                    : null}
              </div>
            </div>
          )}

        <DialogFooter>
          <Button variant="outline" onClick={cancelLogin} disabled={busy}>
            {login?.status === "error"
              ? t("account.login.close")
              : t("account.login.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
