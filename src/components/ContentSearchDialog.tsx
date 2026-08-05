import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Package, Search } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface RowState {
  versions?: ModrinthVersion[];
  versionsLoading?: boolean;
  selected?: string;
  busy?: boolean;
  progress?: { done: number; total: number } | null;
}

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
 * Modrinth catalog search and install for one content kind. Search/browse is
 * a GUI responsibility; installs run through the core on a dedicated session.
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
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

  const patchRow = useCallback((projectId: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [projectId]: { ...prev[projectId], ...patch } }));
  }, []);

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

  const ensureVersions = useCallback(
    async (projectId: string): Promise<ModrinthVersion[]> => {
      const cached = rows[projectId]?.versions;
      if (cached) return cached;
      patchRow(projectId, { versionsLoading: true });
      try {
        const vs = await projectVersions(projectId, kind, instance.version_id, loader);
        patchRow(projectId, { versions: vs, versionsLoading: false });
        return vs;
      } catch (e) {
        patchRow(projectId, { versionsLoading: false });
        throw e;
      }
    },
    [rows, patchRow, kind, instance.version_id, loader],
  );

  const install = async (project: ModrinthProject) => {
    const projectId = project.project_id;
    const row = rows[projectId] ?? {};
    setRows((prev) => ({ ...prev, [projectId]: { ...prev[projectId], busy: true, progress: null } }));
    let session: CoreSession | null = null;
    try {
      const vs = row.versions ?? (await ensureVersions(projectId));
      const versionId = row.selected ?? vs[0]?.id;
      if (!versionId) throw new Error(t("content.search.noCompatible"));
      const installed = installedByProject.get(projectId);
      session = await openSession();
      const trackProgress: EventHandler = (event) => {
        if (event.kind !== "event") return;
        const e = event.data as {
          event?: string;
          progress?: { bytes_processed: number; bytes_total: number };
        };
        if (e.event === "progress" && e.progress) {
          patchRow(projectId, {
            progress: { done: e.progress.bytes_processed, total: e.progress.bytes_total },
          });
        }
      };
      if (installed && versionId !== installed.source.version_id) {
        await session.contentSetVersion(
          kind,
          directory,
          instance.version_id,
          projectId,
          versionId,
          {
            ...(kind === "mods" && loader ? { loader } : {}),
            store_directory: settings.storeDir,
          },
          trackProgress,
        );
      } else {
        await session.contentInstall(
          kind,
          directory,
          instance.version_id,
          projectId,
          {
            version_id: versionId,
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
      patchRow(projectId, { busy: false, progress: null });
    }
  };

  const renderRow = (project: ModrinthProject) => {
    const projectId = project.project_id;
    const row = rows[projectId] ?? {};
    const installed = installedByProject.get(projectId);
    const versions = row.versions;
    const selected = row.selected ?? versions?.[0]?.id;
    const current = installed?.source.version_id;
    const upToDate = installed != null && selected != null && selected === current;
    const buttonLabel = row.busy
      ? t("content.search.installing")
      : upToDate
        ? t("content.search.installed")
        : installed
          ? t("content.search.switchVersion")
          : t("content.search.install");

    return (
      <li key={projectId} className="flex gap-3 px-4 py-3">
        {project.icon_url ? (
          <img
            src={project.icon_url}
            alt=""
            className="size-10 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Package className="size-5 text-muted-foreground" />
          </div>
        )}
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
            <span>{project.author}</span>
            <span>·</span>
            <Download className="size-3" />
            <span>{compactNumber(project.downloads)}</span>
            {row.progress && row.progress.total > 0 && (
              <>
                <span>·</span>
                <span>
                  {formatBytes(row.progress.done)} / {formatBytes(row.progress.total)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <Select
            value={selected}
            onValueChange={(value) => patchRow(projectId, { selected: value as string })}
            onOpenChange={(openSelect) => {
              if (openSelect && !versions && !row.versionsLoading) {
                void ensureVersions(projectId).catch((e) => toast.error(errorText(e)));
              }
            }}
          >
            <SelectTrigger size="sm" className="w-36" disabled={row.busy}>
              <SelectValue placeholder={t("content.search.latest")}>
                {(value: string) =>
                  versions?.find((v) => v.id === value)?.version_number ??
                  t("content.search.latest")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(versions ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.version_number}
                  {v.id === current ? ` (${t("content.search.installed")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={row.busy || upToDate || row.versionsLoading}
            onClick={() => void install(project)}
          >
            {row.busy && <Loader2 className="animate-spin" />}
            {buttonLabel}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("content.search.title", { kind: t(`content.kind.${kind}`) })}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t("content.search.placeholder")}
            className="pl-9"
            autoFocus
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
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
            <ul className="divide-y">{results?.map(renderRow)}</ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
