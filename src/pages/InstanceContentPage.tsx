import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Gamepad2, RefreshCw } from "lucide-react";
import { ContentManager } from "@/components/ContentManager";
import { Badge } from "@/components/ui/badge";
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
  const { session, status } = useLauncher();
  const { settings, t } = useSettings();
  const [manifest, setManifest] = useState<InstanceManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session || status !== "ready") return;
    setLoading(true);
    setLoadError(null);
    try {
      setManifest(
        await session.instanceGet(settings.instancesDir, instanceId),
      );
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [session, status, settings.instancesDir, instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if ((loading && !manifest && !loadError) || status === "starting") {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (loadError || !manifest) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {t("detail.back")}
        </Button>
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <Gamepad2 className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t("detail.loadError")}</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw />
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const loader = loaderLabel(manifest);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          {t("content.back")}
        </Button>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold">{manifest.name}</h1>
          <Badge variant="secondary">{manifest.version_id}</Badge>
          {loader && <Badge variant="outline">{loader}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("content.title")}
        </p>
      </div>

      <ContentManager instance={manifest} />
    </div>
  );
}
