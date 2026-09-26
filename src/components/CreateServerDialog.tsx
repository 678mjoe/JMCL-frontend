import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorText, useLauncher } from "@/lib/launcher";
import { listLoaderVersions } from "@/lib/loaderVersions";
import { useServers } from "@/lib/servers";
import { useSettings } from "@/lib/settings";
import type { ServerManifest, VersionSummary } from "@/lib/types";
import {
  deriveServerId,
  isLoaderVersionSelectionValid,
  isValidServerId,
  resetLoaderVersionSelection,
  submitServerCreate,
  type LoaderChoice,
} from "@/lib/serverCreate";

export interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (server: ServerManifest) => void;
}

export function CreateServerDialog({ open, onOpenChange, onCreated }: CreateServerDialogProps) {
  const { t, settings } = useSettings();
  const { session } = useLauncher();
  const { manifests, recordCreated } = useServers();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [loader, setLoader] = useState<LoaderChoice>("none");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionsState, setVersionsState] = useState<"loading" | "ready" | "error">("loading");
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderState, setLoaderState] = useState<"ready" | "loading" | "error">("ready");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setId("");
    setIdTouched(false);
    setVersionId("");
    setLoader("none");
    setLoaderVersion("");
    setPending(false);
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    setVersionsState("loading");
    session.versionList({ type: settings.hideTestVersions ? "release" : undefined, limit: 1000 })
      .then((result) => {
        if (cancelled) return;
        setVersions(result.versions);
        setVersionsState("ready");
      })
      .catch(() => {
        if (!cancelled) setVersionsState("error");
      });
    return () => { cancelled = true; };
  }, [open, session, settings.hideTestVersions]);

  useEffect(() => {
    if (!open || loader === "none" || !versionId) {
      setLoaderVersions([]);
      setLoaderState("ready");
      return;
    }
    let cancelled = false;
    setLoaderState("loading");
    listLoaderVersions(loader, versionId)
      .then((items) => {
        if (!cancelled) {
          setLoaderVersions(items);
          setLoaderState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaderVersions([]);
          setLoaderState("error");
        }
      });
    return () => { cancelled = true; };
  }, [loader, open, versionId]);

  const idValid = isValidServerId(id);
  const duplicate = manifests.some((server) => server.id === id);
  const canSubmit = Boolean(session && settings.serversDir && versionId && idValid && !duplicate &&
    isLoaderVersionSelectionValid(loader, loaderVersion, loaderVersions, loaderState) && !pending);

  const onNameChange = useCallback((value: string) => {
    setName(value);
    if (!idTouched) setId(deriveServerId(value));
  }, [idTouched]);

  const submit = useCallback(async () => {
    if (!session || !canSubmit) return;
    setPending(true);
    setSubmitError(null);
    try {
      await submitServerCreate({
        session,
        directory: settings.serversDir,
        id,
        versionId,
        name,
        source: settings.source,
        loader,
        loaderVersion,
        recordCreated,
        onCreated,
      });
    } catch (error) {
      setSubmitError(errorText(error));
      setPending(false);
    }
  }, [canSubmit, id, loader, loaderVersion, name, onCreated, recordCreated, session, settings.serversDir, settings.source, versionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t("serverCreate.title")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-create-name">{t("create.name")}</Label>
            <Input id="server-create-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-create-id">{t("create.id")}</Label>
            <Input
              id="server-create-id"
              value={id}
              aria-invalid={id.length > 0 && !idValid}
              onChange={(event) => { setIdTouched(true); setId(event.target.value); }}
            />
            <p className={`text-xs ${id.length > 0 && !idValid ? "text-destructive" : "text-muted-foreground"}`}>
              {id.length > 0 && !idValid ? t("serverCreate.validation") : t("serverCreate.idHint")}
            </p>
            {duplicate && <p className="text-xs text-destructive">{t("serverCreate.duplicate")}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-create-version">{t("create.version")}</Label>
            <Select value={versionId || null} onValueChange={(value) => {
              if (value && value !== versionId) {
                setVersionId(value);
                const reset = resetLoaderVersionSelection(loader);
                setLoaderVersion(reset.loaderVersion);
                setLoaderVersions(reset.loaderVersions);
                setLoaderState(reset.loaderState);
              }
            }}>
              <SelectTrigger id="server-create-version" className="w-full">
                <SelectValue>{versionsState === "loading" ? t("create.versionLoading") : versionId || t("create.versionPlaceholder")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => <SelectItem key={version.id} value={version.id}>{version.id}</SelectItem>)}
              </SelectContent>
            </Select>
            {versionsState === "error" && <p className="text-xs text-destructive">{t("create.versionError")}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-create-loader">{t("create.loader")}</Label>
            <Select value={loader} onValueChange={(value) => { if (value) { setLoader(value as LoaderChoice); setLoaderVersion(""); } }}>
              <SelectTrigger id="server-create-loader" className="w-full"><SelectValue>{loader === "none" ? t("servers.loaderNone") : loader}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("servers.loaderNone")}</SelectItem>
                <SelectItem value="fabric">Fabric</SelectItem>
                <SelectItem value="neoforge">NeoForge</SelectItem>
                <SelectItem value="forge">Forge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loader !== "none" && (
            <div className="space-y-2">
              <Label htmlFor="server-create-loader-version">{t("create.loaderVersion")}</Label>
              <Select value={loaderVersion || null} disabled={loaderState !== "ready" || loaderVersions.length === 0} onValueChange={(value) => { if (value) setLoaderVersion(value); }}>
                <SelectTrigger id="server-create-loader-version" className="w-full"><SelectValue>{loaderState === "loading" ? t("create.loaderVersionLoading") : loaderVersion || t("create.loaderVersionPlaceholder")}</SelectValue></SelectTrigger>
                <SelectContent>{loaderVersions.map((version) => <SelectItem key={version} value={version}>{version}</SelectItem>)}</SelectContent>
              </Select>
              {loaderState === "error" && <p className="text-xs text-destructive">{t("create.loaderVersionError")}</p>}
            </div>
          )}
          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>{pending ? t("serverCreate.creating") : t("serverCreate.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
