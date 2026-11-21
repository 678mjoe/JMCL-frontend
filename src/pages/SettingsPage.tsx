import { useState, type ReactNode } from "react";
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
import { DiagnosticSettings } from "@/components/DiagnosticSettings";
import { UpdateSettings } from "@/components/UpdateSettings";
import { StoreGcSettings } from "@/components/StoreGcSettings";
import { CurseForgeSettings } from "@/components/CurseForgeSettings";
import { EndpointManager } from "@/components/EndpointManager";
import { useMicrosoftAccounts } from "@/lib/auth";
import { currentQaIntent, usesMicrosoftAccounts } from "@/lib/integratedQa";
import type { Language } from "@/lib/i18n";
import { errorText, useLauncher } from "@/lib/launcher";
import { useSettings, type Theme } from "@/lib/settings";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function SettingRow({ id, label, description, wide, children }: {
  id: string;
  label: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn(
      "grid min-w-0 gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0 @min-[21rem]/settings-panel:items-center",
      wide
        ? "@min-[21rem]/settings-panel:grid-cols-[minmax(0,1fr)_minmax(0,65%)]"
        : "@min-[21rem]/settings-panel:grid-cols-[minmax(0,1fr)_minmax(0,clamp(8rem,36cqi,11rem))]",
    )}>
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="leading-tight">{label}</Label>
        {description && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
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
    <section className="jmcl-panel col-span-full space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="settings-accounts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_12rem] space-y-1">
          <SectionHeading id="settings-accounts">{t("settings.accounts")}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t("settings.accountsHint")}</p>
        </div>
        <Button variant="outline" size="sm" disabled={status !== "ready"} onClick={startLogin}>
          {t("account.add")}
        </Button>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p role="alert" className="text-sm wrap-anywhere text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : loading ? (
        <p role="status" className="border-t pt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : accounts.length === 0 ? (
        <p className="border-t pt-3 text-sm text-muted-foreground">{t("account.empty")}</p>
      ) : (
        <ul className="divide-y border-t">
          {accounts.map((account) => (
            <li key={account.id} className="space-y-3 py-3 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-[1_1_7rem]">
                  <p className="text-sm font-medium wrap-anywhere">{account.player_name}</p>
                  {account.xuid && (
                    <p className="font-mono text-xs wrap-anywhere text-muted-foreground">XUID {account.xuid}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activeAccount?.id === account.id ? (
                    <Badge variant="secondary">{t("account.active")}</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setActiveAccount(account.id)}>
                      {t("account.setActive")}
                    </Button>
                  )}
                  {confirmId !== account.id && (
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
              {confirmId === account.id && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/5 p-2.5">
                  <p className="text-xs leading-relaxed text-destructive">{t("account.removeConfirm")}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button variant="ghost" size="sm" disabled={removing} onClick={() => setConfirmId(null)}>
                      {t("account.removeCancel")}
                    </Button>
                    <Button variant="destructive" size="sm" disabled={removing} onClick={() => void confirmRemove(account.id)}>
                      {t("common.confirm")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { settings, update, t } = useSettings();
  const isChinese = settings.language === "zh";
  const qaIntent = currentQaIntent();
  const downloadLimits = [
    { key: "downloadWorkers", label: isChinese ? "并发下载数" : "Download workers", minimum: 1, maximum: 32 },
    { key: "downloadRetries", label: isChinese ? "失败重试数" : "Retries per download", minimum: 0, maximum: 5 },
  ] as const;
  const directories = [
    { key: "instancesDir", label: t("settings.instancesDir") },
    { key: "storeDir", label: t("settings.storeDir") },
    { key: "serversDir", label: t("settings.serversDir") },
  ] as const;

  return (
    <div className="jmcl-page @container/settings">
      <header className="jmcl-page-header">
        <h1 className="jmcl-page-title">{t("settings.title")}</h1>
      </header>

      <div className="grid min-w-0 gap-4 @min-[54rem]/settings:grid-cols-2">
        <section className="jmcl-panel @container/settings-panel space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="settings-appearance">
          <SectionHeading id="settings-appearance">{t("settings.appearance")}</SectionHeading>
          <div className="divide-y">
            <SettingRow id="settings-theme" label={t("settings.theme")}>
              <Select
                value={settings.theme}
                onValueChange={(value) => {
                  if (value) update({ theme: value as Theme });
                }}
              >
                <SelectTrigger id="settings-theme" className="w-full min-w-0">
                  <SelectValue>{t(`settings.theme.${settings.theme}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
                  <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
                  <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow id="settings-language" label={t("settings.language")}>
              <Select
                value={settings.language}
                onValueChange={(value) => {
                  if (value) update({ language: value as Language });
                }}
              >
                <SelectTrigger id="settings-language" className="w-full min-w-0">
                  <SelectValue>{isChinese ? "中文" : "English"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </section>

        <section className="jmcl-panel @container/settings-panel space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="settings-game">
          <SectionHeading id="settings-game">{t("settings.game")}</SectionHeading>
          <div className="divide-y">
            <SettingRow id="settings-player-name" label={t("settings.playerName")} description={t("settings.playerNameHint")}>
              <Input
                id="settings-player-name"
                aria-describedby="settings-player-name-hint"
                value={settings.playerName}
                readOnly={qaIntent !== null}
                onChange={(e) => update({ playerName: e.target.value })}
                onBlur={() => {
                  if (!settings.playerName.trim()) update({ playerName: "Player" });
                }}
              />
            </SettingRow>
            <SettingRow id="settings-download-source" label={t("settings.source")}>
              <Select
                value={settings.source}
                disabled={qaIntent !== null}
                onValueChange={(value) => {
                  if (value) update({ source: value as Source });
                }}
              >
                <SelectTrigger id="settings-download-source" className="w-full min-w-0">
                  <SelectValue>{t(`settings.source.${settings.source}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="official">{t("settings.source.official")}</SelectItem>
                  <SelectItem value="bmclapi">{t("settings.source.bmclapi")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
          {settings.source === "bmclapi" && (
            <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.bmclapiNotice")}</p>
          )}
        </section>

        <section className="jmcl-panel @container/settings-panel space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="settings-directories">
          <SectionHeading id="settings-directories">{t("settings.directories")}</SectionHeading>
          <div className="divide-y">
            {directories.map(({ key, label }) => (
              <SettingRow key={key} id={key} label={label} wide>
                <Input
                  id={key}
                  className="font-mono text-sm"
                  spellCheck={false}
                  value={settings[key]}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
              </SettingRow>
            ))}
          </div>
        </section>

        <section className="jmcl-panel @container/settings-panel space-y-4 p-(--jmcl-panel-padding)" aria-labelledby="settings-downloads">
          <SectionHeading id="settings-downloads">{isChinese ? "下载" : "Downloads"}</SectionHeading>
          <div className="divide-y">
            {downloadLimits.map(({ key, label, minimum, maximum }) => (
              <SettingRow key={key} id={key} label={label}>
                <Select
                  value={String(settings[key])}
                  onValueChange={(value) => {
                    if (value !== null) update({ [key]: Number(value) });
                  }}
                >
                  <SelectTrigger id={key} className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i).map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isChinese
              ? "仅影响新开始的操作。进行中的任务保留原设置。并发数 1–32，重试数 0–5。"
              : "Applies to new operations. Running tasks retain their original settings. Workers: 1–32. Retries: 0–5."}
          </p>
        </section>
        {usesMicrosoftAccounts(qaIntent) && <AccountsSection />}
        <EndpointManager />
        <UpdateSettings />
        <DiagnosticSettings />
        <CurseForgeSettings />
        <StoreGcSettings />
      </div>
    </div>
  );
}
