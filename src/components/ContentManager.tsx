import { useCallback, useEffect, useState } from "react";
import { FolderInput, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ContentSearchDialog, loaderNameOf } from "@/components/ContentSearchDialog";
import { formatBytes } from "@/components/InstallTaskProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorText, useLauncher } from "@/lib/launcher";
import { useSettings } from "@/lib/settings";
import type {
  ContentEntry,
  ContentKind,
  ContentListResult,
  InstanceManifest,
} from "@/lib/types";

const KINDS: ContentKind[] = ["mods", "resourcepacks", "shaderpacks"];

const baseName = (file: string) => file.split("/").pop() ?? file;

/** Human label: provider slug when known, otherwise the file name. */
function displayName(entry: ContentEntry): string {
  return entry.source.slug ?? baseName(entry.file);
}

/** enable/disable/remove target: project id for provider entries, file for manual (§4). */
function targetOf(entry: ContentEntry): { project: string } | { file: string } {
  return entry.source.provider !== "manual" && entry.source.project_id
    ? { project: entry.source.project_id }
    : { file: entry.file };
}

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ContentEntry[]; unmanaged: string[] };

function ContentPanel({
  kind,
  instance,
  directory,
  storeDir,
}: {
  kind: ContentKind;
  instance: InstanceManifest;
  directory: string;
  storeDir: string;
}) {
  const { session } = useLauncher();
  const { t } = useSettings();
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const needsLoader = kind === "mods" && loaderNameOf(instance) == null;

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const result: ContentListResult = await session.contentList(kind, directory);
      setState({
        status: "ready",
        entries: [...result.entries].sort((a, b) =>
          displayName(a).localeCompare(displayName(b)),
        ),
        unmanaged: result.unmanaged,
      });
    } catch (e) {
      setState({ status: "error", message: errorText(e) });
    }
  }, [session, kind, directory]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (entry: ContentEntry, action: () => Promise<unknown>) => {
    setPendingFile(entry.file);
    setConfirmFile(null);
    try {
      await action();
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setPendingFile(null);
    }
  };

  const toggle = (entry: ContentEntry) =>
    mutate(entry, () =>
      entry.enabled
        ? session!.contentDisable(kind, directory, targetOf(entry))
        : session!.contentEnable(kind, directory, targetOf(entry)),
    );

  const remove = (entry: ContentEntry) =>
    mutate(entry, () => session!.contentRemove(kind, directory, targetOf(entry)));

  const adopt = async () => {
    if (!session) return;
    setAdopting(true);
    try {
      await session.contentAdopt(kind, directory, storeDir);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setAdopting(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="space-y-2 pt-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
        <span className="text-destructive">
          {t("content.loadFailed")}: {state.message}
        </span>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const { entries, unmanaged } = state;

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {needsLoader ? t("content.needsLoader") : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={needsLoader}
          title={needsLoader ? t("content.needsLoader") : undefined}
          onClick={() => setSearchOpen(true)}
        >
          <Plus className="size-4" />
          {t("content.add")}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("content.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {entries.map((entry) => {
            const pending = pendingFile === entry.file;
            const confirming = confirmFile === entry.file;
            return (
              <li
                key={entry.file}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <Checkbox
                  checked={entry.enabled}
                  disabled={pending}
                  onCheckedChange={() => void toggle(entry)}
                  aria-label={
                    entry.enabled ? t("content.disable") : t("content.enable")
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        entry.enabled
                          ? "truncate text-sm font-medium"
                          : "truncate text-sm font-medium text-muted-foreground line-through"
                      }
                    >
                      {displayName(entry)}
                    </span>
                    {entry.source.provider === "manual" && (
                      <Badge variant="secondary">{t("content.manual")}</Badge>
                    )}
                    {entry.as_dependency && (
                      <Badge variant="outline">{t("content.dependency")}</Badge>
                    )}
                    {!entry.enabled && (
                      <Badge variant="outline">{t("content.disabled")}</Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {baseName(entry.file)} · {formatBytes(entry.size)}
                  </div>
                </div>
                {confirming ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-destructive">
                      {t("content.removeConfirm")}
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => void remove(entry)}
                    >
                      {t("content.remove")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setConfirmFile(null)}
                    >
                      {t("content.removeCancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirmFile(entry.file)}
                    aria-label={t("content.remove")}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {unmanaged.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {t("content.unmanaged", { count: unmanaged.length })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={adopting}
              onClick={() => void adopt()}
            >
              <FolderInput className="size-4" />
              {adopting ? t("content.adopting") : t("content.adopt")}
            </Button>
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {unmanaged.map((file) => (
              <li key={file} className="truncate">
                {baseName(file)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ContentSearchDialog
        kind={kind}
        instance={instance}
        entries={entries}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onChanged={() => void load()}
      />
    </div>
  );
}

/**
 * Per-instance content management (mods / resource packs / shader packs):
 * list, enable/disable, remove, and adopt unmanaged files (contract §4).
 * Catalog search and installs build on top of this panel.
 */
export function ContentManager({ instance }: { instance: InstanceManifest }) {
  const { settings, t } = useSettings();
  const directory = `${settings.instancesDir}/${instance.id}/.minecraft`;

  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="mods">
          <TabsList>
            {KINDS.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`content.kind.${kind}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map((kind) => (
            <TabsContent key={kind} value={kind}>
              <ContentPanel
                kind={kind}
                instance={instance}
                directory={directory}
                storeDir={settings.storeDir}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
