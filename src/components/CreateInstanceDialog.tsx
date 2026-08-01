import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorText, useLauncher } from "@/lib/launcher";
import {
  listLoaderVersions,
  type CatalogLoader,
} from "@/lib/loaderVersions";
import { useSettings } from "@/lib/settings";
import type { InstanceManifest, LoaderFields, VersionSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface CreateInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after instance.create succeeds; caller usually starts the install task. */
  onCreated: (instance: InstanceManifest) => void;
}

type LoaderKind = "none" | CatalogLoader;
type LoadState = "loading" | "error" | "ready";

/** Derive a candidate instance id from a display name. */
function deriveId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/([._-])\1+/g, "$1")
    .replace(/^[^a-z0-9]+/, "");
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function CreateInstanceDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateInstanceDialogProps) {
  const { t, settings, update } = useSettings();
  const { session } = useLauncher();

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [loader, setLoader] = useState<LoaderKind>("none");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionsState, setVersionsState] = useState<LoadState>("loading");
  const [fetchNonce, setFetchNonce] = useState(0);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersionsState, setLoaderVersionsState] =
    useState<LoadState>("ready");

  // Reset transient state every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setId("");
    setIdTouched(false);
    setVersionId("");
    setLoader("none");
    setLoaderVersion("");
    setLoaderVersions([]);
    setLoaderVersionsState("ready");
    setPending(false);
    setSubmitError(null);
  }, [open]);

  // Fetch the version list while open, once the core session is ready.
  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    setVersionsState("loading");
    session
      .versionList({
        type: settings.hideTestVersions ? "release" : undefined,
        limit: 1000,
      })
      .then((result) => {
        if (cancelled) return;
        setVersions(result.versions);
        setVersionsState("ready");
      })
      .catch(() => {
        if (!cancelled) setVersionsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, session, fetchNonce, settings.hideTestVersions]);

  useEffect(() => {
    if (!open || loader === "none" || !versionId) {
      setLoaderVersions([]);
      setLoaderVersionsState("ready");
      return;
    }

    let cancelled = false;
    setLoaderVersions([]);
    setLoaderVersionsState("loading");
    listLoaderVersions(loader, versionId)
      .then((result) => {
        if (cancelled) return;
        setLoaderVersions(result);
        setLoaderVersionsState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoaderVersions([]);
        setLoaderVersionsState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, loader, versionId]);

  const idValid = ID_RE.test(id) && !id.endsWith(".");
  const loaderVersionOk = loader === "none" || loaderVersion.trim().length > 0;
  const canSubmit = !pending && idValid && versionId !== "" && loaderVersionOk;

  const onNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!idTouched) setId(deriveId(value));
    },
    [idTouched],
  );

  const submit = useCallback(async () => {
    if (!session || !canSubmit) return;
    setPending(true);
    setSubmitError(null);
    const loaderField: LoaderFields =
      loader === "fabric"
        ? { fabric_loader: loaderVersion.trim() }
        : loader === "neoforge"
          ? { neoforge_version: loaderVersion.trim() }
          : loader === "forge"
            ? { forge_version: loaderVersion.trim() }
            : {};
    try {
      // Write the manifest immediately; the caller validates the
      // version+loader combination in the background (contract §4).
      const manifest = await session.instanceCreate(
        settings.instancesDir,
        id,
        versionId,
        {
          name: name.trim() || id,
          source: settings.source,
          validate: false,
          ...loaderField,
        },
      );
      onCreated(manifest);
    } catch (e) {
      setSubmitError(errorText(e));
      setPending(false);
    }
  }, [session, canSubmit, loader, loaderVersion, settings, id, versionId, name, onCreated]);

  const selectVersion = (value: string | null) => {
    if (!value) return;
    setVersionId(value);
    setLoaderVersion("");
  };

  const selectLoader = (value: string | null) => {
    if (!value) return;
    setLoader(value as LoaderKind);
    setLoaderVersion("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-name">{t("create.name")}</Label>
              <Input
                id="create-name"
                value={name}
                placeholder={t("create.namePlaceholder")}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="create-id">{t("create.id")}</Label>
              <Input
                id="create-id"
                value={id}
                aria-invalid={id.length > 0 && !idValid}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
              />
              <p
                className={cn(
                  "text-xs",
                  id.length > 0 && !idValid
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {t("create.idHint")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="create-version">{t("create.version")}</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="create-hide-test-versions"
                    checked={settings.hideTestVersions}
                    onCheckedChange={(hidden) => {
                      if (
                        hidden &&
                        versions.find((version) => version.id === versionId)
                          ?.type !== "release"
                      ) {
                        setVersionId("");
                        setLoaderVersion("");
                      }
                      update({ hideTestVersions: hidden });
                    }}
                  />
                  <Label
                    htmlFor="create-hide-test-versions"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {t("create.hideTestVersions")}
                  </Label>
                </div>
              </div>
              <Select
                value={versionId || null}
                disabled={versionsState !== "ready"}
                onValueChange={selectVersion}
              >
                <SelectTrigger id="create-version" className="w-full">
                  <SelectValue>
                    {versionsState === "loading"
                      ? t("create.versionLoading")
                      : versionId || t("create.versionPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-[min(18rem,var(--available-height))]">
                  {versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {version.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {versionsState === "error" && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-destructive">
                    {t("create.versionError")}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFetchNonce((nonce) => nonce + 1)}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="create-loader">{t("create.loader")}</Label>
              <Select value={loader} onValueChange={selectLoader}>
                <SelectTrigger id="create-loader" className="w-full">
                  <SelectValue>
                    {loader === "none"
                      ? t("create.loader.none")
                      : loader === "fabric"
                        ? "Fabric"
                        : loader === "neoforge"
                          ? "NeoForge"
                          : "Forge"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("create.loader.none")}</SelectItem>
                  <SelectItem value="fabric">Fabric</SelectItem>
                  <SelectItem value="neoforge">NeoForge</SelectItem>
                  <SelectItem value="forge">Forge</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loader !== "none" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="create-loader-version">
                  {t("create.loaderVersion")}
                </Label>
                {!versionId ? (
                  <Select disabled>
                    <SelectTrigger
                      id="create-loader-version"
                      className="w-full"
                    >
                      <SelectValue>{t("create.selectVersionFirst")}</SelectValue>
                    </SelectTrigger>
                  </Select>
                ) : loaderVersionsState === "loading" ? (
                  <Select disabled>
                    <SelectTrigger
                      id="create-loader-version"
                      className="w-full"
                    >
                      <SelectValue>
                        {t("create.loaderVersionLoading")}
                      </SelectValue>
                    </SelectTrigger>
                  </Select>
                ) : loaderVersionsState === "error" ? (
                  <>
                    <p className="text-xs text-destructive">
                      {t("create.loaderVersionError")}
                    </p>
                    <Input
                      id="create-loader-version"
                      value={loaderVersion}
                      placeholder={t("create.loaderVersionPlaceholder")}
                      onChange={(event) => setLoaderVersion(event.target.value)}
                    />
                  </>
                ) : loaderVersions.length === 0 ? (
                  <Select disabled>
                    <SelectTrigger
                      id="create-loader-version"
                      className="w-full"
                    >
                      <SelectValue>{t("create.loaderVersionEmpty")}</SelectValue>
                    </SelectTrigger>
                  </Select>
                ) : (
                  <Select
                    value={loaderVersion || null}
                    onValueChange={(value) => {
                      if (value) setLoaderVersion(value);
                    }}
                  >
                    <SelectTrigger
                      id="create-loader-version"
                      className="w-full"
                    >
                      <SelectValue>
                        {loaderVersion || t("create.loaderVersionPlaceholder")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(18rem,var(--available-height))]">
                      {loaderVersions.map((catalogVersion) => (
                        <SelectItem key={catalogVersion} value={catalogVersion}>
                          {catalogVersion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {pending ? t("create.creating") : t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
