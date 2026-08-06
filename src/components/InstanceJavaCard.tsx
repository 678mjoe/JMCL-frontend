import { useCallback, useEffect, useState } from "react";
import { Coffee, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useJavaCatalog } from "@/lib/java";
import { useLauncher } from "@/lib/launcher";
import { useSettings } from "@/lib/settings";
import { loaderFieldsOf } from "@/lib/tasks";
import type { InstanceManifest, JavaRuntime, ManagedJavaRuntime } from "@/lib/types";

const AUTO = "auto";

function optionLabel(runtime: JavaRuntime | ManagedJavaRuntime): string {
  const major =
    "major_version" in runtime && runtime.major_version != null
      ? `Java ${runtime.major_version}`
      : "Java";
  const vendor = runtime.vendor ? ` · ${runtime.vendor}` : "";
  return `${major}${vendor}`;
}

/** version.resolve majors are immutable per (version, loader) - cache in memory. */
const majorCache = new Map<string, number>();

type MajorState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; major: number | null };

/**
 * Per-instance launch Java selection plus the recommended Java major from
 * version.resolve. Picking an explicit executable becomes `java_override` at
 * launch, which skips the exact-major/architecture gates (docs/java.md §Forced
 * Override). "auto" keeps the core's java_policy chain.
 */
export function InstanceJavaCard({ instance }: { instance: InstanceManifest }) {
  const { settings, update, t } = useSettings();
  const { session, status } = useLauncher();
  const { local, managed, satisfiedMajors } = useJavaCatalog();
  const override = settings.javaOverrides[instance.id];
  const loading = local.status === "loading" || managed.status === "loading";

  const cacheKey = [
    instance.source,
    instance.version_id,
    instance.fabric_loader ?? instance.neoforge_version ?? instance.forge_version ?? "",
  ].join(":");
  const [majorState, setMajorState] = useState<MajorState>(() => {
    const cached = majorCache.get(cacheKey);
    return cached != null ? { status: "ready", major: cached } : { status: "loading" };
  });

  const resolveMajor = useCallback(async () => {
    if (!session || status !== "ready") return;
    const cached = majorCache.get(cacheKey);
    if (cached != null) {
      setMajorState({ status: "ready", major: cached });
      return;
    }
    setMajorState({ status: "loading" });
    try {
      const result = await session.versionResolve(instance.version_id, {
        source: instance.source,
        ...loaderFieldsOf(instance),
      });
      const major = result.java_major_version ?? null;
      if (major != null) majorCache.set(cacheKey, major);
      setMajorState({ status: "ready", major });
    } catch {
      setMajorState({ status: "error" });
    }
  }, [session, status, cacheKey, instance]);

  useEffect(() => {
    void resolveMajor();
  }, [resolveMajor]);

  const recommended =
    majorState.status === "ready" ? majorState.major : null;
  const overrideRuntime = override
    ? [...local.items, ...managed.items].find((r) => r.executable === override)
    : undefined;
  const overrideMismatch =
    recommended != null &&
    overrideRuntime?.major_version != null &&
    overrideRuntime.major_version !== recommended;

  // Items mount lazily, so map values to labels explicitly for the trigger.
  const labels: Record<string, string> = { [AUTO]: t("java.auto") };
  for (const runtime of local.items) labels[runtime.executable] = optionLabel(runtime);
  for (const runtime of managed.items) {
    labels[runtime.executable] = `${optionLabel(runtime)} · ${t("java.managedBadge")}`;
  }

  const choose = (value: string | null) => {
    if (value === null) return;
    const next = { ...settings.javaOverrides };
    if (value === AUTO) delete next[instance.id];
    else next[instance.id] = value;
    update({ javaOverrides: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coffee className="size-4" />
          {t("java.override")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {majorState.status === "loading" ? (
          <Skeleton className="h-5 w-40" />
        ) : majorState.status === "error" ? (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void resolveMajor()}
          >
            <RefreshCw className="size-3" />
            {t("java.recommendedFailed")}
          </button>
        ) : recommended != null ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("java.recommended")}</span>
            <span className="font-medium">Java {recommended}</span>
            {satisfiedMajors.has(recommended) ? (
              <Badge variant="secondary">{t("java.satisfied")}</Badge>
            ) : (
              <Badge variant="destructive">{t("java.missing")}</Badge>
            )}
          </p>
        ) : null}
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={override ?? AUTO} onValueChange={choose}>
            <SelectTrigger className="w-full">
              <SelectValue>{(value: string) => labels[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{t("java.auto")}</SelectItem>
              {local.items.map((runtime) => (
                <SelectItem key={runtime.executable} value={runtime.executable}>
                  {optionLabel(runtime)}
                </SelectItem>
              ))}
              {managed.items.map((runtime) => (
                <SelectItem key={runtime.executable} value={runtime.executable}>
                  {optionLabel(runtime)} · {t("java.managedBadge")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {override && (
          <p className="text-xs text-muted-foreground">
            {t("java.overrideWarning")}
          </p>
        )}
        {overrideMismatch && (
          <p className="text-xs text-destructive">
            {t("java.overrideMismatch", { major: recommended })}
          </p>
        )}
        {override && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={override}>
            {override}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
