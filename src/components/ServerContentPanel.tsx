import { hasAmbiguousContentProject } from "@/lib/contentIdentity";
import { searchCurseForgeProjects, curseForgeVersions } from "@/lib/curseforge";
type CatalogProvider = "modrinth" | "curseforge";
type CatalogProject = ModrinthProject & { available?: boolean };
type CatalogVersion = ModrinthVersion & { available?: boolean };
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useServers } from "@/lib/servers";
import { useServerContent } from "@/lib/serverContent";
import { searchServerProjects, serverProjectVersions, type ModrinthProject, type ModrinthVersion, type ServerCatalogKind } from "@/lib/modrinth";
import type { LoaderName, ServerManifest } from "@/lib/types";

type Props = { server: ServerManifest; state: "running" | "stopped" | "unknown" };
const copy = {
  title: ["Server Mods & datapacks", "服务端 Mod 与数据包"],
  scope: ["Mods belong to this server. Datapacks belong to its base world; Core resolves level-name and creates the world directory before first launch when needed.", "Mod 属于此服务器；数据包属于基础世界。Core 解析 level-name，必要时在首次启动前创建世界目录。"],
  mods: ["Manage Mods", "管理 Mod"], datapacks: ["Manage datapacks", "管理数据包"], close: ["Close content management", "关闭内容管理"],
  load: ["Load / refresh content", "加载／刷新内容"], cancel: ["Cancel / clear selection", "取消／清除选择"],
  stopped: ["Refresh status and stop the server before changing content.", "修改内容前请刷新状态并停止服务器。"],
  vanilla: ["Vanilla servers cannot use Mods. Datapacks are supported.", "原版服务器不支持 Mod，但支持数据包。"],
  installFirst: ["Install the server first to create usable server.properties for datapacks.", "请先安装服务器，为数据包创建有效的 server.properties。"],
  pending: ["Operation in progress…", "操作进行中…"], done: ["Operation completed.", "操作已完成。"],
  failed: ["Operation failed; refresh and retry.", "操作失败，请刷新后重试。"], refreshFailed: ["Content or authoritative status refresh failed.", "内容或权威状态刷新失败。"],
  searchCf: ["Search CurseForge", "搜索 CurseForge"],
  ambiguous: ["Installed project IDs or slugs collide; version switching is unsafe. Resolve the conflicting entries by file, then refresh.", "多个已安装项目的 ID 或别名冲突，无法安全切换版本。请先通过文件选择器解决冲突，再刷新。"],
  cfKey: ["CurseForge requires an API key saved in Settings → CurseForge. Reopen this catalog after saving it. At most the first 500 matching files are shown.", "CurseForge 需要在设置 → CurseForge 中保存 API key，保存后请重新打开目录。最多显示前 500 个匹配文件。"],
  cfOperationError: ["CurseForge request failed. Check key access in Settings → CurseForge; refresh before retrying. Rate limits may require waiting.", "CurseForge 请求失败。请检查设置 → CurseForge 中的密钥访问，刷新后重试；触发请求限制时需要等待。"],
  unavailable: ["Author has disabled third-party downloads", "作者已禁用第三方下载"],
  cfQuery: ["Search CurseForge projects", "搜索 CurseForge 项目"],
  cfWarning: ["CurseForge does not verify server-side compatibility. Check the author’s documentation before installing. Installing or switching a version sends the stored key to the selected Core endpoint.", "CurseForge 不验证服务端兼容性，安装前请查看作者文档。安装或切换版本会将已保存的 key 发送到所选 Core 端点。"],
  search: ["Search Modrinth", "搜索 Modrinth"], query: ["Search server-compatible projects", "搜索服务端兼容项目"],
  loading: ["Loading catalog…", "正在加载目录…"], catalogError: ["Catalog request failed. Change the search or reopen to retry.", "目录请求失败，请更改搜索词或重新打开以重试。"],
  noProjects: ["No matching projects.", "没有匹配的项目。"], noVersions: ["No compatible versions for this game and loader.", "没有适配此游戏与加载器的版本。"],
  back: ["Back to search", "返回搜索"], versions: ["Choose version", "选择版本"], install: ["Install", "安装"], switchVersion: ["Switch version", "切换版本"], current: ["Installed version", "已安装版本"],
  empty: ["No managed content.", "没有已管理内容。"], enabled: ["Enabled", "已启用"], disabled: ["Disabled", "已禁用"], enable: ["Enable", "启用"], disable: ["Disable", "禁用"],
  remove: ["Remove", "删除"], confirm: ["Confirm removal", "确认删除"], confirmInput: ["Type file name to confirm removal", "输入文件名确认删除"],
  removeHint: ["Remove this server/world link only. Shared store objects remain for later GC.", "仅删除此服务器／世界中的链接；共享存储对象留待后续 GC。"],
  unmanaged: ["Unmanaged files", "未接管文件"], adopt: ["Adopt unmanaged files", "接管未管理文件"], manual: ["Manual", "手动"],
  catalogHint: ["Compatible game and loader versions only. Core performs final validation.", "仅显示兼容游戏与加载器的版本，Core 执行最终校验。"],
  cancelHint: ["Cancellation closes this request; an interrupted remote change may already have completed. Refresh before retrying.", "取消将关闭此请求；被中断的远端修改可能已经完成。重试前请刷新。"],
} as const;
type CopyKey = keyof typeof copy;
const fieldClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60";
function useCopy() { const { settings } = useSettings(); return (key: CopyKey) => copy[key][settings.language === "zh" ? 1 : 0]; }
function loaderOf(server: ServerManifest): LoaderName | null { return server.fabric_loader ? "fabric" : server.neoforge_version ? "neoforge" : server.forge_version ? "forge" : null; }

