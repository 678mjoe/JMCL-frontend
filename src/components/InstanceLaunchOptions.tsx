import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/lib/settings";
import { instanceMutationKey } from "@/lib/instanceCoordinator";
import { launchOptionsDraft, launchOptionsFor, parseLaunchOptionsDraft, withLaunchOptions, type SavedLaunchOptions } from "@/lib/launchOptions";
import type { InstanceManifest } from "@/lib/types";

type Preview = (options: SavedLaunchOptions) => Promise<{ launch: { redacted_argv: string[] } }>;
export function InstanceLaunchOptions({ instance, onPreview }: { instance: InstanceManifest; onPreview?: Preview }) {
  const { settings } = useSettings();
  const scope = JSON.stringify([instanceMutationKey(settings.instancesDir, instance.id), settings.storeDir, settings.javaOverrides[instance.id], instance.version_id, instance.source, instance.fabric_loader, instance.neoforge_version, instance.forge_version, settings.playerName, settings.activeAccountId]);
  // Remount before another scope can save old draft state, including same-frame navigation.
  return <Editor key={scope} instanceId={instance.id} onPreview={onPreview} />;
}
function Editor({ instanceId, onPreview }: { instanceId: string; onPreview?: Preview }) {
  const { settings, update } = useSettings();
  const zh = settings.language === "zh";
  const saved = launchOptionsFor(settings.launchOptions, settings.instancesDir, instanceId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => launchOptionsDraft(saved));
  const [preview, setPreview] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const invalidate = () => { revision.current++; setPreview(null); setError(false); setPending(false); };
  const parsed = parseLaunchOptionsDraft(draft);
  const change = (patch: Partial<typeof draft>) => { invalidate(); setDraft(d => ({ ...d, ...patch })); };
  const open = () => { invalidate(); setDraft(launchOptionsDraft(saved)); setEditing(true); };
  const cancel = () => { invalidate(); setDraft(launchOptionsDraft(saved)); setEditing(false); };
  const save = () => {
    if (!parsed) return;
    update({ launchOptions: withLaunchOptions(settings.launchOptions, settings.instancesDir, instanceId, parsed) });
    invalidate(); setEditing(false);
  };
  const showPreview = async () => {
    if (!parsed || !onPreview || pending) return;
    const current = ++revision.current; setPending(true); setPreview(null); setError(false);
    try {
      const result = await onPreview(parsed);
      if (current === revision.current) {
        if (!Array.isArray(result.launch?.redacted_argv) || !result.launch.redacted_argv.every(a => typeof a === "string")) throw new Error();
        setPreview(result.launch.redacted_argv);
      }
    } catch { if (current === revision.current) setError(true); }
    finally { if (current === revision.current) setPending(false); }
  };
  return <Card><CardHeader><CardTitle>{zh ? "高级启动选项" : "Advanced launch options"}</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">{zh ? "仅保存到此目录下的此实例。不会启动游戏。参数保存在本机设置中，请勿填入密码或令牌。" : "Saved only for this instance in this root directory. Editing never launches the game. Arguments are stored in local settings; do not enter passwords or tokens."}</p>
    {!editing ? <Button variant="outline" onClick={open}>{zh ? "编辑启动选项" : "Edit launch options"}</Button> : <>
      <p className="text-sm text-muted-foreground">{zh ? "每项是一个 JSON 字符串数组；每个字符串为一个原样参数，不解析 shell。保留顺序、重复项及空字符串；重复选项由 Java/游戏解释。" : 'Each field is a JSON string array. Each string is one literal argument, not shell syntax. Order, duplicates and empty strings are preserved; Java/the game interpret duplicate flags.'}</p>
      <label className="block text-sm">{zh ? "额外 JVM 参数（JSON 数组）" : "Extra JVM arguments (JSON array)"}<textarea aria-label="JVM arguments" className="mt-1 w-full rounded border p-2 font-mono text-xs" rows={4} value={draft.jvm} onChange={e => change({ jvm: e.target.value })} /></label>
      <label className="block text-sm">{zh ? "额外游戏参数（JSON 数组）" : "Extra game arguments (JSON array)"}<textarea aria-label="Game arguments" className="mt-1 w-full rounded border p-2 font-mono text-xs" rows={4} value={draft.game} onChange={e => change({ game: e.target.value })} /></label>
      <p className="text-sm">{zh ? "分辨率：两项均留空使用默认值；否则填写 1–4294967295 的整数。" : "Resolution: leave both blank for defaults, or enter integers from 1 to 4294967295."}</p>
      <div className="flex gap-3"><label>{zh ? "宽度" : "Width"}<input aria-label="Width" className="ml-2 w-28 rounded border p-1" inputMode="numeric" value={draft.width} onChange={e => change({ width: e.target.value })} /></label><label>{zh ? "高度" : "Height"}<input aria-label="Height" className="ml-2 w-28 rounded border p-1" inputMode="numeric" value={draft.height} onChange={e => change({ height: e.target.value })} /></label></div>
      <label className="block"><input type="checkbox" checked={draft.demo} onChange={e => change({ demo: e.target.checked })} /> {zh ? "试玩模式" : "Demo mode"}</label>
      <label className="block"><input type="checkbox" checked={draft.defaults} onChange={e => change({ defaults: e.target.checked })} /> {zh ? "保留 Core 默认用户 JVM 参数" : "Include Core default user JVM arguments"}</label>
      {!parsed && <p role="alert" className="text-sm text-destructive">{zh ? "请输入有效 JSON 字符串数组（禁止 NUL）和成对的正整数分辨率。" : "Enter valid JSON string arrays (no NUL) and paired positive integer resolution values."}</p>}
      <div className="flex gap-2"><Button disabled={!parsed} onClick={save}>{zh ? "保存启动选项" : "Save launch options"}</Button><Button variant="outline" onClick={cancel}>{zh ? "取消" : "Cancel"}</Button>{onPreview && <Button variant="outline" disabled={!parsed || pending} onClick={() => void showPreview()}>{zh ? "预览脱敏启动参数" : "Preview redacted launch arguments"}</Button>}</div>
      {error && <p role="alert">{zh ? "预览失败。请检查安装和 Java 配置后重试。" : "Preview failed. Check installation and Java settings, then retry."}</p>}
      {preview && <><p className="text-sm">{zh ? "Core 脱敏预览（不保存、不启动）；可能解析元数据，但不会安装 Java。`.jmcl-preview-natives` 是占位目录，实际启动会创建动态目录。自定义参数可能包含未识别的敏感内容。" : "Core-redacted preview (not saved or launched). Metadata may be resolved, but Java is not installed. `.jmcl-preview-natives` is a placeholder; execution creates a dynamic natives directory. Custom arguments may contain unrecognized sensitive content."}</p><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview, null, 2)}</pre></>}
    </>}
  </CardContent></Card>;
}
