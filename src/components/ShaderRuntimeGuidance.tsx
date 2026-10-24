import { useEffect, useRef, useState } from "react";
import { ContentSearchDialog, loaderNameOf } from "./ContentSearchDialog";
import { Button } from "./ui/button";
import { useSettings } from "@/lib/settings";
import { useLauncher } from "@/lib/launcher";
import { checkShaderRuntimes, installedRuntimeMatch, type RuntimeCandidate } from "@/lib/shaderRuntime";
import type { ContentEntry, InstanceManifest } from "@/lib/types";

export function ShaderRuntimeGuidance({ instance }: { instance: InstanceManifest }) {
  const { settings } = useSettings();
  return <RuntimeGuidance key={`${settings.instancesDir}\0${instance.id}\0${instance.version_id}\0${loaderNameOf(instance)}`} instance={instance} />;
}

function RuntimeGuidance({ instance }: { instance: InstanceManifest }) {
  const { settings } = useSettings();
  const { session } = useLauncher();
  const zh = settings.language === "zh";
  const loader = loaderNameOf(instance);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [candidates, setCandidates] = useState<RuntimeCandidate[] | null>(null);
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [selected, setSelected] = useState<RuntimeCandidate | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const check = async () => {
    if (locked.current || !loader || !session) return;
    locked.current = true;
    const current = ++generation.current;
    setBusy(true); setFailed(false); setCandidates(null); setSelected(null);
    try {
      const [matches, installed] = await Promise.all([
        checkShaderRuntimes(instance.version_id, loader),
        session.contentList("mods", `${settings.instancesDir}/${instance.id}/.minecraft`),
      ]);
      if (current !== generation.current) return;
      setCandidates(matches); setEntries(installed.entries);
    } catch {
      if (current === generation.current) setFailed(true);
    } finally {
      if (current === generation.current) { locked.current = false; setBusy(false); }
    }
  };
  const cancel = () => { generation.current++; locked.current = false; setBusy(false); setCandidates(null); setFailed(false); };
  const statuses = zh ? {
    matching: "已安装版本的目录元数据匹配", disabled: "已安装但文件已禁用", unverified: "已安装版本未获当前元数据确认", absent: "未发现已登记的 Modrinth 安装",
  } : {
    matching: "Installed version matches catalog metadata", disabled: "Installed but file-disabled", unverified: "Installed version not verified by current metadata", absent: "No registered Modrinth installation found",
  };
  return <section className="space-y-3 rounded-md border p-4" aria-label={zh ? "光影运行时指引" : "Shader runtime guidance"}>
    <h3 className="font-medium">{zh ? "光影运行时指引" : "Shader runtime guidance"}</h3>
    <p className="text-sm">{zh ? "文件已安装 ≠ 游戏内已启用 ≠ 运行时兼容。仅检查所选 Minecraft 版本和加载器的目录元数据；依赖、显卡及实际运行仍需另行验证。" : "Installed files ≠ enabled in game ≠ runtime compatible. Check catalog metadata for this exact Minecraft version and loader; dependencies, GPU support and actual execution still need verification."}</p>
    <p className="text-sm">{zh ? "仅凭文件名、登记记录或旧配置无法证明实际加载的运行时。单独的配置编辑器也不证明兼容性；不支持的运行时请在其游戏内光影菜单选择光影或关闭。" : "Filenames, registry entries or old config cannot prove which runtime is actually loaded. The separate configuration editor does not establish compatibility either; for unsupported runtimes, select a shader or turn shaders off in that runtime’s in-game shader menu."}</p>
    <p className="text-sm">{instance.version_id} · {loader ?? "Vanilla"}</p>
    {!loader && <p role="status">{zh ? "当前实例没有受支持的 Mod 加载器。请先通过实例创建流程选择加载器；不推测任何版本组合。" : "This instance has no supported mod loader. Select a loader through instance creation first; no version combination is assumed."}</p>}
    <p className="text-xs text-muted-foreground">{zh ? "检查 Iris 和 Oculus 的项目版本，而非按加载器猜测。未知运行时和 OptiFine 不在此目录验证范围内；请按其官方说明在游戏中选择光影。不会自动安装或下载。" : "Checks Iris and Oculus project versions, not a loader-based guess. Unknown runtimes and OptiFine are outside this catalog verification; use their official instructions and in-game shader selection. No automatic installs or downloads."}</p>
    <Button variant="outline" disabled={!loader || !session || busy} onClick={() => void check()}>{zh ? "检查运行时版本" : "Check runtime versions"}</Button>
    {busy && <Button variant="ghost" onClick={cancel}>{zh ? "取消检查" : "Cancel check"}</Button>}
    {failed && <p role="alert">{zh ? "无法验证目录或已安装文件。没有据此宣称兼容；请重试。" : "Could not verify catalog or installed files. Compatibility remains unverified; retry the check."}</p>}
    {candidates && <ul className="space-y-3">{candidates.map(candidate => <li key={candidate.project.project_id}>
      <p>{candidate.project.title} — {candidate.versions.length ? (zh ? "目录中有匹配版本" : "Matching catalog versions available") : (zh ? "目录未返回匹配版本；不代表所有外部版本均不兼容" : "No matching catalog versions returned; this does not prove all external releases incompatible")}</p>
      <p className="text-xs">{statuses[installedRuntimeMatch(candidate, entries)]}</p>
      <Button size="sm" variant="outline" disabled={!candidate.versions.length} onClick={() => setSelected(candidate)}>{zh ? `选择 ${candidate.project.title} 版本…` : `Choose ${candidate.project.title} version…`}</Button>
    </li>)}</ul>}
    {selected && <ContentSearchDialog kind="mods" instance={instance} entries={entries} initialProject={selected.project} open onOpenChange={open => { if (!open) setSelected(null); }} onChanged={() => { setSelected(null); void check(); }} />}
  </section>;
}
