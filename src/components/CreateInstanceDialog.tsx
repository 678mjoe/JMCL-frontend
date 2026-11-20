import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search } from "lucide-react";
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
  const [editingId, setEditingId] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [choosingVersion, setChoosingVersion] = useState(false);
  const [versionSearch, setVersionSearch] = useState("");
  const versionButton = useRef<HTMLButtonElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const restoreVersionFocus = useRef(false);
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
    setEditingId(false);
    setVersionId("");
    setChoosingVersion(false);
    setVersionSearch("");
    restoreVersionFocus.current = false;
    setLoader("none");
    setLoaderVersion("");
    setLoaderVersions([]);
    setLoaderVersionsState("ready");
    setPending(false);
    setSubmitError(null);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (choosingVersion) {
      versionInput.current?.focus();
    } else if (restoreVersionFocus.current) {
      versionButton.current?.focus();
      restoreVersionFocus.current = false;
    }
  }, [open, choosingVersion]);

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
  const needsId = !!name.trim() && !idValid;
  const idInvalid = needsId || (id.length > 0 && !idValid);
  const showId = editingId || needsId;
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

  const returnToForm = () => {
    restoreVersionFocus.current = true;
    setChoosingVersion(false);
  };

  const selectVersion = (version: VersionSummary | null) => {
    if (!version) return;
    if (version.id !== versionId) {
      setVersionId(version.id);
      setLoaderVersion("");
    }
    returnToForm();
  };

  const selectLoader = (value: string | null) => {
    if (!value) return;
    setLoader(value as LoaderKind);
    setLoaderVersion("");
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen, event) => {
      if (choosingVersion && event.reason === "escape-key") {
        event.cancel();
        returnToForm();
      } else {
        onOpenChange(nextOpen);
      }
    }}>
      <DialogContent className="flex max-w-[30rem] flex-col gap-4 overflow-hidden shadow-[var(--jmcl-menu-shadow)] sm:p-6">
        <DialogHeader className="shrink-0 flex-row items-center gap-2">
          {choosingVersion && (
            <Button variant="ghost" size="icon-sm" className="-ml-1.5" aria-label={t("create.backToForm")} onClick={returnToForm}>
              <ArrowLeft aria-hidden="true" />
            </Button>
          )}
          <DialogTitle className="text-xl">{t(choosingVersion ? "create.versionPlaceholder" : "create.title")}</DialogTitle>
        </DialogHeader>

        {choosingVersion ? (
          <div className="flex min-h-0 flex-col gap-3">
            <Combobox.Root
              inline
              open
              items={versionsState === "ready" ? versions : []}
              itemToStringLabel={(version: VersionSummary) => version.id}
              value={versions.find((version) => version.id === versionId) ?? null}
              inputValue={versionSearch}
              onInputValueChange={setVersionSearch}
              onValueChange={selectVersion}
              autoHighlight
            >
              <div className="relative shrink-0">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Combobox.Input
                  ref={versionInput}
                  aria-label={t("create.versionSearch")}
                  placeholder={t("create.versionSearch")}
                  className="jmcl-field h-9 w-full pl-9 placeholder:text-muted-foreground"
                />
              </div>
              <div className="relative h-48 min-h-0 rounded-md border bg-background">
                <Combobox.List className="h-full overflow-y-auto overscroll-contain p-1">
                  {(version: VersionSummary) => (
                    <Combobox.Item key={version.id} value={version} className="flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 leading-tight outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                      <span className="min-w-0 wrap-anywhere">{version.id}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {version.type && version.type !== "release" && t("create.testVersion")}
                        <Combobox.ItemIndicator><Check className="size-3.5" aria-hidden="true" /></Combobox.ItemIndicator>
                      </span>
                    </Combobox.Item>
                  )}
                </Combobox.List>
                <Combobox.Empty className="pointer-events-none absolute inset-x-0 top-3 px-3 text-sm text-muted-foreground">
                  {versionsState === "ready" && t("create.versionNoMatches")}
                </Combobox.Empty>
                {versionsState === "loading" && (
                  <p role="status" className="absolute inset-x-0 top-3 px-3 text-muted-foreground">{t("create.versionLoading")}</p>
                )}
                {versionsState === "error" && (
                  <div className="absolute inset-x-0 top-2 flex flex-wrap items-center gap-2 px-3">
                    <p role="alert" className="text-sm text-destructive">{t("create.versionError")}</p>
                    <Button variant="outline" size="sm" onClick={() => setFetchNonce((nonce) => nonce + 1)}>{t("common.retry")}</Button>
                  </div>
                )}
              </div>
            </Combobox.Root>
            <div className="flex shrink-0 items-center gap-2">
              <Checkbox
                id="create-hide-test-versions"
                checked={settings.hideTestVersions}
                onCheckedChange={(hidden) => {
                  if (hidden && versions.find((version) => version.id === versionId)?.type !== "release") {
                    setVersionId("");
                    setLoaderVersion("");
                  }
                  update({ hideTestVersions: hidden });
                }}
              />
              <Label htmlFor="create-hide-test-versions" className="text-xs font-normal text-muted-foreground">
                {t("create.hideTestVersions")}
              </Label>
            </div>
          </div>
        ) : (
          <>
            <div className="-mx-(--jmcl-panel-padding) -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--jmcl-panel-padding) py-1 sm:-mx-6 sm:px-6">
              <div className="grid grid-cols-1 gap-x-3 gap-y-4 min-[390px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="col-span-full flex flex-col gap-2">
                  <Label htmlFor="create-name">{t("create.name")}</Label>
                  <Input
                    id="create-name"
                    value={name}
                    placeholder={t("create.namePlaceholder")}
                    onChange={(e) => onNameChange(e.target.value)}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="create-version">{t("create.version")}</Label>
                  <Button
                    ref={versionButton}
                    id="create-version"
                    variant="outline"
                    aria-describedby="create-version-value"
                    className="jmcl-field w-full justify-between gap-2 text-left font-normal"
                    onClick={() => {
                      setVersionSearch("");
                      setChoosingVersion(true);
                    }}
                  >
                    <span id="create-version-value" className={cn("min-w-0 truncate", !versionId && "text-muted-foreground")}>
                      {versionId || t("create.versionPlaceholder")}
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
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
                  <div className="col-span-full flex min-w-0 flex-col gap-2">
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

                <div className="col-span-full flex flex-col gap-2">
                  {!needsId && (
                    <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5 px-2 text-xs font-normal text-muted-foreground" aria-expanded={showId} onClick={() => setEditingId(!editingId)}>
                      <ChevronDown className={cn("size-3.5 transition-transform", !showId && "-rotate-90")} aria-hidden="true" />
                      {t("create.customId")}
                    </Button>
                  )}
                  {showId && (
                    <>
                      <Label htmlFor="create-id">{t("create.id")}</Label>
                      <Input
                        id="create-id"
                        value={id}
                        aria-invalid={idInvalid}
                        aria-describedby="create-id-hint"
                        onChange={(e) => {
                          setEditingId(true);
                          setIdTouched(true);
                          setId(e.target.value);
                        }}
                      />
                      <p id="create-id-hint" className={cn("text-xs", idInvalid ? "text-destructive" : "text-muted-foreground")}>{t("create.idHint")}</p>
                    </>
                  )}
                </div>
                {submitError && <p role="alert" className="col-span-full text-xs wrap-anywhere text-destructive">{submitError}</p>}
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t pt-3">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={!canSubmit} onClick={submit}>
                {pending ? t("create.creating") : t("create.submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
