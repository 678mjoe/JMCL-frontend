import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Copy,
  Download,
  FolderInput,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { formatBytes } from "@/components/InstallTaskProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import type { MessageKey } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import type { InstanceManifest, WorldBackupEntry, WorldEntry } from "@/lib/types";

const GAME_MODES: Record<string, MessageKey> = {
  survival: "worlds.gamemode.survival",
  creative: "worlds.gamemode.creative",
  adventure: "worlds.gamemode.adventure",
  spectator: "worlds.gamemode.spectator",
};

const DIFFICULTIES: Record<number, MessageKey> = {
  0: "worlds.difficulty.0",
  1: "worlds.difficulty.1",
  2: "worlds.difficulty.2",
  3: "worlds.difficulty.3",
};

/** Client-side mirror of the core's world-name rules (docs/worlds.md). */
function validateWorldName(name: string): boolean {
  if (name.length === 0 || new TextEncoder().encode(name).length > 255) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith(".")) return false;
  if (name.endsWith(" ") || name.endsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return false;
  return true;
}

/** Stem for the import/restore default name: strip archive extension. */
function fileStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.zip$/i, "");
}

/** Backup default restore name: the parsed world name, else strip the timestamp suffix. */
function backupDefaultName(backup: WorldBackupEntry): string {
  if (backup.world) return backup.world;
  return fileStem(backup.file).replace(/-\d{8}-\d{6}(-.*)?$/, "");
}

type RenameState =
  | { kind: "rename" | "duplicate"; world: WorldEntry }
  | { kind: "backup"; world: WorldEntry }
  | { kind: "restore"; backup: WorldBackupEntry }
  | { kind: "import"; file: string };

type ConfirmState =
  | { kind: "deleteWorld"; world: WorldEntry }
  | { kind: "deleteBackup"; backup: WorldBackupEntry };

interface NameDialogProps {
  state: RenameState;
  existingNames: Set<string>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, replace: boolean, label?: string) => void;
}

