import { hasAmbiguousContentProject } from "@/lib/contentIdentity";
import { searchCurseForgeProjects, curseForgeVersions } from "@/lib/curseforge";
type CatalogProject = ModrinthProject & { available?: boolean };
type CatalogVersion = ModrinthVersion & { available?: boolean };
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Loader2,
  Package,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/components/InstallTaskProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import {
  projectVersions,
  searchProjects,
  type ModrinthProject,
  type ModrinthVersion,
} from "@/lib/modrinth";
import type { CoreSession, EventHandler } from "@/lib/rpc";
import { useSettings } from "@/lib/settings";
import type {
  ContentEntry,
  ContentKind,
  InstanceManifest,
  LoaderName,
} from "@/lib/types";

export function loaderNameOf(instance: InstanceManifest): LoaderName | null {
  if (instance.fabric_loader) return "fabric";
  if (instance.neoforge_version) return "neoforge";
  if (instance.forge_version) return "forge";
  return null;
}

const compactNumber = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);

export interface ContentSearchDialogProps {
  kind: ContentKind;
  instance: InstanceManifest;
  entries: ContentEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful install/set-version so the list refreshes. */
  onChanged: () => void;
}

/**
 * Modrinth catalog search and install for one content kind. Two levels:
 * search results, then a per-project detail with the full version list.
 * Search/browse is a GUI responsibility; installs run through the core on a
 * dedicated session.
 */
