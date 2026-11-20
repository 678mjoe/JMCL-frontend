import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { ContentManager } from "@/components/ContentManager";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText, useLauncher } from "@/lib/launcher";
import { useSettings } from "@/lib/settings";
import type { InstanceManifest } from "@/lib/types";
import { loaderLabel } from "@/pages/InstanceDetailPage";

export interface InstanceContentPageProps {
  instanceId: string;
  onBack: () => void;
}

/**
 * Standalone content management page for one instance (mods / resource packs /
 * shader packs). Reached from the instance card menu or the detail page.
 */
export function InstanceContentPage({
  instanceId,
  onBack,
}: InstanceContentPageProps) {
  const { session, status, error: coreError } = useLauncher();
  const { settings, t } = useSettings();
  const scope = `${settings.instancesDir}\0${instanceId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const [manifestScope, setManifestScope] = useState("");
  const [manifest, setManifest] = useState<InstanceManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session || status !== "ready" || !settings.instancesDir) return;
    const id = ++request.current;
    const current = () => alive.current && scopeRef.current === scope && request.current === id;
    setLoading(true);
    setLoadError(null);
    try {
      const value = await session.instanceGet(settings.instancesDir, instanceId);
      if (current()) { setManifest(value); setManifestScope(scope); }
    } catch (e) {
      if (current()) { setLoadError(errorText(e)); setManifest(null); }
    } finally {
      if (current()) setLoading(false);
    }
  }, [session, status, settings.instancesDir, instanceId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = status === "starting" ||
    (status === "ready" && (loading || manifestScope !== scope) && !loadError);
  const failureMessage = status === "error" ? coreError : loadError;
  const currentManifest = !waiting && status === "ready" && manifestScope === scope ? manifest : null;
  const loader = currentManifest && loaderLabel(currentManifest);

  return (
    <div className="jmcl-page">
      <Button variant="ghost" size="sm" className="jmcl-back" onClick={onBack}>
        <ArrowLeft />
        {t("content.back")}
      </Button>
      <header className="jmcl-page-header">
        <div className="min-w-0">
          <h1 className="jmcl-page-title">{t("content.title")}</h1>
          {currentManifest && (
            <p className="jmcl-page-description wrap-anywhere">
              <span className="font-medium text-foreground">{currentManifest.name}</span> <span aria-hidden="true">·</span> Minecraft {currentManifest.version_id}{loader && <> <span aria-hidden="true">·</span> {loader}</>}
            </p>
          )}
        </div>
      </header>

      {waiting ? (
        <div role="status">
          <span className="sr-only">{t(status === "starting" ? "core.starting" : "common.loading")}</span>
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : currentManifest ? (
        <div className="min-w-0 [&_[data-slot=tabs-list]]:max-w-full [&_[data-slot=tabs-list]]:justify-start [&_[data-slot=tabs-list]]:overflow-x-auto">
          <ContentManager key={scope} instance={currentManifest} />
        </div>
      ) : (
        <section className="jmcl-panel jmcl-state">
          <div role="alert" className="flex min-w-0 flex-col items-center gap-2">
            <AlertCircle aria-hidden="true" className="size-7 text-destructive" />
            <h2 className="text-base font-semibold">{t(status === "error" ? "core.error" : "detail.loadError")}</h2>
            {failureMessage && <p className="max-w-lg break-words text-sm text-muted-foreground">{failureMessage}</p>}
          </div>
          {status === "ready" && (
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw />
              {t("common.retry")}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
