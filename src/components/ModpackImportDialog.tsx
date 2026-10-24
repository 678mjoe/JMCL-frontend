import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLauncher } from "@/lib/launcher";
import { useSettings } from "@/lib/settings";
import { openDialog } from "@/lib/native";
import { ModpackImportController, validModpackInstanceId } from "@/lib/modpackImport";

interface Props { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void; pickArchive?: () => Promise<string | string[] | null> }
const chooseArchive = () => openDialog({ multiple: false, filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }] });
const empty = { phase: "idle", busy: false, error: null, progress: null, canResume: false, instance: null } as const;
const noSubscribe = () => () => {};
const noSnapshot = () => empty;
export function ModpackImportDialog(props: Props) {
  const { settings } = useSettings();
  return props.open ? <ImportForm key={`${settings.instancesDir}\0${settings.storeDir}`} {...props} /> : null;
}
function ImportForm({ onOpenChange, onImported, pickArchive = chooseArchive }: Props) {
  const { settings } = useSettings();
  const { openSession } = useLauncher();
  const zh = settings.language === "zh";
  const say = (en: string, cn: string) => zh ? cn : en;
  const [id, setId] = useState("");
  const [file, setFile] = useState("");
  const [provider, setProvider] = useState("modrinth");
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState(false);
  const [controller, setController] = useState<ModpackImportController | null>(null);
  const owned = useRef<ModpackImportController | null>(null);
  const alive = useRef(true);
  const pickingRef = useRef(false);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? noSnapshot);
  const notified = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; owned.current?.dispose(); }; }, []);
  useEffect(() => {
    if ((state.phase === "success" || state.phase === "error") && !state.busy && !notified.current) {
      notified.current = true; onImported();
    }
  }, [state.phase, state.busy, onImported]);
  const pick = async () => {
    if (pickingRef.current || owned.current) return;
    pickingRef.current = true; setPicking(true); setPickerError(false);
    try {
      const selected = await pickArchive();
      if (alive.current && typeof selected === "string") setFile(selected);
    } catch { if (alive.current) setPickerError(true); }
    finally { pickingRef.current = false; if (alive.current) setPicking(false); }
  };
  const start = () => {
    if (owned.current || pickingRef.current || provider !== "modrinth" || !file || !validModpackInstanceId(id)) return;
    const next = new ModpackImportController({ directory: settings.instancesDir, storeDirectory: settings.storeDir, id, file }, openSession);
    owned.current = next; setController(next); void next.run();
  };
  const close = () => { if (!owned.current?.getSnapshot().busy) onOpenChange(false); };
  const errors: Record<string, string> = {
    INSTANCE_BUSY: state.canResume ? say("This instance is busy. No new setup request was submitted; wait for the other operation to finish, then resume game setup.", "此实例正忙，尚未提交新的游戏准备请求；请等待其他操作结束后恢复游戏准备。") : say("This instance is busy with another operation. The archive was not submitted. Wait for that operation to finish, then close and retry the import.", "此实例正在执行其他操作，归档尚未提交。请等待该操作结束，然后关闭并重新导入。"),
    INSTANCE_EXISTS: say("That instance ID already exists. Nothing was overwritten; close and choose a new ID.", "实例 ID 已存在，未覆盖任何内容；请关闭并使用新的 ID。"),
    INVALID_PARAMS: say("Invalid archive or parameters. CurseForge packs require an API key and are not supported in this batch.", "归档或参数无效。CurseForge 整合包需要 API key，本批次尚不支持。"),
    UNKNOWN_MODPACK_FORMAT: say("This archive is not a recognized modpack.", "此归档不是可识别的整合包。"),
    UNSUPPORTED_MODPACK_FORMAT: say("This modpack format version is unsupported.", "不支持此整合包格式版本。"),
    UNSUPPORTED_LOADER: say("This pack uses an unsupported loader.", "此整合包使用不支持的加载器。"),
    LOADER_CONFLICT: say("This pack declares conflicting loaders.", "此整合包声明了冲突的加载器。"),
    MODPACK_NOT_FOUND: say("The selected archive no longer exists.", "所选归档已不存在。"),
    UNSAFE_MODPACK: say("Core rejected unsafe paths in the archive.", "Core 拒绝了归档中的不安全路径。"),
    DOWNLOAD_UNAVAILABLE: say("A pack file is unavailable for third-party download.", "整合包文件不允许第三方下载。"),
  };
  const phaseNames: Record<string, string> = {
    checking: say("Checking instance ID", "检查实例 ID"), archive: say("Importing archive", "正在导入归档"), manifest: say("Reading imported instance", "读取导入的实例"), install: say("Installing game files", "安装游戏文件"), prepare: say("Preparing game", "准备游戏"), success: say("Import and game preparation completed.", "导入和游戏准备完成。"),
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent showCloseButton={!state.busy} className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{say("Import modpack", "导入整合包")}</DialogTitle><DialogDescription>{say("Creates a new isolated instance, then downloads and prepares its game files. Existing instances are never overwritten.", "创建新的隔离实例，然后下载和准备游戏文件，不覆盖已有实例。")}</DialogDescription></DialogHeader>
      <Label htmlFor="pack-provider">{say("Archive provider", "归档来源")}</Label>
      <select id="pack-provider" value={provider} disabled={!!controller || picking} onChange={(event) => setProvider(event.target.value)} className="rounded border p-2"><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select>
      {provider === "curseforge" ? <p role="status">{say("CurseForge import is blocked until API-key support is implemented. No key is requested or stored here.", "CurseForge 导入暂不可用，需等待 API key 支持。此处不收集或保存密钥。")}</p> : <>
        <Label htmlFor="pack-instance-id">{say("New instance ID", "新实例 ID")}</Label><Input id="pack-instance-id" value={id} disabled={!!controller} onChange={(event) => setId(event.target.value)} />
        <p className="text-xs text-muted-foreground">{say("1–64 lowercase letters, digits, dots, underscores or hyphens; start with a letter or digit. Reserved Windows names are not allowed.", "1–64 位小写字母、数字、点、下划线或连字符，以字母或数字开头，不可使用 Windows 保留名称。")}</p>
        <Button variant="outline" onClick={() => void pick()} disabled={!!controller || picking}>{say("Choose archive", "选择归档")}</Button>
        {file && <p className="break-all text-sm">{file}</p>}
        {pickerError && <p role="alert">{say("Could not open the file picker. Try choosing the archive again.", "无法打开文件选择器，请重试。")}</p>}
        <p className="text-sm text-muted-foreground">{say("Core detects the format from the archive contents; renaming a CurseForge archive does not bypass its API-key requirement. Downloads cannot be cancelled once submitted.", "Core 依据归档内容识别格式；重命名不能绕过 CurseForge API key 要求。提交后的下载不可取消。")}</p>
        {phaseNames[state.phase] && <p role="status">{phaseNames[state.phase]}</p>}
        {state.progress && <p role="status">{state.progress.files} / {state.progress.total} {say("files", "文件")} · {state.progress.bytes} / {state.progress.bytesTotal} bytes</p>}
        {state.error && <div role="alert"><p>{state.error}: {errors[state.error] ?? say("The operation failed. Check the instance list before taking another action.", "操作失败，请先检查实例列表再进行下一步操作。")}</p><p>{state.error === "INSTANCE_BUSY" ? "" : state.canResume ? say("Archive import succeeded. Resume only game installation/preparation; the archive will not be imported again.", "归档导入已成功；仅恢复游戏安装/准备，不会再次导入归档。") : say("Archive import will not be repeated automatically. If the connection was interrupted, its outcome is unknown; inspect the instance before starting a new import.", "不会自动重复导入归档。若连接中断，结果可能未知；开始新导入前请检查实例。")}</p></div>}
        {!controller && <Button onClick={start} disabled={!file || !validModpackInstanceId(id) || picking}>{say("Import into new instance", "导入到新实例")}</Button>}
        {state.canResume && <Button onClick={() => { notified.current = false; void controller?.run(); }} disabled={state.busy}>{say("Resume game setup", "恢复游戏准备")}</Button>}
      </>}
      <Button variant="outline" onClick={close} disabled={state.busy}>{say("Close", "关闭")}</Button>
    </DialogContent>
  </Dialog>;
}
