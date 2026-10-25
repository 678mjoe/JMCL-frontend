import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { absoluteJavaPath, javaPreferencesFor, withJavaPreferences, type JavaPreferences } from "@/lib/javaPreferences";
import { instanceMutationKey } from "@/lib/instanceCoordinator";
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
  const { settings } = useSettings();
  const scope = JSON.stringify([instanceMutationKey(settings.instancesDir, instance.id), settings.storeDir, javaPreferencesFor(settings.javaPreferences, settings.instancesDir, instance.id), instance.version_id, instance.source, instance.fabric_loader, instance.neoforge_version, instance.forge_version]);
  return <JavaEditor key={scope} instance={instance} />;
}
function JavaEditor({ instance }: { instance: InstanceManifest }) {
  const { settings, update, t } = useSettings();
  const { session, status } = useLauncher();
  const { local, managed, satisfiedMajors, target } = useJavaCatalog();
  const saved = javaPreferencesFor(settings.javaPreferences, settings.instancesDir, instance.id);
  const override = saved.override;
  const zh = settings.language === "zh";
  const [path, setPath] = useState(saved.paths?.[0] ?? override ?? "");
  const [trusted, setTrusted] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const revision = useRef(0);
  const majorRevision = useRef(0);
  useEffect(() => () => { revision.current++; majorRevision.current++; }, []);
  const save = (value: JavaPreferences) => update({ javaPreferences: withJavaPreferences(settings.javaPreferences, settings.instancesDir, instance.id, value) });
  const changePath = (value: string) => { revision.current++; setPath(value); setTrusted(false); setProbe(null); setProbing(false); };
  useEffect(() => { revision.current++; setProbe(null); setProbing(false); }, [session, status]);
  const detect = async () => {
    if (!session || status !== "ready" || !trusted || !absoluteJavaPath(path) || probing) return;
    const current = ++revision.current;
    setProbing(true); setProbe(null);
    try {
      const result = await session.javaDetect([path]);
      if (revision.current !== current) return;
      // Core may include environment candidates: show only the explicitly requested executable.
      const runtime = result.runtimes?.find(r => r.executable === path);
      setProbe(runtime ? `Java ${runtime.major_version ?? "?"} · ${runtime.architecture ?? "?"}` : (zh ? "未能探测此路径。" : "Could not probe this path."));
    } catch { if (revision.current === current) setProbe(zh ? "探测失败。" : "Probe failed."); }
    finally { if (revision.current === current) setProbing(false); }
  };
  const loading = local.status === "loading" || managed.status === "loading";

  const cacheKey = JSON.stringify([instance.source, instance.version_id, loaderFieldsOf(instance)]);
  const [majorState, setMajorState] = useState<MajorState>(() => {
    const cached = majorCache.get(cacheKey);
    return cached != null ? { status: "ready", major: cached } : { status: "loading" };
  });

  const resolveMajor = useCallback(async () => {
    const current = ++majorRevision.current;
    if (!session || status !== "ready") { setMajorState({ status: "loading" }); return; }
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
      if (majorRevision.current === current) setMajorState({ status: "ready", major });
    } catch {
      if (majorRevision.current === current) setMajorState({ status: "error" });
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
  const policyLabel = zh ? "按策略选择（清除自定义路径）" : "Use policy (clear custom path)";
  const labels: Record<string, string> = { [AUTO]: policyLabel };
  for (const runtime of local.items) labels[runtime.executable] = optionLabel(runtime);
  for (const runtime of managed.items) {
    labels[runtime.executable] = `${optionLabel(runtime)} · ${t("java.managedBadge")}`;
  }

  const choose = (value: string | null) => {
    if (value === null) return;
    save(value === AUTO ? { policy: saved.policy } : { policy: saved.policy, override: value });
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
            {!target || local.status !== "ready" || managed.status !== "ready" ? (
              <Badge variant="outline">{zh ? "目录兼容性待确认" : "Catalog compatibility unknown"}</Badge>
            ) : satisfiedMajors.has(recommended) ? (
              <Badge variant="secondary">{zh ? "目录有匹配候选" : "Catalog match"}</Badge>
            ) : (
              <Badge variant="outline">{zh ? "目录暂无匹配候选" : "No catalog match"}</Badge>
            )}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{zh ? "目录匹配仅为本机进程目标架构下的候选提示，托管记录可能过期；最终由 Core 按策略重新探测。" : "Catalog matches are hints for the packaged process target architecture. Managed receipts can be stale; Core re-probes according to policy."}</p>
        <label className="block text-sm">{zh ? "Java 选择策略" : "Java selection policy"}
          <select aria-label="Java policy" className="ml-2 rounded border p-1" value={saved.policy} onChange={e => save({ ...saved, policy: e.target.value as JavaPreferences["policy"] })}>
            <option value="auto">{zh ? "自动（本地优先）" : "Auto (local first)"}</option>
            <option value="local">{zh ? "仅本地（不下载）" : "Local only (no download)"}</option>
            <option value="managed">{zh ? "托管优先（仍可回退本地）" : "Managed first (local fallback)"}</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{zh ? "自动：本地 → 已安装托管 → 下载；托管优先：已安装托管 → 本地 → 下载。普通候选仍需匹配版本和架构；预览不会下载 Java。" : "Auto: local → installed managed → download. Managed first: installed managed → local → download. Candidates must match major and architecture; preview never downloads Java."}</p>
        <p className="text-sm">{zh ? "强制覆盖（高级；绕过版本及架构匹配）" : "Forced override (advanced; bypasses major and architecture matching)"}</p>
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={override ?? AUTO} onValueChange={choose}>
            <SelectTrigger className="w-full">
              <SelectValue>{(value: string) => labels[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{policyLabel}</SelectItem>
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
        <label className="block text-sm">{zh ? "自定义 Java 可执行文件绝对路径" : "Custom Java executable absolute path"}
          <input aria-label="Custom Java path" className="mt-1 w-full rounded border p-2 font-mono text-xs" value={path} onChange={e => changePath(e.target.value)} />
        </label>
        <label className="block text-xs"><input type="checkbox" checked={trusted} onChange={e => setTrusted(e.target.checked)} /> {zh ? "我信任此可执行文件；探测和启动会执行它。" : "I trust this executable; probing and launching execute it."}</label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!trusted || !absoluteJavaPath(path) || probing || status !== "ready"} onClick={() => void detect()}>{zh ? "探测路径" : "Probe path"}</Button>
          <Button variant="outline" disabled={!trusted || !absoluteJavaPath(path)} onClick={() => save({ policy: saved.policy, paths: [path] })}>{zh ? "保存为普通候选" : "Save as candidate"}</Button>
          <Button variant="outline" disabled={!trusted || !absoluteJavaPath(path)} onClick={() => save({ policy: saved.policy, override: path })}>{zh ? "保存为强制覆盖" : "Save forced override"}</Button>
        </div>
        {probe && <p role="status" className="text-xs">{probe}</p>}
        {saved.paths?.length ? <p className="break-all text-xs">{zh ? "普通候选（安装与启动均验证版本和架构）：" : "Candidate (install and launch validate major and architecture): "}{saved.paths.join(", ")}</p> : null}
        {settings.javaOverrides[instance.id] && <div className="rounded border p-2 text-xs">
          <p>{zh ? "旧版仅按实例 ID 保存的覆盖路径未自动启用，无法确认所属目录。确认此路径属于当前实例后再手动导入。" : "A legacy ID-only override is inactive because its original root is unknown. Import only after confirming it belongs to this instance."}</p>
          <p className="break-all font-mono">{settings.javaOverrides[instance.id]}</p>
          <Button variant="outline" disabled={!absoluteJavaPath(settings.javaOverrides[instance.id])} onClick={() => changePath(settings.javaOverrides[instance.id])}>{zh ? "填入旧路径供确认" : "Fill legacy path for review"}</Button>
        </div>}
        <p className="text-xs text-muted-foreground">{zh ? "策略及普通候选也用于此实例的重新安装；强制覆盖仅用于启动，不影响安装器处理器的兼容性要求。" : "Policy and candidates also apply when reinstalling this instance. Forced overrides apply only to launch, never bypass installer processor compatibility."}</p>
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
