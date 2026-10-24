import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { diagnosticTransport, parseDiagnosticRead, parseDiagnosticStatus, type DiagnosticRead, type DiagnosticStatus, type DiagnosticTransport } from "@/lib/diagnostics";

// Keep an in-flight dialog/mutation locked across Settings navigation.
const pendingOperations = new WeakMap<DiagnosticTransport, Promise<void>>();

export function DiagnosticSettings({ transport = diagnosticTransport }: { transport?: DiagnosticTransport }) {
  const { settings } = useSettings();
  const say = (en: string, zh: string) => settings.language === "zh" ? zh : en;
  const [status, setStatus] = useState<DiagnosticStatus | null>(null);
  const [data, setData] = useState<DiagnosticRead>({ records: [], skipped: 0 });
  const [filter, setFilter] = useState("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<"exported" | "cancelled" | "cleared" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  async function run(action: "refresh" | "toggle" | "clear" | "export" = "refresh") {
    if (lock.current) return;
    lock.current = true;
    const token = generation.current;
    const previous = pendingOperations.get(transport);
    let release = () => {};
    if (!previous) pendingOperations.set(transport, new Promise<void>(resolve => { release = resolve; }));
    setPending(true); setError(false); setNotice(null); setConfirm(false);
    try {
      if (previous) { await previous; action = "refresh"; }
      if (token !== generation.current) return;
      let outcome: typeof notice = null;
      if (action === "toggle" && status) await transport.setEnabled(!status.enabled);
      if (action === "clear") { await transport.clear(); outcome = "cleared"; }
      if (action === "export") {
        const result = await transport.export();
        if (result !== true && result !== false) throw new Error("invalid_export_result");
        outcome = result ? "exported" : "cancelled";
      }
      const next = parseDiagnosticStatus(await transport.status());
      if (token !== generation.current) return;
      setStatus(next);
      const logs = parseDiagnosticRead(await transport.read());
      if (token !== generation.current) return;
      const refreshed = parseDiagnosticStatus(await transport.status());
      if (token !== generation.current) return;
      setStatus(refreshed); setData(logs); setNotice(outcome);
    } catch { if (token === generation.current) setError(true); }
    finally {
      if (!previous) { pendingOperations.delete(transport); release(); }
      if (token === generation.current) { lock.current = false; setPending(false); }
    }
  }
  useEffect(() => {
    lock.current = false;
    void run();
    return () => { generation.current++; };
    // Transport is stable; changing it invalidates all prior responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);
  const disabled = pending || !status?.available || error;
  const records = data.records.filter(record => filter === "all" || record.level === filter);
  return <section className="space-y-4" aria-labelledby="diagnostics-heading">
    <h2 id="diagnostics-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{say("Diagnostic logs", "诊断日志")}</h2>
    <p className="text-xs text-muted-foreground">{say("Optional local application diagnostics, off by default; never uploaded automatically. Records contain fixed event/operation categories, failure classes and timing, not account details, credentials, RPC payloads, file paths or game/server console output. Exported files stay on your device until you choose to share them.", "可选的本地应用诊断，默认关闭，不自动上传。记录仅含固定事件／操作类别、失败分类和耗时，不含账号信息、凭据、RPC 内容、文件路径或游戏／服务器控制台输出。导出文件保留在本机，分享由你决定。")}</p>
    <p role="status">{pending ? say("Working…", "处理中…") : !status ? say("Status not available", "状态不可用") : !status.available ? say("Diagnostic storage unavailable. Use the native desktop app and check local storage permissions; browser preview does not write logs.", "诊断存储不可用。请使用原生桌面应用并检查本地存储权限；浏览器预览不会写入日志。") : status.enabled ? say("Recording enabled", "已开启记录") : say("Recording disabled — existing logs remain available", "已关闭记录 — 现有日志仍可查看")}</p>
    {status?.available && <p className="text-xs text-muted-foreground">{say("Old records rotate automatically. Retention limit", "旧记录自动轮转。保留上限")}: {status.max_files} × {status.max_file_bytes.toLocaleString()} {say("bytes", "字节")}. {say("Dropped records", "丢弃记录")}: {status.dropped}.</p>}
    {pending && <p className="text-xs text-muted-foreground">{say("Leaving Settings does not cancel an operation. Cancel export in the native save dialog.", "离开设置不会取消操作。导出请在原生保存对话框中取消。")}</p>}
    {error && <p role="alert">{say("Could not complete the log operation. Refresh to recover; no success is assumed. Error details are not copied into logs.", "无法完成日志操作。请刷新以恢复；不会假定操作成功。错误详情不会复制到日志中。")}</p>}
    {notice && <p role="status">{notice === "exported" ? say("Logs exported", "日志已导出") : notice === "cancelled" ? say("Export cancelled — no file written", "已取消导出 — 未写入文件") : say("Logs cleared", "日志已清理")}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending} onClick={() => void run()}>{say("Refresh logs", "刷新日志")}</Button>
      <Button variant="outline" disabled={pending || (!status?.enabled && disabled)} onClick={() => void run("toggle")}>{status?.enabled ? say("Disable recording", "关闭记录") : say("Enable recording", "开启记录")}</Button>
      <Button variant="outline" disabled={disabled} onClick={() => void run("export")}>{say("Export logs…", "导出日志…")}</Button>
      <Button variant="outline" disabled={disabled} onClick={() => setConfirm(true)}>{say("Clear logs…", "清理日志…")}</Button>
    </div>
    {confirm && <div role="group" aria-label={say("Confirm clearing logs", "确认清理日志")} className="space-y-3 rounded border p-3">
      <p>{say("Delete all retained diagnostic records? This cannot be undone. Export first if needed. Your recording preference is preserved.", "删除所有保留的诊断记录？此操作无法撤销，如需保留请先导出。记录开关不变。")}</p>
      <Button variant="destructive" disabled={disabled} onClick={() => void run("clear")}>{say("Confirm clear", "确认清理")}</Button>{" "}
      <Button variant="outline" onClick={() => setConfirm(false)}>{say("Cancel", "取消")}</Button>
    </div>}
    {status?.available && <>
      <label className="flex items-center gap-3 text-sm">{say("Severity", "级别")}
        <select aria-label={say("Log severity", "日志级别")} className="rounded border bg-background px-2 py-1" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">{say("All", "全部")}</option><option value="info">Info</option><option value="error">Error</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{say("Showing latest records (up to 2,000); export includes valid records within the logger’s bounded read limit. Unrecognized records skipped", "显示最近记录（最多 2,000 条）；导出包含日志器读取上限内的有效记录。跳过的未知记录")}: {data.skipped}.</p>
      <div className="max-h-80 overflow-auto rounded border" tabIndex={0} aria-label={say("Diagnostic records", "诊断记录")}>
        {records.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{say("No matching diagnostic records", "暂无匹配的诊断记录")}</p> : <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{[say("Time", "时间"), say("Level", "级别"), say("Event", "事件"), say("Details", "详情")].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{[...records].reverse().map((record, index) => <tr key={index} className="border-t"><td className="whitespace-nowrap p-2">{new Date(record.timestamp_ms).toLocaleString()}</td><td className="p-2">{record.level}</td><td className="p-2 font-mono">{record.event}</td><td className="p-2 font-mono">{[record.operation ?? record.method, record.outcome, record.failure, record.correlation_id !== undefined ? `#${record.correlation_id}` : null, record.duration_ms !== undefined ? `${record.duration_ms} ms` : null].filter(value => value !== null && value !== undefined).join(" · ")}</td></tr>)}</tbody></table>}
      </div>
    </>}
  </section>;
}
