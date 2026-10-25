/** Existing Core v1 bounds: workers 1–32, retries 0–5; defaults 8/2. */
export interface DownloadOptions { workers: number; retries: number }
export function downloadOptions(value: { downloadWorkers?: unknown; downloadRetries?: unknown }): DownloadOptions {
  const valid = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  return { workers: valid(value.downloadWorkers, 1, 32, 8), retries: valid(value.downloadRetries, 0, 5, 2) };
}
