import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSettings } from "@/lib/settings";
import { curseForgeKeyStatus } from "@/lib/curseforge";
import { openDialog } from "@/lib/native";
import { suggestedModpackInstanceId, validModpackInstanceId } from "@/lib/modpackImport";
import { previewModpack, modpackPreviewErrorCode, type ModpackPreview } from "@/lib/modpackPreview";
import { useModpackTasks } from "@/lib/modpackTasks";
import { modpackError, modpackPhase } from "@/lib/modpackMessages";
import { InstallProgressView } from "./InstallProgressView";

interface Props {
  onOpenSettings?: () => void;
  onOpenInstance?: (id: string) => void;
  pickArchive?: () => Promise<string | string[] | null>;
  inspectArchive?: (file: string) => Promise<ModpackPreview>;
  keyStatus?: () => Promise<boolean>;
}
const chooseArchive = () => openDialog({ multiple: false, filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }] });
export function ModpackImportDialog(props: Props) {
  const jobs = useModpackTasks();
  const { settings } = useSettings();
  return jobs.open ? <ImportForm key={`${settings.instancesDir}\0${settings.storeDir}\0${jobs.selected ?? "draft"}`} {...props} /> : null;
}
function ImportForm({ onOpenSettings, onOpenInstance, pickArchive = chooseArchive, inspectArchive = previewModpack, keyStatus = curseForgeKeyStatus }: Props) {
  const { settings } = useSettings();
  const jobs = useModpackTasks();
  const zh = settings.language === "zh";
  const say = (en: string, cn: string) => zh ? cn : en;
  const task = jobs.registry.list().find(task => task.key === jobs.selected);
  const controller = task?.controller;
  const state = controller?.getSnapshot();
  const draft = jobs.registry.draft(settings.instancesDir, settings.storeDir);
  const preview = draft.preview;
  const [hasKey, setHasKey] = useState(false);
  const [keyChecking, setKeyChecking] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [keyRevision, setKeyRevision] = useState(0);
  const [picking, setPicking] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const alive = useRef(true);
  const pickingRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (preview?.provider !== "curseforge" || controller) return;
    let active = true; setHasKey(false); setKeyChecking(true); setKeyError(false);
    void keyStatus().then(value => { if (active) setHasKey(value); }).catch(() => { if (active) setKeyError(true); }).finally(() => { if (active) setKeyChecking(false); });
    return () => { active = false; };
  }, [preview?.provider, controller, keyStatus, keyRevision]);
  const pick = async () => {
    if (pickingRef.current || controller) return;
    pickingRef.current = true; setPicking(true); setPreviewError(null);
    try {
      const selected = await pickArchive();
      if (!alive.current || typeof selected !== "string") return;
      // Remove stale metadata before reading another file. A failed preview cannot
      // submit the previous file under the newly displayed selection.
      jobs.registry.setDraft(settings.instancesDir, settings.storeDir, { ...draft, file: selected, preview: null });
      const result = await inspectArchive(selected);
      if (!alive.current) return;
      jobs.registry.setDraft(settings.instancesDir, settings.storeDir, { file: selected, preview: result, id: draft.id || suggestedModpackInstanceId(result.name) });
    } catch (error) {
      if (alive.current) {
        setPreviewError(modpackPreviewErrorCode(error));
      }
    } finally { pickingRef.current = false; if (alive.current) setPicking(false); }
  };
  const ready = !!preview && validModpackInstanceId(draft.id) && !picking && (preview.provider !== "curseforge" || (hasKey && !keyChecking));
  const start = () => {
    if (!ready || controller || pickingRef.current) return;
    jobs.start({ directory: settings.instancesDir, storeDirectory: settings.storeDir, id: draft.id, file: draft.file, provider: preview!.provider });
  };
  const currentRoot = !controller || controller.input.directory === settings.instancesDir;
  const openInstance = () => { if (!controller || !currentRoot) return; jobs.hide(); onOpenInstance?.(controller.input.id); };
  return <Dialog open onOpenChange={open => { if (!open) jobs.hide(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{say("Import modpack", "导入整合包")}</DialogTitle><DialogDescription>{say("Create a new isolated instance. Existing instances are never overwritten.", "创建新的隔离实例，不覆盖已有实例。")}</DialogDescription></DialogHeader>
      {!controller ? <div className="space-y-4">
        <Button variant="outline" onClick={() => void pick()} disabled={picking}>{picking ? say("Reading archive…", "读取归档…") : say("Choose archive", "选择归档")}</Button>
        {draft.file && <p className="break-all text-sm">{draft.file}</p>}
        {previewError && <p role="alert">{previewError}: {say("Could not preview this archive within the safe inspection limits. Choose a supported local .mrpack or CurseForge .zip file. No installation was started.", "无法在安全检查限制内预览归档，请选择支持的本地 .mrpack 或 CurseForge .zip 文件。尚未开始安装。")}</p>}
        {preview && <section aria-label={say("Installation summary", "安装摘要")} className="space-y-2 rounded-md border p-3 text-sm">
          <h3 className="font-medium break-words">{preview.name}</h3>
          <p>{preview.provider === "modrinth" ? "Modrinth" : "CurseForge"}{preview.version ? ` · ${preview.version}` : ""}</p>
          <p>Minecraft {preview.minecraft_version} · {preview.loader ? `${preview.loader.kind} ${preview.loader.version}` : say("Vanilla", "原版")}</p>
          <p>{say("Declared files", "声明的文件")}: {preview.files_declared}</p>
          <p className="text-muted-foreground">{say("Metadata preview only. Core validates the complete archive during import; download availability, total size and Java requirements are not verified here.", "此处仅预览元数据，Core 会在导入时验证完整归档；尚未验证下载可用性、总大小或 Java 要求。")}</p>
        </section>}
        <div className="space-y-2"><Label htmlFor="pack-instance-id">{say("New instance ID", "新实例 ID")}</Label><Input id="pack-instance-id" value={draft.id} disabled={picking} onChange={event => jobs.registry.setDraft(settings.instancesDir, settings.storeDir, { ...draft, id: event.target.value })} />
          <p className="text-xs text-muted-foreground">{say("Suggested from the pack name; you can change it. Use 1–64 lowercase letters, digits, dots, underscores or hyphens. Reserved names are not allowed.", "已根据整合包名称建议 ID，可自行修改。使用 1–64 位小写字母、数字、点、下划线或连字符，不可使用保留名称。")}</p></div>
        <dl className="text-sm space-y-1"><dt>{say("Instance location", "实例位置")}</dt><dd className="break-all">{settings.instancesDir}/{draft.id || "…"}</dd><dt>{say("Shared file store", "共享文件存储")}</dt><dd className="break-all">{settings.storeDir}</dd></dl>
        {preview?.provider === "curseforge" && <div className="space-y-2 rounded-md border p-3"><p role="status">{keyChecking ? say("Checking saved key…", "检查已保存密钥…") : hasKey ? say("Uses your saved OS credential-store key. Author download restrictions remain enforced.", "使用系统凭据库中已保存的密钥，仍遵守作者下载限制。") : say("A saved CurseForge key is required. Open Settings, save it, then return; your selection is kept.", "需要已保存的 CurseForge 密钥。请打开设置保存后返回，所选内容会保留。")}</p>{keyError && <p role="alert">{say("Cannot access the native credential store.", "无法访问原生凭据库。")}</p>}
          {onOpenSettings && <Button variant="outline" onClick={() => { jobs.hide(); onOpenSettings(); }}>{say("Open Settings", "打开设置")}</Button>}
          <Button variant="outline" disabled={keyChecking} onClick={() => setKeyRevision(value => value + 1)}>{say("Refresh key status", "刷新密钥状态")}</Button>
        </div>}
        <Button onClick={start} disabled={!ready}>{say("Confirm and install", "确认并安装")}</Button>
      </div> : <div className="space-y-3">
        <p className="font-medium break-all">{controller.input.id}</p><p className="text-xs break-all text-muted-foreground">{controller.input.directory}/{controller.input.id}</p>
        <p role="status">{modpackPhase(state!.phase, zh)}</p>
        {state!.installProgress && <InstallProgressView state={state!.installProgress} />}
        {state!.error && <div role="alert" className="space-y-2"><p>{state!.error}: {modpackError(state!.error, zh)}</p>{state!.canResume && <p>{say("Pack import succeeded. Resume only game setup; the archive will not be imported again.", "整合包导入已成功，仅恢复游戏准备，不会再次导入归档。")}</p>}</div>}
        {state!.summary && <section className="rounded-md border p-3 text-sm space-y-1" aria-label={say("Imported pack summary", "已导入整合包摘要")}>
          <p className="font-medium">{state!.summary.name}</p><p>Minecraft {state!.summary.version_id}{state!.summary.loader ? ` · ${state!.summary.loader.name} ${state!.summary.loader.version}` : ""}</p>
          <p>{say("Installed pack files", "已安装整合包文件")}: {state!.summary.files_installed} · {say("Skipped", "已跳过")}: {state!.summary.files_skipped} · overrides: {state!.summary.overrides_written}</p>
          {state!.summary.files_skipped > 0 && <p>{say("Skipped files may be optional or not applicable to clients. Core does not return their individual names.", "跳过的文件可能为可选项或不适用于客户端，Core 未返回逐项名称。")}</p>}
        </section>}
        {state!.canResume && <Button disabled={state!.busy} onClick={() => void controller.run()}>{say("Resume game setup", "恢复游戏准备")}</Button>}
        {state!.canEdit && <Button variant="outline" onClick={jobs.edit}>{say("Edit selection and retry", "修改选择并重试")}</Button>}
        {state!.error?.startsWith("CURSEFORGE_") && onOpenSettings && <Button variant="outline" onClick={() => { jobs.hide(); onOpenSettings(); }}>{say("Open Settings", "打开设置")}</Button>}
        {!state!.busy && onOpenInstance && <Button variant="outline" disabled={!currentRoot} onClick={openInstance}>{state!.phase === "success" ? say("Open instance", "打开实例") : say("Inspect instance", "检查实例")}</Button>}
        {!currentRoot && <p>{say("This task belongs to a different instances directory. Switch back in Settings to open it.", "此任务属于另一个实例目录，请到设置切回后打开。")}</p>}
      </div>}
      <p className="text-xs text-muted-foreground">{say("You can close this view and keep installing while the app stays open. Closing a view is not cancellation; stopping an active install is not supported yet.", "应用保持打开时，可关闭此窗口让安装在后台继续。关闭窗口不等于取消，目前不支持停止正在执行的安装。")}</p>
      <Button variant="outline" onClick={jobs.hide}>{state?.busy ? say("Continue in background", "在后台继续") : say("Close", "关闭")}</Button>
    </DialogContent>
  </Dialog>;
}
