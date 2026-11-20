import { downloadOptions } from "@/lib/downloadOptions";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSettings } from "@/lib/settings";
import { curseForgeKeyStatus } from "@/lib/curseforge";
import { openDialog } from "@/lib/native";
import { suggestedModpackInstanceId, validModpackInstanceId } from "@/lib/modpackImport";
import { previewModpack, modpackPreviewErrorCode, type ModpackPreview, type ModpackPreviewErrorCode } from "@/lib/modpackPreview";
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
  const [previewError, setPreviewError] = useState<ModpackPreviewErrorCode | null>(null);
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
  const previewNotice = previewError === "MODPACK_PREVIEW_ARCHIVE_TOO_LARGE"
    ? say(
        "This archive is larger than 512 MiB. This version of JMCL cannot import local modpacks above that size. Choose a smaller archive.",
        "这个整合包超过了 512 MiB，当前版本无法导入这么大的本地整合包。请选择体积更小的整合包。",
      )
    : previewError === "MODPACK_PREVIEW_LIMIT"
      ? say(
          "The archive exceeds a preview limit. That alone does not mean it cannot be installed, but this dialog needs a successful preview before starting an import.",
          "这个整合包超出了预览限制。无法预览不等于无法安装，但当前需要预览成功才能从这里开始导入。",
        )
      : say(
          "Couldn't read a modpack preview from this file. Check that it is a Modrinth .mrpack or CurseForge .zip export, or choose another file.",
          "未能读取整合包预览。请确认文件是从 Modrinth 导出的 .mrpack 或从 CurseForge 导出的 .zip，或选择其他文件。",
        );
  const ready = !!preview && validModpackInstanceId(draft.id) && !picking && (preview.provider !== "curseforge" || (hasKey && !keyChecking));
  const start = () => {
    if (!ready || controller || pickingRef.current) return;
    jobs.start({ ...downloadOptions(settings), directory: settings.instancesDir, storeDirectory: settings.storeDir, id: draft.id, file: draft.file, provider: preview!.provider });
  };
  const currentRoot = !controller || controller.input.directory === settings.instancesDir;
  const openInstance = () => { if (!controller || !currentRoot) return; jobs.hide(); onOpenInstance?.(controller.input.id); };
  return (
    <Dialog open onOpenChange={open => { if (!open) jobs.hide(); }}>
      <DialogContent className="flex max-w-lg flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{say("Import modpack", "导入整合包")}</DialogTitle>
          <DialogDescription>{say("Create a new isolated instance. Existing instances are never overwritten.", "创建新的隔离实例，不覆盖已有实例。")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-(--jmcl-panel-padding) -my-1 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-(--jmcl-panel-padding) py-1">
          {controller && state ? (
            <div className="space-y-4">
              <div className="space-y-1 wrap-anywhere">
                <p className="font-medium">{controller.input.id}</p>
                <p className="font-mono text-xs text-muted-foreground">{controller.input.directory}/{controller.input.id}</p>
              </div>
              <p role="status">{modpackPhase(state.phase, zh)}</p>
              {state.installProgress && <InstallProgressView state={state.installProgress} />}
              {state.error && (
                <div role="alert" className="space-y-2 wrap-anywhere text-destructive">
                  <p>{state.error}: {modpackError(state.error, zh)}</p>
                  {state.canResume && <p>{say("Pack import succeeded. Resume only game setup; the archive will not be imported again.", "整合包导入已成功，仅恢复游戏准备，不会再次导入归档。")}</p>}
                </div>
              )}
              {state.summary && (
                <section className="space-y-1.5 rounded-md border bg-muted/35 p-3 text-sm wrap-anywhere" aria-label={say("Imported pack summary", "已导入整合包摘要")}>
                  <p className="font-medium">{state.summary.name}</p>
                  <p>Minecraft {state.summary.version_id}{state.summary.loader ? ` · ${state.summary.loader.name} ${state.summary.loader.version}` : ""}</p>
                  <p>{say("Installed pack files", "已安装整合包文件")}: {state.summary.files_installed} · {say("Skipped", "已跳过")}: {state.summary.files_skipped} · overrides: {state.summary.overrides_written}</p>
                  {state.summary.files_skipped > 0 && <p className="text-xs text-muted-foreground">{say("Skipped files may be optional or not applicable to clients. Core does not return their individual names.", "跳过的文件可能为可选项或不适用于客户端，Core 未返回逐项名称。")}</p>}
                </section>
              )}
              {(state.canResume || state.canEdit || (state.error?.startsWith("CURSEFORGE_") && onOpenSettings) || (!state.busy && onOpenInstance)) && (
                <div className="flex flex-wrap gap-2">
                  {state.canResume && <Button disabled={state.busy} onClick={() => void controller.run()}>{say("Resume game setup", "恢复游戏准备")}</Button>}
                  {state.canEdit && <Button variant="outline" onClick={jobs.edit}>{say("Edit selection and retry", "修改选择并重试")}</Button>}
                  {state.error?.startsWith("CURSEFORGE_") && onOpenSettings && <Button variant="outline" onClick={() => { jobs.hide(); onOpenSettings(); }}>{say("Open Settings", "打开设置")}</Button>}
                  {!state.busy && onOpenInstance && <Button variant="outline" disabled={!currentRoot} onClick={openInstance}>{state.phase === "success" ? say("Open instance", "打开实例") : say("Inspect instance", "检查实例")}</Button>}
                </div>
              )}
              {!currentRoot && <p className="text-muted-foreground">{say("This task belongs to a different instances directory. Switch back in Settings to open it.", "此任务属于另一个实例目录，请到设置切回后打开。")}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button variant="outline" onClick={() => void pick()} disabled={picking}>{picking ? say("Reading archive…", "读取归档…") : say("Choose archive", "选择归档")}</Button>
                {draft.file && <p className="min-w-0 flex-[1_1_10rem] font-mono text-xs wrap-anywhere text-muted-foreground">{draft.file}</p>}
              </div>
              <div role="status">
                {previewError && (
                  <div className="space-y-1 rounded-md border bg-muted/35 p-3 text-sm wrap-anywhere">
                    <p className="font-medium">{say("Preview unavailable", "无法预览整合包")}</p>
                    <p className="text-muted-foreground">{previewNotice}</p>
                  </div>
                )}
              </div>
              {preview && (
                <section aria-label={say("Installation summary", "安装摘要")} className="space-y-1.5 rounded-md border bg-muted/35 p-3 text-sm wrap-anywhere">
                  <h3 className="font-medium">{preview.name}</h3>
                  <p>{preview.provider === "modrinth" ? "Modrinth" : "CurseForge"}{preview.version ? ` · ${preview.version}` : ""}</p>
                  <p>Minecraft {preview.minecraft_version} · {preview.loader ? `${preview.loader.kind} ${preview.loader.version}` : say("Vanilla", "原版")}</p>
                  <p>{say("Declared files", "声明的文件")}: {preview.files_declared}</p>
                  <p className="text-xs text-muted-foreground">{say("Metadata preview only. Core validates the complete archive during import; download availability, total size and Java requirements are not verified here.", "此处仅预览元数据，Core 会在导入时验证完整归档；尚未验证下载可用性、总大小或 Java 要求。")}</p>
                </section>
              )}
              <div className="grid gap-2">
                <Label htmlFor="pack-instance-id">{say("New instance ID", "新实例 ID")}</Label>
                <Input id="pack-instance-id" value={draft.id} disabled={picking} onChange={event => jobs.registry.setDraft(settings.instancesDir, settings.storeDir, { ...draft, id: event.target.value })} />
                <p className="text-xs text-muted-foreground">{say("Suggested from the pack name; you can change it. Use 1–64 lowercase letters, digits, dots, underscores or hyphens. Reserved names are not allowed.", "已根据整合包名称建议 ID，可自行修改。使用 1–64 位小写字母、数字、点、下划线或连字符，不可使用保留名称。")}</p>
              </div>
              <dl className="space-y-3 border-t pt-4">
                <div className="space-y-1">
                  <dt className="font-medium">{say("Instance location", "实例位置")}</dt>
                  <dd className="font-mono text-xs wrap-anywhere text-muted-foreground">{settings.instancesDir}/{draft.id || "…"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium">{say("Shared file store", "共享文件存储")}</dt>
                  <dd className="font-mono text-xs wrap-anywhere text-muted-foreground">{settings.storeDir}</dd>
                </div>
              </dl>
              {preview?.provider === "curseforge" && (
                <div className="space-y-2 rounded-md border bg-muted/35 p-3">
                  <p role="status">{keyChecking ? say("Checking saved key…", "检查已保存密钥…") : hasKey ? say("Uses your saved OS credential-store key. Author download restrictions remain enforced.", "使用系统凭据库中已保存的密钥，仍遵守作者下载限制。") : say("A saved CurseForge key is required. Open Settings, save it, then return; your selection is kept.", "需要已保存的 CurseForge 密钥。请打开设置保存后返回，所选内容会保留。")}</p>
                  {keyError && <p role="alert" className="text-destructive">{say("Cannot access the native credential store.", "无法访问原生凭据库。")}</p>}
                  <div className="flex flex-wrap gap-2">
                    {onOpenSettings && <Button variant="outline" size="sm" onClick={() => { jobs.hide(); onOpenSettings(); }}>{say("Open Settings", "打开设置")}</Button>}
                    <Button variant="outline" size="sm" disabled={keyChecking} onClick={() => setKeyRevision(value => value + 1)}>{say("Refresh key status", "刷新密钥状态")}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">{say("You can close this view and keep installing while the app stays open. Closing a view is not cancellation; stopping an active install is not supported yet.", "应用保持打开时，可关闭此窗口让安装在后台继续。关闭窗口不等于取消，目前不支持停止正在执行的安装。")}</p>
        </div>
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={jobs.hide}>{state?.busy ? say("Continue in background", "在后台继续") : say("Close", "关闭")}</Button>
          {!controller && <Button onClick={start} disabled={!ready}>{say("Confirm and install", "确认并安装")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
