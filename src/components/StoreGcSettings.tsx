import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CoreSession } from "@/lib/rpc";
import { useSettings } from "@/lib/settings";
import { parseGcAge, StoreGcController, summaryKeys, type StoreGcSession } from "@/lib/storeGc";
const openLocalSession = () => CoreSession.open();
export function StoreGcSettings({ openSession = openLocalSession }: { openSession?: () => Promise<StoreGcSession> }) {
  const { settings } = useSettings();
  const say = (en: string, zh: string) => settings.language === "zh" ? zh : en;
  const [age, setAge] = useState("86400");
  const [confirmation, setConfirmation] = useState("");
  const controller = useMemo(() => new StoreGcController(openSession), [openSession]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const scope = JSON.stringify(settings);
  useEffect(() => { controller.configure(settings.storeDir, parseGcAge(age), scope); setConfirmation(""); }, [controller, settings.storeDir, age, scope]);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const currentScope = controller.matches(settings.storeDir, parseGcAge(age), scope);
  const preview = currentScope ? state.preview : null;
  const result = currentScope ? state.preview ?? state.result : null;
  const error = currentScope ? state.error : null;
  const configureNow = () => controller.configure(settings.storeDir, parseGcAge(age), scope);
  return <section className="space-y-4" aria-labelledby="store-gc-title">
    <h2 id="store-gc-title" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{say("Shared artifact store cleanup", "共享资源存储清理")}</h2>
    <p className="break-all font-mono text-xs">{settings.storeDir || say("Configure the store directory first", "请先设置存储目录")}</p>
    <p className="text-xs text-muted-foreground">{say("Local store only. Preview does not delete files. Execution scans again, so counts may change. Core uses per-object locks and rechecks age and hard links. The summary reports busy or disappeared objects. Prefer waiting for downloads and installs to finish. Copied instance files are not removed.", "仅清理本机存储。预览不会删除文件；执行会重新扫描，数量可能变化。Core 使用逐对象锁，并重新检查年龄和硬链接；汇总会报告忙碌或已消失的对象。建议等待下载及安装完成。不会删除实例中复制的文件。")}</p>
    <Label htmlFor="store-gc-age">{say("Minimum age (seconds)", "最小保留时间（秒）")}</Label>
    <Input id="store-gc-age" inputMode="numeric" value={age} disabled={state.pending} onChange={(event) => setAge(event.currentTarget.value)} />
    {parseGcAge(age) === null && <p role="alert">{say("Enter a nonnegative safe integer.", "请输入非负安全整数。")}</p>}
    <Button variant="outline" disabled={state.pending || !settings.storeDir.trim() || parseGcAge(age) === null} onClick={() => { configureNow(); setConfirmation(""); void controller.preview(); }}>{say("Preview cleanup (no deletion)", "预览清理（不删除）")}</Button>
    {state.pending && <p role="status">{say("Scanning store…", "正在扫描存储…")}</p>}
    {result && <div className="space-y-2">
      <p role="status">{preview ? say("Preview only — nothing deleted", "仅预览 — 未删除任何文件") : say("Cleanup completed; preview again before another cleanup", "清理已完成，再次清理前请重新预览")}</p>
      <dl className="grid grid-cols-2 gap-2 text-xs">{summaryKeys.map((key) => <div key={key}><dt className="font-mono">{key}</dt><dd>{result.summary[key]}</dd></div>)}</dl>
    </div>}
    {preview && <div className="space-y-2 rounded-md border border-destructive p-3">
      <p>{say("Permanently delete currently eligible store objects. This cannot be undone. Type the exact store directory to confirm:", "永久删除执行时符合条件的存储对象，无法撤销。请输入完整存储目录以确认：")}</p>
      <Label htmlFor="store-gc-confirm">{settings.storeDir}</Label>
      <Input id="store-gc-confirm" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />
      <Button variant="destructive" disabled={state.pending || confirmation !== settings.storeDir} onClick={() => { configureNow(); void controller.execute(confirmation); setConfirmation(""); }}>{say("Delete eligible store objects", "删除符合条件的存储对象")}</Button>
      <Button variant="ghost" onClick={() => { setConfirmation(""); controller.cancelPreview(); }}>{say("Cancel cleanup", "取消清理")}</Button>
    </div>}
    {error && <p role="alert">{error === "STORE_GC_PARTIAL" ? say("Some objects could not be collected safely. Core returned no summary; the number deleted is unknown. Preview again before any further cleanup.", "部分对象无法安全清理。Core 未返回汇总，已删除数量未知。再次清理前请重新预览。") : say("Cleanup could not be confirmed. A destructive request may already have deleted objects. No totals are inferred; check the store path and preview again.", "无法确认清理结果；删除请求可能已删除部分对象。不会推断数量，请检查存储路径并重新预览。")}{` (${error})`}</p>}
  </section>;
}
