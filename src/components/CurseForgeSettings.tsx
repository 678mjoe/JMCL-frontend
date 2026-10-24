import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/settings";
import { curseForgeKeyStatus, deleteCurseForgeKey, setCurseForgeKey, validCurseForgeKey } from "@/lib/curseforge";

export { validCurseForgeKey } from "@/lib/curseforge";
const nativeCredentials = { status: curseForgeKeyStatus, save: setCurseForgeKey, remove: deleteCurseForgeKey };
/** The input is transient, never a setting or task payload. Native code never returns the stored key. */
export function CurseForgeSettings({ credentials = nativeCredentials }: { credentials?: typeof nativeCredentials }) {
  const { settings } = useSettings();
  const say = (en: string, zh: string) => settings.language === "zh" ? zh : en;
  const [key, setKey] = useState("");
  const [stored, setStored] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true; const current = ++generation.current;
    void credentials.status().then((value) => { if (alive.current && current === generation.current) setStored(value); }).catch(() => { if (alive.current && current === generation.current) setError(true); });
    return () => { alive.current = false; generation.current++; };
  }, [credentials]);
  const update = async (operation: "save" | "remove" | "status") => {
    if (pending.current || (operation === "save" && !validCurseForgeKey(key))) return;
    generation.current++; pending.current = true; setBusy(true); setError(false);
    try {
      if (operation === "save") { const request = credentials.save(key); setKey(""); await request; }
      if (operation === "remove") { setKey(""); await credentials.remove(); }
      const status = await credentials.status();
      if (alive.current) setStored(status);
    } catch { if (alive.current) { setKey(""); setStored(null); setError(true); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="space-y-4" aria-labelledby="curseforge-settings-title">
    <h2 id="curseforge-settings-title" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">CurseForge</h2>
    <p className="text-xs text-muted-foreground">{say("Optional: explicitly save your application API key in this computer's OS credential store. It is not a Microsoft account, browser setting or exported task. Catalog requests use only the CurseForge API. Installing server content sends the key to the selected Core endpoint over its existing transport; use only endpoints you trust.", "可选：明确选择将应用 API key 保存到本机系统凭据库。它不是 Microsoft 账户、浏览器设置或导出任务。目录请求仅访问 CurseForge API；安装服务端内容时会通过现有传输将密钥发送给所选 Core 端点，请仅使用受信任端点。")}</p>
    <p role="status">{stored === null ? say("Credential status unavailable", "凭据状态不可用") : stored ? say("API key saved", "API key 已保存") : say("No API key saved", "尚未保存 API key")}</p>
    <Label htmlFor="curseforge-api-key">{say("New API key", "新的 API key")}</Label>
    <Input id="curseforge-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={key} disabled={busy} onChange={(event) => setKey(event.currentTarget.value)} />
    <p className="text-xs text-muted-foreground">{say("1–512 printable ASCII characters without spaces. Existing keys are never displayed.", "1–512 个不含空格的可打印 ASCII 字符。不会显示已保存的密钥。")}</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !validCurseForgeKey(key)} onClick={() => void update("save")}>{say("Save key in OS credential store", "将密钥保存到系统凭据库")}</Button>
      <Button variant="outline" disabled={busy || stored !== true} onClick={() => void update("remove")}>{say("Remove saved key", "移除已保存的密钥")}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void update("status")}>{say("Refresh key status", "刷新密钥状态")}</Button>
    </div>
    {error && <p role="alert">{say("Could not access the OS credential store. No diagnostic details are displayed. Check native credential-store availability, then retry.", "无法访问系统凭据库，不显示诊断详情。请检查原生凭据库是否可用，然后重试。")}</p>}
  </section>;
}
