import { Badge } from "@/components/ui/badge";
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
import type { Language } from "@/lib/i18n";
import { useSettings, type Theme } from "@/lib/settings";
import type { Source } from "@/lib/types";

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
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
        </section>
      </div>
    </div>
  );
}
