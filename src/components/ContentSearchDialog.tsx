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
  const [detail, setDetail] = useState<ModrinthProject | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const generation = useRef(0);

  const loader = loaderNameOf(instance);
  const directory = `${settings.instancesDir}/${instance.id}/.minecraft`;
  const installedByProject = useMemo(() => {
    const map = new Map<string, ContentEntry>();
    for (const entry of entries) {
      if (entry.source.provider === "modrinth" && entry.source.project_id) {
        map.set(entry.source.project_id, entry);
      }
    }
    return map;
  }, [entries]);

  // Reset to the list level whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setDetail(null);
  }, [open]);

  // Debounced catalog search; empty query browses by downloads.
  useEffect(() => {
    if (!open) return;
    const gen = ++generation.current;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      searchProjects(kind, query, instance.version_id, loader)
        .then((hits) => {
          if (generation.current !== gen) return;
          setResults(hits);
          setSearching(false);
        })
        .catch((e) => {
          if (generation.current !== gen) return;
          setSearchError(errorText(e));
          setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [open, query, kind, instance.version_id, loader]);

  // Load the compatible version list when entering a project detail.
  useEffect(() => {
    if (!detail) return;
    const gen = ++generation.current;
    setVersions(null);
    setVersionsError(null);
    projectVersions(detail.project_id, kind, instance.version_id, loader)
      .then((vs) => {
        if (generation.current !== gen) return;
        setVersions(vs);
      })
      .catch((e) => {
        if (generation.current !== gen) return;
        setVersionsError(errorText(e));
      });
  }, [detail, kind, instance.version_id, loader]);

  const install = useCallback(
    async (project: ModrinthProject, version: ModrinthVersion) => {
      const projectId = project.project_id;
      setInstallingId(version.id);
      setProgress(null);
      let session: CoreSession | null = null;
      try {
        const installed = installedByProject.get(projectId);
        session = await openSession();
        const trackProgress: EventHandler = (event) => {
          if (event.kind !== "event") return;
          const e = event.data as {
            event?: string;
            progress?: { bytes_processed: number; bytes_total: number };
          };
          if (e.event === "progress" && e.progress) {
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
              provider: "modrinth",
              ...(kind === "mods" && loader ? { loader } : {}),
              store_directory: settings.storeDir,
            },
            trackProgress,
          );
        }
        toast.success(t("content.search.installedToast", { name: project.title }));
        onChanged();
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        if (session) void session.close();
        setInstallingId(null);
        setProgress(null);
      }
    },
    [
      installedByProject,
      openSession,
      kind,
      directory,
      instance.version_id,
      loader,
      settings.storeDir,
      t,
      onChanged,
    ],
  );

  const projectIcon = (project: ModrinthProject, size: string) =>
    project.icon_url ? (
      <img src={project.icon_url} alt="" className={`${size} shrink-0 rounded-md object-cover`} />
    ) : (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-md bg-muted`}>
        <Package className="size-5 text-muted-foreground" />
      </div>
    );

  const renderResultRow = (project: ModrinthProject) => {
    const installed = installedByProject.get(project.project_id);
    return (
      <li key={project.project_id}>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60"
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

  const renderVersionRow = (project: ModrinthProject, version: ModrinthVersion) => {
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
          disabled={isCurrent || installingId !== null}
          onClick={() => void install(project, version)}
        >
          {busy && <Loader2 className="animate-spin" />}
          {busy
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

  const renderDetailLevel = (project: ModrinthProject) => (
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {detail && (
              <Button
                size="icon-sm"
                variant="ghost"
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
        {detail ? renderDetailLevel(detail) : renderSearchLevel()}
      </DialogContent>
    </Dialog>
  );
}
