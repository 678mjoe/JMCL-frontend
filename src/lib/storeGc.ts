/** Store collection is a fresh scan, never execution of an immutable preview. */
export interface StoreGcSummary {
  objects_scanned: number; objects_eligible: number; objects_deleted: number;
  bytes_eligible: number; bytes_deleted: number; objects_linked: number;
  objects_young: number; objects_ignored: number; objects_busy: number; errors: number;
}
export interface StoreGcResult { dry_run: boolean; min_age_seconds: number; summary: StoreGcSummary }
export interface StoreGcParams { store_directory: string; dry_run: boolean; min_age_seconds: number }
export interface StoreGcSession { storeGc(params: StoreGcParams): Promise<unknown>; close(): Promise<void> }
export const summaryKeys = ["objects_scanned", "objects_eligible", "objects_deleted", "bytes_eligible", "bytes_deleted", "objects_linked", "objects_young", "objects_ignored", "objects_busy", "errors"] as const;
export function parseGcAge(input: string): number | null {
  if (!/^\d+$/.test(input)) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function resultFor(value: unknown, params: StoreGcParams): StoreGcResult {
  if (!value || typeof value !== "object") throw { code: "INVALID_RESULT" };
  const result = value as StoreGcResult;
  if (result.dry_run !== params.dry_run || result.min_age_seconds !== params.min_age_seconds ||
    !result.summary || summaryKeys.some((key) => !Number.isSafeInteger(result.summary[key]) || result.summary[key] < 0) ||
    result.summary.errors !== 0 || (params.dry_run && (result.summary.objects_deleted !== 0 || result.summary.bytes_deleted !== 0))) throw { code: "INVALID_RESULT" };
  return { dry_run: result.dry_run, min_age_seconds: result.min_age_seconds, summary: Object.fromEntries(summaryKeys.map((key) => [key, result.summary[key]])) as unknown as StoreGcSummary };
}
const safeErrors = new Set(["INVALID_PARAMS", "STORE_ROOT_ERROR", "STORE_GC_FAILED", "STORE_GC_PARTIAL", "INVALID_RESULT"]);
export interface StoreGcSnapshot { pending: boolean; preview: StoreGcResult | null; result: StoreGcResult | null; error: string | null }
export class StoreGcController {
  private snapshot: StoreGcSnapshot = { pending: false, preview: null, result: null, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private scope = "";
  private directory = "";
  private age: number | null = 86400;
  private alive = true;
  constructor(private openSession: () => Promise<StoreGcSession>) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<StoreGcSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  matches(directory: string, age: number | null, scope: string) {
    return directory === this.directory && age === this.age && scope === this.scope;
  }
  configure(directory: string, age: number | null, scope: string) {
    if (this.matches(directory, age, scope)) return;
    this.directory = directory; this.age = age; this.scope = scope; this.generation++;
    this.update({ preview: null, result: null, error: null });
  }
  activate() { this.alive = true; }
  cancelPreview() { this.generation++; this.update({ preview: null, result: null, error: null }); }
  dispose() { this.alive = false; this.generation++; this.listeners.clear(); }
  preview = () => this.run(true);
  execute = (confirmation: string) => {
    if (!this.snapshot.preview || confirmation !== this.directory) return Promise.resolve(false);
    return this.run(false);
  };
  private async run(dryRun: boolean): Promise<boolean> {
    if (!this.alive || this.snapshot.pending || !this.directory.trim() || /[\0\r\n]/.test(this.directory) || this.age === null) return false;
    const generation = ++this.generation;
    const params = { store_directory: this.directory, min_age_seconds: this.age, dry_run: dryRun };
    const current = () => this.alive && this.generation === generation;
    this.update({ pending: true, preview: null, result: null, error: null });
    let session: StoreGcSession | null = null;
    try {
      session = await this.openSession();
      if (!current()) return false;
      const result = resultFor(await session.storeGc(params), params);
      if (!current()) return false;
      this.update(dryRun ? { preview: result } : { result });
      return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (current()) this.update({ error: typeof code === "string" && safeErrors.has(code) ? code : "UNKNOWN", preview: null, result: null });
      return false;
    } finally {
      // Never retry an uncertain destructive request. A failure may follow deletion.
      if (session) await session.close().catch(() => undefined);
      if (this.alive) this.update({ pending: false });
    }
  }
}
