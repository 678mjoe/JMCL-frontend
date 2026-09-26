import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useMicrosoftAccounts } from "@/lib/auth";
import type { Language } from "@/lib/i18n";
import { errorText, useLauncher } from "@/lib/launcher";
import { useSettings, type Theme } from "@/lib/settings";
import type { Source } from "@/lib/types";

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/** Microsoft account list and picker; tokens never leave the keychain. */
function AccountsSection() {
  const {
    accounts,
    loading,
    error,
    refresh,
    activeAccount,
    setActiveAccount,
    removeAccount,
    startLogin,
  } = useMicrosoftAccounts();
  const { status } = useLauncher();
  const { t } = useSettings();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const confirmRemove = async (id: string) => {
    setRemoving(true);
    try {
      await removeAccount(id);
      setConfirmId(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <SectionHeading>{t("settings.accounts")}</SectionHeading>
        <p className="text-xs text-muted-foreground">
          {t("settings.accountsHint")}
        </p>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("account.empty")}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {account.player_name}
                </p>
                {account.xuid && (
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    XUID {account.xuid}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeAccount?.id === account.id ? (
                  <Badge>{t("account.active")}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveAccount(account.id)}
                  >
                    {t("account.setActive")}
                  </Button>
                )}
                {confirmId === account.id ? (
                  <>
                    <span className="text-xs text-destructive">
                      {t("account.removeConfirm")}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={removing}
                      onClick={() => void confirmRemove(account.id)}
                    >
                      {t("common.confirm")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removing}
                      onClick={() => setConfirmId(null)}
                    >
                      {t("account.removeCancel")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmId(account.id)}
                  >
                    {t("account.remove")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <Button
          variant="outline"
          disabled={status !== "ready"}
          onClick={startLogin}
        >
          {t("account.add")}
        </Button>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const { settings, update, t } = useSettings();

  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

        <section className="space-y-4">
          <SectionHeading>{t("settings.appearance")}</SectionHeading>

          <div className="flex items-center justify-between">
            <Label>{t("settings.theme")}</Label>
            <Select
              value={settings.theme}
              onValueChange={(value) => {
                if (value) update({ theme: value as Theme });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue>
                  {t(
                    settings.theme === "system"
                      ? "settings.theme.system"
                      : settings.theme === "light"
                        ? "settings.theme.light"
                        : "settings.theme.dark",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  {t("settings.theme.system")}
                </SelectItem>
                <SelectItem value="light">
                  {t("settings.theme.light")}
                </SelectItem>
                <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>{t("settings.language")}</Label>
            <Select
              value={settings.language}
              onValueChange={(value) => {
                if (value) update({ language: value as Language });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue>
                  {settings.language === "zh" ? "中文" : "English"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Separator />

        <AccountsSection />

        <Separator />

        <section className="space-y-4">
          <SectionHeading>{t("settings.game")}</SectionHeading>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>{t("settings.playerName")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.playerNameHint")}
              </p>
            </div>
            <Input
              className="w-48"
              value={settings.playerName}
              onChange={(e) => update({ playerName: e.target.value })}
              onBlur={() => {
                if (!settings.playerName.trim())
                  update({ playerName: "Player" });
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("settings.source")}</Label>
              <Select
                value={settings.source}
                onValueChange={(value) => {
                  if (value) update({ source: value as Source });
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue>
                    {t(
                      settings.source === "bmclapi"
                        ? "settings.source.bmclapi"
                        : "settings.source.official",
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="official">
                    {t("settings.source.official")}
                  </SelectItem>
                  <SelectItem value="bmclapi">
                    {t("settings.source.bmclapi")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settings.source === "bmclapi" && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">BMCLAPI</Badge>
                <p className="text-xs text-muted-foreground">
                  {t("settings.bmclapiNotice")}
                </p>
              </div>
            )}
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <SectionHeading>{t("settings.directories")}</SectionHeading>

          <div className="space-y-2">
            <Label>{t("settings.instancesDir")}</Label>
            <Input
              className="font-mono text-xs"
              value={settings.instancesDir}
              onChange={(e) => update({ instancesDir: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.storeDir")}</Label>
            <Input
              className="font-mono text-xs"
              value={settings.storeDir}
              onChange={(e) => update({ storeDir: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.serversDir")}</Label>
            <Input
              className="font-mono text-xs"
              value={settings.serversDir}
              onChange={(e) => update({ serversDir: e.target.value })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
