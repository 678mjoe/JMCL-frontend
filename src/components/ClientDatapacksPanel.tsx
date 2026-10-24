import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useClientDatapacks } from "@/lib/clientDatapacks";
import type { ModrinthProject, ModrinthVersion } from "@/lib/modrinth";
import { searchDatapackProjects, datapackProjectVersions } from "@/lib/clientDatapackCatalog";
import type { InstanceManifest, WorldEntry } from "@/lib/types";

type Props = { instance: InstanceManifest; world: WorldEntry; directory: string };
const copy = {
  title: ["World datapacks", "世界数据包"],
  scope: ["Datapacks belong only to this selected world. Restored packs may need adoption. Directory-shaped packs are not managed.", "数据包仅属于所选世界；恢复存档后可能需要重新接管。目录形式的数据包不纳入管理。"],
  load: ["Load / refresh content", "加载／刷新内容"], cancel: ["Cancel / clear selection", "取消／清除选择"],
  stopped: ["Load the world and close Minecraft before changing datapacks.", "修改数据包前请加载世界状态并关闭 Minecraft。"],
  pending: ["Operation in progress…", "操作进行中…"], done: ["Operation completed.", "操作已完成。"],
  failed: ["Operation failed. Refresh to inspect the result before deciding what to retry.", "操作失败。请先刷新检查结果，再决定是否重试。"], refreshFailed: ["Content or authoritative status refresh failed.", "内容或权威状态刷新失败。"],
  lockedError: ["Close Minecraft, then refresh the world lock before retrying.", "请关闭 Minecraft，然后刷新世界锁定状态再重试。"],
  missingError: ["This world no longer exists. Close this panel and refresh the world list.", "此世界已不存在。请关闭此面板并刷新世界列表。"],
  versionError: ["Choose a compatible datapack version for this Minecraft version.", "请选择适配此 Minecraft 版本的数据包版本。"],
  conflictError: ["Refresh the registry and resolve the conflicting content before retrying.", "请刷新注册表并解决内容冲突后再重试。"],
  busyError: ["Another operation is changing this instance. Wait for it to finish, then refresh.", "另一个操作正在修改此实例。请等待完成后刷新。"],
  search: ["Search Modrinth", "搜索 Modrinth"], query: ["Search compatible datapacks", "搜索兼容数据包"],
  loading: ["Loading catalog…", "正在加载目录…"], catalogError: ["Catalog request failed. Change the search or reopen to retry.", "目录请求失败，请更改搜索词或重新打开以重试。"],
  noProjects: ["No matching projects.", "没有匹配的项目。"], noVersions: ["No compatible versions for this game.", "没有适配此游戏的版本。"],
  back: ["Back to search", "返回搜索"], versions: ["Choose version", "选择版本"], install: ["Install", "安装"], switchVersion: ["Switch version", "切换版本"], current: ["Installed version", "已安装版本"],
  empty: ["No managed content.", "没有已管理内容。"], enabled: ["Enabled", "已启用"], disabled: ["Disabled", "已禁用"], enable: ["Enable", "启用"], disable: ["Disable", "禁用"],
  remove: ["Remove", "删除"], confirm: ["Confirm removal", "确认删除"], confirmInput: ["Type file name to confirm removal", "输入文件名确认删除"],
  removeHint: ["Remove this world link only. Shared store objects remain for later GC.", "仅删除此世界中的链接；共享存储对象留待后续 GC。"],
  unmanaged: ["Unmanaged files", "未接管文件"], adopt: ["Adopt unmanaged files", "接管未管理文件"], manual: ["Manual", "手动"],
  catalogHint: ["Compatible game versions only. Core performs final validation. CurseForge is not available here yet.", "仅显示兼容游戏的版本，Core 执行最终校验。此处暂不支持 CurseForge。"],
  cancelHint: ["Cancellation closes this request; an interrupted change may already have completed. Refresh before retrying.", "取消将关闭此请求；被中断的修改可能已经完成。重试前请刷新。"],
} as const;
type CopyKey = keyof typeof copy;
const fieldClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60";
function useCopy() { const { settings } = useSettings(); return (key: CopyKey) => copy[key][settings.language === "zh" ? 1 : 0]; }
export function ClientDatapacksPanel(props: Props) {
  const { settings } = useSettings();
  return <ContentControls key={JSON.stringify([props.directory, props.world.name, props.instance.version_id, settings.storeDir])} {...props} />;
}
function ContentControls({ instance, world, directory }: Props) {
  const t = useCopy();
  const { settings } = useSettings();
  const { snapshot, load, install, setVersion, toggle, remove, adopt, cancel } = useClientDatapacks(directory, world.name, instance.version_id, settings.storeDir);
  const [catalog, setCatalog] = useState(false);
  const [project, setProject] = useState<ModrinthProject | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const stopped = snapshot.locked === false;
  const mutable = stopped && snapshot.content !== null && !snapshot.pending;
  const action = async (run: () => Promise<boolean>) => {
    const gen = ++generation.current; setDone(false);
    const ok = await run();
    if (ok && alive.current && generation.current === gen) { setDone(true); setRemoval(null); setConfirmation(""); }
  };
  const clear = () => { generation.current++; setCatalog(false); setProject(null); setRemoval(null); setConfirmation(""); setDone(false); cancel(); };
  const openVersions = (id: string, title: string) => { setProject({ project_id: id, title, slug: id, author: "", description: "", downloads: 0, icon_url: null }); setCatalog(true); setRemoval(null); setConfirmation(""); setDone(false); };
  const entries = snapshot.content?.entries ?? [];
  const errorHint: CopyKey = snapshot.error === "WORLD_LOCKED" ? "lockedError" : snapshot.error === "WORLD_NOT_FOUND" ? "missingError" : ["NO_COMPATIBLE_VERSION", "INCOMPATIBLE_VERSION", "VERSION_PROJECT_MISMATCH", "CONTENT_KIND_MISMATCH"].includes(snapshot.error ?? "") ? "versionError" : ["CONTENT_CONFLICT", "CONTENT_NOT_FOUND"].includes(snapshot.error ?? "") ? "conflictError" : snapshot.error === "BUSY" ? "busyError" : "failed";
  return <section className="mt-5 space-y-4 rounded-lg border p-4" aria-label={t("title")}><h2 className="font-semibold">{t("title")} · {world.level_name ?? world.name}</h2><p className="text-sm text-muted-foreground">{t("scope")}</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={snapshot.pending} onClick={() => { setDone(false); void load(); }}>{t("load")}</Button><Button variant="outline" onClick={clear}>{t("cancel")}</Button><Button disabled={!mutable} onClick={() => { setCatalog(true); setProject(null); setRemoval(null); setConfirmation(""); }}>{t("search")}</Button></div>
    {!stopped && <p className="text-sm text-muted-foreground">{t("stopped")}</p>}
    {snapshot.pending && <p role="status" className="text-sm">{t("pending")} {snapshot.progress}</p>}
    {snapshot.error && <p role="alert" className="text-sm text-destructive">{t(errorHint)} ({snapshot.error})</p>}
    {snapshot.refreshError && <p role="alert" className="text-sm text-destructive">{t("refreshFailed")} ({snapshot.refreshError})</p>}
    {done && <p role="status" className="text-sm">{t("done")}</p>}
    <p className="text-xs text-muted-foreground">{t("cancelHint")}</p>
    {snapshot.content && entries.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    <div className="space-y-2">{entries.map(entry => <article key={entry.file} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0"><h3 className="break-all text-sm font-medium">{entry.source.slug ?? entry.file}</h3><p className="break-all font-mono text-xs text-muted-foreground">{entry.file}</p><p className="text-xs text-muted-foreground">{entry.enabled ? t("enabled") : t("disabled")} · {entry.source.provider === "manual" ? t("manual") : entry.source.provider} {entry.source.version_id}</p></div>
      <div className="flex flex-wrap gap-2">
        {entry.source.provider === "modrinth" && entry.source.project_id && <Button size="sm" variant="outline" disabled={!mutable} onClick={() => openVersions(entry.source.project_id!, entry.source.slug ?? entry.file)}>{t("versions")}</Button>}
        <Button size="sm" variant="outline" disabled={!mutable} onClick={() => void action(() => toggle({ file: entry.file }, !entry.enabled))}>{t(entry.enabled ? "disable" : "enable")}</Button>
        <Button size="sm" variant="destructive" disabled={!mutable} onClick={() => { setRemoval(entry.file); setConfirmation(""); setCatalog(false); setDone(false); }}>{t("remove")}</Button>
      </div>
    </article>)}</div>
    {!!snapshot.content?.unmanaged.length && <section className="space-y-2"><h3 className="text-sm font-medium">{t("unmanaged")}</h3><ul className="space-y-1 text-sm">{snapshot.content.unmanaged.map(file => <li className="break-all font-mono" key={file}>{file}</li>)}</ul><Button variant="outline" disabled={!mutable} onClick={() => void action(adopt)}>{t("adopt")}</Button></section>}
    {removal && <section className="space-y-3 rounded-lg border border-amber-500/50 p-4" aria-label={t("confirm")}><h3 className="break-all font-medium">{removal}</h3><p className="text-sm">{t("removeHint")}</p><label className="grid gap-1 text-sm">{t("confirmInput")}<input aria-label={t("confirmInput")} className={fieldClass} autoComplete="off" disabled={snapshot.pending} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><Button variant="destructive" disabled={!mutable || confirmation !== removal} onClick={() => void action(() => remove({ file: removal }))}>{t("confirm")}</Button></section>}
    {catalog && <Catalog key={project?.project_id ?? "search"} instance={instance} initialProject={project} enabled={mutable} entries={entries} onSelectVersion={(id, version, installed) => action(() => installed ? setVersion(id, version) : install(id, version))} />}
  </section>;
}

type CatalogProps = { instance: InstanceManifest; initialProject: ModrinthProject | null; enabled: boolean; entries: NonNullable<ReturnType<typeof useClientDatapacks>["snapshot"]["content"]>["entries"]; onSelectVersion: (project: string, version: string, installed: boolean) => Promise<void> };
function Catalog({ instance, initialProject, enabled, entries, onSelectVersion }: CatalogProps) {
  const t = useCopy();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(initialProject);
  const [results, setResults] = useState<ModrinthProject[] | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (detail) return;
    let current = true; setLoading(true); setFailed(false); setResults(null);
    const timer = setTimeout(() => {
      void searchDatapackProjects(query, instance.version_id).then(value => { if (current) setResults(value); }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [detail, query, instance.version_id]);
  useEffect(() => {
    if (!detail) return;
    let current = true; setVersions(null); setLoading(true); setFailed(false);
    void datapackProjectVersions(detail.project_id, instance.version_id).then(value => { if (current) setVersions(value); }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [detail, instance.version_id]);
  const installed = detail ? entries.find(entry => entry.source.provider === "modrinth" && entry.source.project_id === detail.project_id) : undefined;
  return <section className="space-y-3 rounded-lg border p-4" aria-label={t("search")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{detail?.title ?? t("search")}</h3>{detail && <Button variant="ghost" disabled={!enabled} onClick={() => setDetail(null)}>{t("back")}</Button>}</div>
    <p className="text-xs text-muted-foreground">{t("catalogHint")}</p>
    {!detail && <input aria-label={t("query")} placeholder={t("query")} className={`${fieldClass} w-full`} value={query} onChange={event => setQuery(event.target.value)} />}
    {loading && <p role="status" className="text-sm">{t("loading")}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">{t("catalogError")}</p>}
    {!detail && results?.length === 0 && <p className="text-sm">{t("noProjects")}</p>}
    {!detail && results?.map(hit => <button type="button" disabled={!enabled} key={hit.project_id} className="block w-full rounded-md border p-3 text-left hover:bg-accent disabled:opacity-60" onClick={() => setDetail(hit)}><span className="text-sm font-medium">{hit.title}</span><p className="text-xs text-muted-foreground">{hit.description}</p></button>)}
    {detail && versions?.length === 0 && <p className="text-sm">{t("noVersions")}</p>}
    {detail && versions?.map(version => <div key={version.id} className="flex items-center justify-between gap-2 rounded-md border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{version.version_number}</p><p className="break-all text-xs text-muted-foreground">{version.name}</p></div><Button size="sm" disabled={!enabled || installed?.source.version_id === version.id} onClick={() => void onSelectVersion(detail.project_id, version.id, !!installed)}>{t(installed?.source.version_id === version.id ? "current" : installed ? "switchVersion" : "install")}</Button></div>)}
  </section>;
}
