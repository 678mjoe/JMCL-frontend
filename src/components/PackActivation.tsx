import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSettings } from "@/lib/settings";
import { readPackActivation, writePackActivation, type PackActivationScope, type PackActivationSnapshot } from "@/lib/packActivation";
import type { InstanceManifest } from "@/lib/types";

export interface PackActivationApi {
  read: typeof readPackActivation;
  write: typeof writePackActivation;
}
const nativeApi: PackActivationApi = { read: readPackActivation, write: writePackActivation };

/** Keyed scope deliberately discards unsaved edits and outstanding reads on navigation. */
export function PackActivation({ instance, api = nativeApi }: { instance: InstanceManifest; api?: PackActivationApi }) {
  const { settings } = useSettings();
  return <PackActivationEditor key={`${settings.instancesDir}\0${instance.id}\0${instance.version_id}`} scope={{instancesRoot: settings.instancesDir, instanceId: instance.id}} api={api} />;
}
function PackActivationEditor({ scope, api }: { scope: PackActivationScope; api: PackActivationApi }) {
  const { settings } = useSettings();
  const zh = settings.language === "zh";
  const [snapshot, setSnapshot] = useState<PackActivationSnapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const lock = useRef(false);
  const current = (id: number) => alive.current && request.current === id;
  async function load() {
    if (lock.current) return;
    lock.current = true;
    const id = ++request.current;
    setBusy(true); setError(false); setSaved(false); setConfirmed(false);
    try {
      const result = await api.read(scope);
      if (current(id)) { setSnapshot(result); setSelected(result.resourcePacks); }
    } catch { if (current(id)) { setSnapshot(null); setError(true); } }
    finally { lock.current = false; if (current(id)) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current++; };
  }, []);
  function edit(values: string[]) { setSelected(values); setConfirmed(false); setSaved(false); }
  function move(index: number, delta: number) {
    const values = [...selected];
    [values[index], values[index + delta]] = [values[index + delta]!, values[index]!];
    edit(values);
  }
  async function save() {
    if (!snapshot || !confirmed || lock.current) return;
    lock.current = true;
    const id = ++request.current;
    setBusy(true); setError(false); setSaved(false);
    try {
      const result = await api.write(scope, snapshot.revision, selected, true);
      if (current(id)) { setSnapshot(result); setSelected(result.resourcePacks); setSaved(true); }
    } catch {
      // Never reuse a stale approval or revision after uncertain/concurrent writes.
      if (current(id)) { setError(true); setSnapshot(null); }
    } finally { lock.current = false; if (current(id)) { setBusy(false); setConfirmed(false); } }
  }
  const dirty = !!snapshot && JSON.stringify(snapshot.resourcePacks) !== JSON.stringify(selected);
  return <Card><CardContent className="space-y-3 pt-4">
    <h2 className="font-semibold">{zh ? "资源包游戏内选择与顺序" : "In-game resource pack selection and order"}</h2>
    <p className="text-sm text-muted-foreground">{zh ? "文件已安装或启用不代表游戏内已选用。这里只修改已有 options.txt 的 resourcePacks；不修改兼容性警告列表，也不确认资源包适配当前游戏版本。" : "Installed or file-enabled does not mean selected in game. This edits resourcePacks in an existing options.txt only; it does not bypass compatibility warnings or establish pack compatibility."}</p>
    <p className="text-sm text-muted-foreground">{zh ? "从低到高排列：下方覆盖上方。内置及未知条目保留。旧版或未知配置将拒绝修改，请在游戏中设置。" : "Lowest to highest priority: later entries override earlier ones. Built-in and unknown entries are preserved. Unsupported or unknown configurations are refused; configure those in game."}</p>
    <p className="text-sm text-muted-foreground">{zh ? "必须先退出游戏。JMCL 会阻止当前跟踪的应用内操作冲突，但无法检测外部启动或 Core 断开后仍存活的游戏。保存期间请勿从其他程序启动或编辑配置。Windows 仅允许本地卷中的非链接路径；不支持的路径会被拒绝。" : "Quit the game first. JMCL blocks conflicts with actively tracked in-app operations, but cannot detect externally started games or games surviving a Core disconnect. Do not launch or edit the configuration externally while saving. Windows requires non-linked paths on a local volume; unsupported paths are refused."}</p>
    {busy && <p role="status">{zh ? "正在读取或保存…" : "Reading or saving…"}</p>}
    {error && <p role="alert">{zh ? "无法安全读取或写入配置（可能不存在、格式不支持、文件变化、路径不安全或任一 Core 请求正在运行）。未确认成功；请退出游戏并重新读取，必要时在游戏内设置。" : "Could not safely read or write configuration (missing/unsupported file, changed data, unsafe path, or any active Core request). Success is not confirmed. Quit the game and reload; configure in game if necessary."}</p>}
    {saved && <p role="status">{zh ? "选择已写入；尚未验证游戏实际加载或兼容性。" : "Selection written; actual game loading and compatibility are not verified."}</p>}
    {snapshot && <>
      <ol className="space-y-2" aria-label={zh ? "已选择资源包（低到高）" : "Selected resource packs (low to high)"}>
        {selected.map((id, index) => {
          const editable = snapshot.availableResourcePacks.includes(id);
          return <li key={id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-all text-sm">{index + 1}. {id}</span>
            {editable ? <>
              <Button size="sm" variant="outline" disabled={busy || index === 0 || !snapshot.availableResourcePacks.includes(selected[index - 1]!)} onClick={() => move(index, -1)} aria-label={`Lower priority ${id}`}>↓ {zh ? "降低" : "Lower"}</Button>
              <Button size="sm" variant="outline" disabled={busy || index === selected.length - 1 || !snapshot.availableResourcePacks.includes(selected[index + 1]!)} onClick={() => move(index, 1)} aria-label={`Higher priority ${id}`}>↑ {zh ? "提高" : "Higher"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(selected.filter(value => value !== id))} aria-label={`Deselect ${id}`}>{zh ? "取消选择" : "Deselect"}</Button>
            </> : <span className="text-xs text-muted-foreground">{zh ? "保留的内置/未知条目" : "Preserved built-in/unknown entry"}</span>}
          </li>;
        })}
      </ol>
      <div className="flex flex-wrap gap-2">{snapshot.availableResourcePacks.filter(id => !selected.includes(id)).map(id => <Button key={id} variant="outline" size="sm" disabled={busy} onClick={() => edit([...selected, id])}>{zh ? "选择" : "Select"} {id}</Button>)}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !dirty} onChange={e => setConfirmed(e.target.checked)} />{zh ? "我确认此实例的所有 Minecraft 进程已退出，保存期间不会从其他程序启动。" : "I confirm all Minecraft processes for this instance are stopped and will not start it externally while saving."}</label>
      <Button disabled={busy || !dirty || !confirmed} onClick={() => void save()}>{zh ? "保存游戏内选择" : "Save in-game selection"}</Button>
    </>}
    <Button className="ml-2" variant="outline" disabled={busy} onClick={() => void load()}>{zh ? "放弃编辑并重新读取" : "Discard edits and reload"}</Button>
  </CardContent></Card>;
}
