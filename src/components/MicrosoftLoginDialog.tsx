import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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

/**
 * Device-code login dialog (contract §6). Only the user code and the
 * verification URI are shown; the device code itself never leaves the
 * login loop in `auth.tsx`.
 */
export function MicrosoftLoginDialog() {
  const { login, cancelLogin } = useMicrosoftAccounts();
  const { t } = useSettings();
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
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("account.login.starting")}
          </div>
        )}

        {(login?.status === "pending" ||
          login?.status === "finishing" ||
          login?.status === "error") &&
          login.userCode && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-3xl font-semibold tracking-widest">
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
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => void openUrl(login.verificationUri!)}
                  >
                    <ExternalLink className="size-4" />
                    {t("account.login.openPage")}
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                {login.status === "error" ? null : (
                  <Loader2 className="size-4 animate-spin" />
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