/** Name-entry dialog shared by rename/duplicate/backup/restore/import flows. */
function NameDialog({ state, existingNames, busy, onCancel, onSubmit }: NameDialogProps) {
  const { t } = useSettings();
  const isBackup = state.kind === "backup";
  const initialName = useMemo(() => {
    switch (state.kind) {
      case "rename":
        return state.world.level_name ?? state.world.name;
      case "duplicate":
        return `${state.world.level_name ?? state.world.name}-copy`;
      case "restore":
        return backupDefaultName(state.backup);
      case "import":
        return fileStem(state.file);
      default:
        return "";
    }
  }, [state]);
  const [name, setName] = useState(initialName);
  const [label, setLabel] = useState("");
  const [replace, setReplace] = useState(false);

  const collides = !isBackup && existingNames.has(name);
  const valid = isBackup || validateWorldName(name);
  const canSubmit = valid && (!collides || replace) && !busy;

  const titles: Record<RenameState["kind"], MessageKey> = {
    rename: "worlds.renameTitle",
    duplicate: "worlds.duplicateTitle",
    backup: "worlds.backupTitle",
    restore: "worlds.restoreTitle",
    import: "worlds.importTitle",
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titles[state.kind])}</DialogTitle>
          {state.kind !== "backup" && (
            <DialogDescription>
              {state.kind === "import" ? fileStem(state.file) : state.kind === "restore" ? state.backup.file : state.world.name}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          {isBackup ? (
            <div className="space-y-1.5">
              <Label htmlFor="world-backup-label">{t("worlds.backupLabel")}</Label>
              <Input
                id="world-backup-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("worlds.backupLabelPlaceholder")}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="world-name">{t("worlds.name")}</Label>
                <Input
                  id="world-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                {!valid && (
                  <p className="text-xs text-destructive">{t("worlds.nameInvalid")}</p>
                )}
                {valid && collides && !replace && (
                  <p className="text-xs text-destructive">{t("worlds.nameExists")}</p>
                )}
              </div>
              {(state.kind === "restore" || state.kind === "import") && collides && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={replace}
                    onCheckedChange={(checked) => setReplace(checked === true)}
                  />
                  {t("worlds.restoreReplace")}
                </label>
              )}
              {state.kind === "duplicate" && (
                <p className="text-xs text-muted-foreground">{t("worlds.duplicateHint")}</p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSubmit(name, replace, label || undefined)} disabled={!canSubmit}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-instance save management (contract §4, docs/worlds.md): list, rename,
 * duplicate, delete, export/import, and timestamped backups. Runs on the
 * shared session; worlds.* calls are single request/result with no events.
 */
export function WorldsManager({ instance }: { instance: InstanceManifest }) {
  const { session } = useLauncher();
  const { settings, t } = useSettings();
  const directory = `${settings.instancesDir}/${instance.id}/.minecraft`;

  const [worlds, setWorlds] = useState<WorldEntry[] | null>(null);
  const [backups, setBackups] = useState<WorldBackupEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<RenameState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [worldList, backupList] = await Promise.all([
        session.worldsList(directory, instance.version_id),
        session.worldsBackups(directory),
      ]);
      setWorlds(worldList.worlds);
      setBackups(backupList.backups);
      setLoadError(null);
      setIcons({});
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [session, directory, instance.version_id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Icons come from worlds.get (one per world); fetch lazily for worlds that
  // report has_icon. Icons reset on every reload.
  useEffect(() => {
    if (!session || !worlds) return;
    for (const world of worlds) {
      if (!world.has_icon) continue;
      void session
        .worldsGet(directory, world.name, instance.version_id)
        .then((result) => {
          if (result.icon_png_base64) {
            setIcons((prev) => ({
              ...prev,
              [world.name]: `data:image/png;base64,${result.icon_png_base64}`,
            }));
          }
        })
        .catch(() => {});
    }
  }, [session, worlds, directory, instance.version_id]);

  const run = async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await action();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const submitNameDialog = (name: string, replace: boolean, label?: string) => {
    if (!session || !nameDialog) return;
    const state = nameDialog;
    setNameDialog(null);
    switch (state.kind) {
      case "rename":
        void run(`rename:${state.world.name}`, async () => {
          await session.worldsRename(directory, state.world.name, name);
        }, t("worlds.renamed", { name }));
        break;
      case "duplicate":
        void run(`duplicate:${state.world.name}`, async () => {
          await session.worldsDuplicate(directory, state.world.name, name);
        }, t("worlds.duplicated", { name }));
        break;
      case "backup":
        void run(`backup:${state.world.name}`, async () => {
          const result = await session.worldsBackup(directory, state.world.name, label);
          toast.success(t("worlds.backupCreated", { file: result.backup }));
        });
        break;
      case "restore":
        void run(`restore:${state.backup.file}`, async () => {
          const result = await session.worldsRestore(directory, state.backup.file, {
            name,
            replace,
          });
          toast.success(t("worlds.restored", { name: result.world.name }));
        });
        break;
      case "import":
        void run(`import:${state.file}`, async () => {
          const result = await session.worldsImport(directory, state.file, {
            name,
            replace,
          });
          toast.success(t("worlds.imported", { name: result.world.name }));
        });
        break;
    }
  };

  const submitConfirm = () => {
    if (!session || !confirm) return;
    const state = confirm;
    setConfirm(null);
    if (state.kind === "deleteWorld") {
      void run(`delete:${state.world.name}`, async () => {
        await session.worldsDelete(directory, state.world.name);
      }, t("worlds.deleted", { name: state.world.name }));
    } else {
      void run(`deleteBackup:${state.backup.file}`, async () => {
        await session.worldsBackupsDelete(directory, state.backup.file);
      }, t("worlds.backupDeleted", { name: state.backup.file }));
    }
  };

  const pickImport = async () => {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof file === "string") {
      setNameDialog({ kind: "import", file });
    }
  };

  const exportWorld = async (world: WorldEntry) => {
    if (!session) return;
    const file = await saveDialog({
      defaultPath: `${world.name}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!file) return;
    void run(`export:${world.name}`, async () => {
      await session.worldsExport(directory, world.name, file);
    }, t("worlds.exported", { file }));
  };

  const existingNames = useMemo(
    () => new Set((worlds ?? []).map((w) => w.name)),
    [worlds],
  );

  const renderBody = () => {
    if (loadError) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="text-destructive">
            {t("worlds.loadFailed")}: {loadError}
          </span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            {t("common.retry")}
          </Button>
        </div>
      );
    }
    if (worlds === null || backups === null) {
      return (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      );
    }
    return (
      <>
        {worlds.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            {t("worlds.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {worlds.map((world) => {
              const displayName = world.level_name ?? world.name;
              const busyWorld = busy?.endsWith(`:${world.name}`) ?? false;
              const modeKey = world.game_mode ? GAME_MODES[world.game_mode] : undefined;
              const diffKey =
                world.difficulty != null ? DIFFICULTIES[world.difficulty] : undefined;
              return (
                <li key={world.name} className="flex items-center gap-3 px-3 py-2.5">
                  {icons[world.name] ? (
                    <img
                      src={icons[world.name]}
                      alt=""
                      className="size-9 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <HardDrive className="size-9 shrink-0 rounded-sm border p-2 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{displayName}</span>
                      {world.level_name === null && (
                        <Badge variant="destructive">{t("worlds.corrupt")}</Badge>
                      )}
                      {world.locked && (
                        <Badge variant="secondary" title={t("worlds.lockedHint")}>
                          {t("worlds.locked")}
                        </Badge>
                      )}
                      {world.hardcore === true && (
                        <Badge variant="outline">{t("worlds.hardcore")}</Badge>
                      )}
                      {world.version_relation === "different" && (
                        <Badge
                          variant="outline"
                          className="border-amber-500/50 text-amber-600 dark:text-amber-400"
                          title={t("worlds.versionDifferentHint", {
                            version: world.version_name ?? "?",
                            instanceVersion: instance.version_id,
                          })}
                        >
                          {t("worlds.versionDifferent")}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        displayName !== world.name ? world.name : null,
                        modeKey ? t(modeKey) : world.game_mode,
                        world.hardcore !== true && diffKey ? t(diffKey) : null,
                        formatBytes(world.size_bytes),
                        world.last_played_ms != null
                          ? t("worlds.lastPlayed", {
                              time: new Date(world.last_played_ms).toLocaleString(),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {busyWorld && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busyWorld}
                          aria-label={t("worlds.actions")}
                        />
                      }
                    >
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={world.locked}
                        onClick={() => setNameDialog({ kind: "rename", world })}
                      >
                        <Pencil className="size-4" />
                        {t("worlds.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={world.locked}
                        onClick={() => setNameDialog({ kind: "duplicate", world })}
                      >
                        <Copy className="size-4" />
                        {t("worlds.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={world.locked}
                        onClick={() => setNameDialog({ kind: "backup", world })}
                      >
                        <Archive className="size-4" />
                        {t("worlds.backup")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={world.locked}
                        onClick={() => void exportWorld(world)}
                      >
                        <Upload className="size-4" />
                        {t("worlds.export")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={world.locked}
                        onClick={() => setConfirm({ kind: "deleteWorld", world })}
                      >
                        <Trash2 className="size-4" />
                        {t("worlds.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t("worlds.backups")}</h3>
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("worlds.backupsEmpty")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {backups.map((backup) => {
                const busyBackup = busy?.endsWith(`:${backup.file}`) ?? false;
                return (
                  <li key={backup.file} className="flex items-center gap-3 px-3 py-2">
                    <Archive className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{backup.file}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          backup.world,
                          formatBytes(backup.size_bytes),
                          new Date(backup.created_ms).toLocaleString(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {busyBackup ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setNameDialog({ kind: "restore", backup })}
                        >
                          <Download className="size-4" />
                          {t("worlds.restore")}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("worlds.deleteBackup")}
                          onClick={() => setConfirm({ kind: "deleteBackup", backup })}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t("worlds.title")}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void pickImport()}
            >
              <FolderInput className="size-4" />
              {t("worlds.import")}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("instances.refresh")}
              onClick={() => void load()}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{renderBody()}</CardContent>

      {nameDialog && (
        <NameDialog
          state={nameDialog}
          existingNames={existingNames}
          busy={busy !== null}
          onCancel={() => setNameDialog(null)}
          onSubmit={submitNameDialog}
        />
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "deleteWorld"
                ? t("worlds.deleteTitle")
                : t("worlds.backupDeleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "deleteWorld"
                ? t("worlds.deleteConfirm", { name: confirm.world.name })
                : confirm?.kind === "deleteBackup"
                  ? t("worlds.backupDeleteConfirm", { name: confirm.backup.file })
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={submitConfirm}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