export function ServerContentPanel(props: Props) {
  const scope = useServers().captureOperationScope();
  return <ScopedPanel key={JSON.stringify([props.server.id, props.server.version_id, loaderOf(props.server), scope])} {...props} />;
}
function ScopedPanel(props: Props) {
  const t = useCopy();
  const [kind, setKind] = useState<ServerCatalogKind | null>(null);
  return <section className="mt-6 rounded-xl border p-5" aria-label={t("title")}>
    <h2 className="font-semibold">{t("title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("scope")}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant={kind === "mods" ? "secondary" : "outline"} onClick={() => setKind("mods")}>{t("mods")}</Button>
      <Button variant={kind === "datapacks" ? "secondary" : "outline"} onClick={() => setKind("datapacks")}>{t("datapacks")}</Button>
      {kind && <Button variant="outline" onClick={() => setKind(null)}>{t("close")}</Button>}
    </div>
    {kind && <ContentControls key={kind} {...props} kind={kind} />}
  </section>;
}
function ContentControls({ server, state, kind }: Props & { kind: ServerCatalogKind }) {
  const t = useCopy();
  const { snapshot, load, install, setVersion, toggle, remove, adopt, cancel } = useServerContent(server, kind);
  const [catalog, setCatalog] = useState(false);
  const [provider, setProvider] = useState<CatalogProvider>("modrinth");
  const [project, setProject] = useState<CatalogProject | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const loader = loaderOf(server);
  const canBrowse = kind !== "mods" || loader !== null;
  const stopped = state === "stopped" && snapshot.status?.running === false;
  const mutable = stopped && snapshot.content !== null && !snapshot.pending;
  const action = async (run: () => Promise<boolean>) => {
    const gen = ++generation.current; setDone(false);
    const ok = await run();
    if (ok && alive.current && generation.current === gen) { setDone(true); setRemoval(null); setConfirmation(""); }
  };
  const clear = () => { generation.current++; setCatalog(false); setProject(null); setRemoval(null); setConfirmation(""); setDone(false); cancel(); };
  const openVersions = (id: string, title: string, source: CatalogProvider) => { setProvider(source); setProject({ project_id: id, title, slug: id, author: "", description: "", downloads: 0, icon_url: null }); setCatalog(true); setRemoval(null); setConfirmation(""); setDone(false); };
  const entries = snapshot.content?.entries ?? [];
  return <div className="mt-5 space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={snapshot.pending} onClick={() => { setDone(false); void load(); }}>{t("load")}</Button><Button variant="outline" onClick={clear}>{t("cancel")}</Button><Button disabled={!mutable || !canBrowse} onClick={() => { setProvider("modrinth"); setCatalog(true); setProject(null); setRemoval(null); setConfirmation(""); }}>{t("search")}</Button><Button disabled={!mutable || !canBrowse} onClick={() => { setProvider("curseforge"); setCatalog(true); setProject(null); setRemoval(null); setConfirmation(""); }}>{t("searchCf")}</Button></div>
    {!stopped && <p className="text-sm text-muted-foreground">{t("stopped")}</p>}
    {kind === "mods" && !loader && <p className="text-sm text-muted-foreground">{t("vanilla")}</p>}
    {kind === "datapacks" && !server.installed && <p className="text-sm text-muted-foreground">{t("installFirst")}</p>}
    {snapshot.pending && <p role="status" className="text-sm">{t("pending")} {snapshot.progress}</p>}
    {snapshot.error && <p role="alert" className="text-sm text-destructive">{t(snapshot.error === "CONTENT_PROJECT_AMBIGUOUS" ? "ambiguous" : snapshot.error === "CURSEFORGE_DOWNLOAD_UNAVAILABLE" ? "unavailable" : snapshot.error.startsWith("CURSEFORGE_") ? "cfOperationError" : "failed")} ({snapshot.error})</p>}
    {snapshot.refreshError && <p role="alert" className="text-sm text-destructive">{t("refreshFailed")} ({snapshot.refreshError})</p>}
    {done && <p role="status" className="text-sm">{t("done")}</p>}
    <p className="text-xs text-muted-foreground">{t("cancelHint")}</p>
    {snapshot.content && entries.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    <div className="space-y-2">{entries.map(entry => <article key={entry.file} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0"><h3 className="break-all text-sm font-medium">{entry.source.slug ?? entry.file}</h3><p className="break-all font-mono text-xs text-muted-foreground">{entry.file}</p><p className="text-xs text-muted-foreground">{entry.enabled ? t("enabled") : t("disabled")} · {entry.source.provider === "manual" ? t("manual") : entry.source.provider} {entry.source.version_id}</p></div>
      <div className="flex flex-wrap gap-2">
        {(entry.source.provider === "modrinth" || entry.source.provider === "curseforge") && entry.source.project_id && <Button size="sm" variant="outline" disabled={!mutable || !canBrowse} onClick={() => openVersions(entry.source.project_id!, entry.source.slug ?? entry.file, entry.source.provider as CatalogProvider)}>{t("versions")}</Button>}
        <Button size="sm" variant="outline" disabled={!mutable} onClick={() => void action(() => toggle({ file: entry.file }, !entry.enabled))}>{t(entry.enabled ? "disable" : "enable")}</Button>
        <Button size="sm" variant="destructive" disabled={!mutable} onClick={() => { setRemoval(entry.file); setConfirmation(""); setCatalog(false); setDone(false); }}>{t("remove")}</Button>
      </div>
    </article>)}</div>
    {!!snapshot.content?.unmanaged.length && <section className="space-y-2"><h3 className="text-sm font-medium">{t("unmanaged")}</h3><ul className="space-y-1 text-sm">{snapshot.content.unmanaged.map(file => <li className="break-all font-mono" key={file}>{file}</li>)}</ul><Button variant="outline" disabled={!mutable} onClick={() => void action(adopt)}>{t("adopt")}</Button></section>}
    {removal && <section className="space-y-3 rounded-lg border border-amber-500/50 p-4" aria-label={t("confirm")}><h3 className="break-all font-medium">{removal}</h3><p className="text-sm">{t("removeHint")}</p><label className="grid gap-1 text-sm">{t("confirmInput")}<input aria-label={t("confirmInput")} className={fieldClass} autoComplete="off" disabled={snapshot.pending} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><Button variant="destructive" disabled={!mutable || confirmation !== removal} onClick={() => void action(() => remove({ file: removal }))}>{t("confirm")}</Button></section>}
    {catalog && <Catalog key={`${provider}:${kind}:${project?.project_id ?? "search"}`} provider={provider} kind={kind} server={server} initialProject={project} enabled={mutable} entries={entries} onSelectVersion={(id, version, installed) => action(() => installed ? setVersion(id, version, provider) : install(id, version, provider))} />}
  </div>;
}

type CatalogProps = { provider: CatalogProvider; kind: ServerCatalogKind; server: ServerManifest; initialProject: CatalogProject | null; enabled: boolean; entries: NonNullable<ReturnType<typeof useServerContent>["snapshot"]["content"]>["entries"]; onSelectVersion: (project: string, version: string, installed: boolean) => Promise<void> };
function Catalog({ provider, kind, server, initialProject, enabled, entries, onSelectVersion }: CatalogProps) {
  const t = useCopy();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(initialProject);
  const [results, setResults] = useState<CatalogProject[] | null>(null);
  const [versions, setVersions] = useState<CatalogVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const loader = loaderOf(server);
  useEffect(() => {
    if (detail) return;
    let current = true; setLoading(true); setFailed(false); setResults(null);
    const timer = setTimeout(() => {
      void (provider === "curseforge" ? searchCurseForgeProjects(kind, query, server.version_id, loader) : searchServerProjects(kind, query, server.version_id, loader)).then(value => { if (current) setResults(value); }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [provider, detail, query, kind, server.version_id, loader]);
  useEffect(() => {
    if (!detail) return;
    let current = true; setVersions(null); setLoading(true); setFailed(false);
    void (provider === "curseforge" ? curseForgeVersions(detail.project_id, kind, server.version_id, loader) : serverProjectVersions(detail.project_id, kind, server.version_id, loader)).then(value => { if (current) setVersions(value); }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [provider, detail, kind, server.version_id, loader]);
  const installed = detail ? entries.find(entry => entry.source.provider === provider && entry.source.project_id === detail.project_id) : undefined;
  const ambiguous = !!installed && !!detail && hasAmbiguousContentProject(entries, detail.project_id);
  return <section className="space-y-3 rounded-lg border p-4" aria-label={provider === "curseforge" ? t("searchCf") : t("search")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{detail?.title ?? (provider === "curseforge" ? "CurseForge" : t("search"))}</h3>{detail && <Button variant="ghost" disabled={!enabled} onClick={() => setDetail(null)}>{t("back")}</Button>}</div>
    <p className="text-xs text-muted-foreground">{t("catalogHint")}</p>{provider === "curseforge" && <p className="text-xs text-muted-foreground">{t("cfKey")}</p>}{provider === "curseforge" && <p className="text-sm text-amber-600">{t("cfWarning")}</p>}
    {!detail && <input aria-label={provider === "curseforge" ? t("cfQuery") : t("query")} placeholder={provider === "curseforge" ? t("cfQuery") : t("query")} className={`${fieldClass} w-full`} value={query} onChange={event => setQuery(event.target.value)} />}
    {ambiguous && <p role="alert" className="text-sm text-destructive">{t("ambiguous")}</p>}
    {loading && <p role="status" className="text-sm">{t("loading")}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">{t("catalogError")}</p>}
    {!detail && results?.length === 0 && <p className="text-sm">{t("noProjects")}</p>}
    {!detail && results?.map(hit => <button type="button" disabled={!enabled || hit.available === false} title={hit.available === false ? t("unavailable") : undefined} key={hit.project_id} className="block w-full rounded-md border p-3 text-left hover:bg-accent disabled:opacity-60" onClick={() => setDetail(hit)}><span className="text-sm font-medium">{hit.title}</span><p className="text-xs text-muted-foreground">{hit.description}</p>{hit.available === false && <p className="text-xs">{t("unavailable")}</p>}</button>)}
    {detail && versions?.length === 0 && <p className="text-sm">{t("noVersions")}</p>}
    {detail && versions?.map(version => <div key={version.id} className="flex items-center justify-between gap-2 rounded-md border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{version.version_number}</p><p className="break-all text-xs text-muted-foreground">{version.name}</p></div><Button size="sm" title={version.available === false ? t("unavailable") : undefined} disabled={ambiguous || !enabled || detail.available === false || version.available === false || installed?.source.version_id === version.id} onClick={() => { if (!ambiguous) void onSelectVersion(detail.project_id, version.id, !!installed); }}>{t(version.available === false ? "unavailable" : installed?.source.version_id === version.id ? "current" : installed ? "switchVersion" : "install")}</Button></div>)}
  </section>;
}
