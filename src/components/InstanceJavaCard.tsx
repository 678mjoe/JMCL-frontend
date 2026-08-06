import { Coffee } from "lucide-react";
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
import { useSettings } from "@/lib/settings";
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

/**
 * Per-instance launch Java selection. Picking an explicit executable becomes
 * `java_override` at launch, which skips the exact-major/architecture gates
 * (docs/java.md §Forced Override). "auto" keeps the core's java_policy chain.
 */
export function InstanceJavaCard({ instance }: { instance: InstanceManifest }) {
  const { settings, update, t } = useSettings();
  const { local, managed } = useJavaCatalog();
  const override = settings.javaOverrides[instance.id];
  const loading = local.status === "loading" || managed.status === "loading";
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
        {override && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={override}>
            {override}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