export function ContentSearchDialog({
  kind,
  instance,
  entries,
  open,
  onOpenChange,
  onChanged,
}: ContentSearchDialogProps) {
  const { openSession } = useLauncher();
  const { settings, t } = useSettings();
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [detail, setDetail] = useState<CatalogProject | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProject[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [versions, setVersions] = useState<CatalogVersion[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const installLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loader = loaderNameOf(instance);
  const directory = `${settings.instancesDir}/${instance.id}/.minecraft`;
  const installedByProject = useMemo(() => {
    const map = new Map<string, ContentEntry>();
    for (const entry of entries) {
      if (entry.source.provider === provider && entry.source.project_id) {
        map.set(entry.source.project_id, entry);
      }
    }
    return map;
  }, [entries, provider]);

  // Reset to the list level whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setDetail(null);
  }, [open]);

  // Debounced catalog search; empty query browses by downloads.
  useEffect(() => {
    if (!open || detail) return;
    let current = true;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      (provider === "curseforge" ? searchCurseForgeProjects(kind, query, instance.version_id, loader) : searchProjects(kind, query, instance.version_id, loader))
        .then((hits) => {
          if (!current) return;
          setResults(hits);
          setSearching(false);
        })
        .catch((e) => {
          if (!current) return;
          setSearchError(provider === "curseforge" ? (settings.language === "zh" ? "目录请求失败，请检查设置 → CurseForge 中的 API key。" : "Catalog request failed. Check your API key in Settings → CurseForge.") : errorText(e));
          setSearching(false);
        });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [open, detail, provider, query, kind, instance.version_id, loader, settings.language]);

  // Load the compatible version list when entering a project detail.
  useEffect(() => {
    if (!open || !detail) return;
    let current = true;
    setVersions(null);
    setVersionsError(null);
    (provider === "curseforge" ? curseForgeVersions(detail.project_id, kind, instance.version_id, loader) : projectVersions(detail.project_id, kind, instance.version_id, loader))
      .then((vs) => {
        if (!current) return;
        setVersions(vs);
      })
      .catch((e) => {
        if (!current) return;
        setVersionsError(provider === "curseforge" ? (settings.language === "zh" ? "版本请求失败，请检查设置 → CurseForge 中的 API key。" : "Version request failed. Check your API key in Settings → CurseForge.") : errorText(e));
      });
    return () => { current = false; };
  }, [open, detail, provider, kind, instance.version_id, loader, settings.language]);

  const install = useCallback(
    async (project: CatalogProject, version: CatalogVersion) => {
      if (installLock.current || project.available === false || version.available === false) return;
      if (installedByProject.has(project.project_id) && hasAmbiguousContentProject(entries, project.project_id)) return;
      installLock.current = true;
      const projectId = project.project_id;
      setInstallingId(version.id);
      setProgress(null);
      let session: CoreSession | null = null;
      try {
        const installed = installedByProject.get(projectId);
        session = await openSession();
        if (!alive.current) return;
        const trackProgress: EventHandler = (event) => {
          if (event.kind !== "event") return;
          const e = event.data as {
            event?: string;
            progress?: { bytes_processed: number; bytes_total: number };
          };
          if (e.event === "progress" && e.progress) {
            if (!alive.current) return;
            setProgress({
              done: e.progress.bytes_processed,
              total: e.progress.bytes_total,
            });
          }
        };
        if (installed && version.id !== installed.source.version_id) {
          await session.contentSetVersion(
            kind,
            directory,
            instance.version_id,
            projectId,
            version.id,
            {
              ...(provider === "curseforge" ? { provider } : {}),
              ...(kind === "mods" && loader ? { loader } : {}),
              store_directory: settings.storeDir,
            },
            trackProgress,
          );
        } else if (!installed) {
          await session.contentInstall(
            kind,
            directory,
            instance.version_id,
            projectId,
            {
              version_id: version.id,
              provider,
              ...(kind === "mods" && loader ? { loader } : {}),
              store_directory: settings.storeDir,
            },
            trackProgress,
          );
        }
        if (!alive.current) return;
        toast.success(t("content.search.installedToast", { name: project.title }));
        onChanged();
      } catch (e) {
        if (alive.current) toast.error(provider === "curseforge" ? (settings.language === "zh" ? "CurseForge 操作失败，请检查设置并刷新后重试。" : "CurseForge operation failed. Check Settings → CurseForge and refresh before retrying.") : errorText(e));
      } finally {
        if (session) void session.close();
        installLock.current = false;
        if (alive.current) { setInstallingId(null); setProgress(null); }
      }
    },
    [
      provider,
      installedByProject,
      entries,
      openSession,
      kind,
      directory,
      instance.version_id,
      loader,
      settings.storeDir,
      settings.language,
      t,
      onChanged,
    ],
  );

  const projectIcon = (project: CatalogProject, size: string) =>
    project.icon_url ? (
      <img src={project.icon_url} alt="" className={`${size} shrink-0 rounded-md object-cover`} />
    ) : (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-md bg-muted`}>
        <Package className="size-5 text-muted-foreground" />
      </div>
    );

  const renderResultRow = (project: CatalogProject) => {
    const installed = installedByProject.get(project.project_id);
    return (
      <li key={project.project_id}>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60"
          disabled={project.available === false}
          title={project.available === false ? (settings.language === "zh" ? "作者已禁用第三方下载" : "Author has disabled third-party downloads") : undefined}
          onClick={() => setDetail(project)}
        >
          {projectIcon(project, "size-10")}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{project.title}</span>
              {installed && (
                <Badge variant="secondary">{t("content.search.installed")}</Badge>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {project.description}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">{project.author}</span>
              <span>·</span>
              <Download className="size-3 shrink-0" />
              <span>{compactNumber(project.downloads)}</span>
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </li>
    );
  };

  const renderVersionRow = (project: CatalogProject, version: CatalogVersion) => {
    const installed = installedByProject.get(project.project_id);
    const isCurrent = installed?.source.version_id === version.id;
    const busy = installingId === version.id;
    return (
      <li key={version.id} className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={version.version_number}>
            {version.version_number}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={version.name}>
            {version.name !== version.version_number ? `${version.name} · ` : ""}
            {new Date(version.date_published).toLocaleDateString()}
          </p>
        </div>
        {busy && progress && progress.total > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(progress.done)} / {formatBytes(progress.total)}
          </span>
        )}
        <Button
          size="sm"
          variant={isCurrent ? "secondary" : "default"}
          title={version.available === false ? (settings.language === "zh" ? "作者已禁用第三方下载" : "Author has disabled third-party downloads") : undefined}
          disabled={(!!installed && hasAmbiguousContentProject(entries, project.project_id)) || project.available === false || version.available === false || isCurrent || installingId !== null}
          onClick={() => void install(project, version)}
        >
          {busy && <Loader2 className="animate-spin" />}
          {version.available === false ? (settings.language === "zh" ? "第三方下载不可用" : "Third-party download unavailable") : busy
            ? t("content.search.installing")
            : isCurrent
              ? t("content.search.installed")
              : installed
                ? t("content.search.switchVersion")
                : t("content.search.install")}
        </Button>
      </li>
    );
  };

  const renderSearchLevel = () => (
    <>
      <div className="relative shrink-0">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t("content.search.placeholder")}
          className="pl-9"
          autoFocus
        />
      </div>
      <div className="min-h-0 flex-1">
        {searching && !results ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : searchError ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">
            {t("content.search.failed")}: {searchError}
          </p>
        ) : results && results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("content.search.empty")}
          </p>
        ) : (
          <ScrollArea className="h-full">
            <ul className="divide-y">{results?.map(renderResultRow)}</ul>
          </ScrollArea>
        )}
      </div>
    </>
  );

  const renderDetailLevel = (project: CatalogProject) => (
    <>
      <div className="flex shrink-0 items-start gap-3 px-1">
        {projectIcon(project, "size-12")}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold">{project.title}</span>
            {installedByProject.has(project.project_id) && (
              <Badge variant="secondary">{t("content.search.installed")}</Badge>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{project.author}</span>
            <span>·</span>
            <Download className="size-3 shrink-0" />
            <span>{compactNumber(project.downloads)}</span>
          </p>
          <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">
            {project.description}
          </p>
        </div>
      </div>
      {installedByProject.has(project.project_id) && hasAmbiguousContentProject(entries, project.project_id) && <p role="alert" className="text-sm text-destructive">{settings.language === "zh" ? "多个已安装项目的 ID 或别名冲突，无法安全切换版本。请先通过文件选择器解决冲突，再刷新。" : "Installed project IDs or slugs collide; version switching is unsafe. Resolve the conflicting entries by file, then refresh."}</p>}
      <div className="min-h-0 flex-1 border-t">
        {versionsError ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">
            {t("content.search.versionsFailed")}: {versionsError}
          </p>
        ) : !versions ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("content.search.noCompatible")}
          </p>
        ) : (
          <ScrollArea className="h-full">
            <ul className="divide-y">
              {versions.map((v) => renderVersionRow(project, v))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!installLock.current) onOpenChange(next); }}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {detail && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={installingId !== null}
                onClick={() => setDetail(null)}
                aria-label={t("content.search.back")}
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {detail
              ? detail.title
              : t("content.search.title", { kind: t(`content.kind.${kind}`) })}
          </DialogTitle>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">{settings.language === "zh" ? "内容来源" : "Catalog provider"}
          <select aria-label="Catalog provider" className="rounded border bg-background p-2" value={provider} disabled={installingId !== null} onChange={event => { setProvider(event.target.value as "modrinth" | "curseforge"); setDetail(null); setResults(null); setVersions(null); setSearchError(null); setVersionsError(null); }}><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select>
        </label>
        {provider === "curseforge" && <p className="text-xs text-muted-foreground">{settings.language === "zh" ? "请先在设置 → CurseForge 保存 API key，保存后重新打开目录。第三方下载被禁用的文件不可安装。最多显示前 500 个匹配文件。" : "Save an API key in Settings → CurseForge, then reopen this catalog. Files with disabled third-party downloads cannot be installed. At most the first 500 matching files are shown."}</p>}
        {detail ? renderDetailLevel(detail) : renderSearchLevel()}
      </DialogContent>
    </Dialog>
  );
}
