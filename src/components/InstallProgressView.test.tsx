import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsProvider } from "@/lib/settings";
import { InstallProgressView } from "./InstallProgressView";
import type { InstallProgressState } from "@/lib/installProgress";
function render(state: InstallProgressState, label?: string) {
  return renderToStaticMarkup(<SettingsProvider><InstallProgressView state={state} label={label} /></SettingsProvider>);
}
describe("shared installation progress view", () => {
  test("processor step is not files and never displays 100% before it finishes", () => {
    const html = render({ stage: "processor", progress: null, detail: { kind: "processor", index: 4, total: 4 } });
    expect(html).toContain("4 / 4"); expect(html).toContain("处理步骤");
    expect(html).not.toContain("100%"); expect(html).not.toContain("个文件");
    expect(html).toContain('role="progressbar"'); expect(html).not.toContain("aria-valuenow");
  });
  test("download shows formatted byte totals and file totals", () => {
    const html = render({ stage: "download", progress: { filesCompleted: 1, filesTotal: 2, bytesProcessed: 1024, bytesTotal: 2048 }, detail: { kind: "file", status: "cached" } });
    expect(html).toContain("50%"); expect(html).toContain("1.00 KiB / 2.00 KiB"); expect(html).toContain("复用缓存");
  });
  test("retry and Java phase explanations replace stale raw path/error details", () => {
    const retry = render({ stage: "download", progress: null, detail: { kind: "retry", attempt: 2, maxAttempts: 3, reason: "network" } });
    expect(retry).toContain("2 / 3"); expect(retry).toContain("网络连接");
    const java = render({ stage: "java", progress: null, detail: { kind: "java", phase: "verifying" } });
    expect(java).toContain("验证 Java"); expect(java).not.toContain("100%");
  });
  test("unknown byte totals show processed data without inventing a percentage", () => {
    const html = render({ stage: "download", progress: { filesCompleted: 0, filesTotal: 0, bytesProcessed: 1024, bytesTotal: 0 }, detail: null });
    expect(html).toContain("1.00 KiB"); expect(html).toContain("总大小尚未提供"); expect(html).not.toContain("100%");
  });
  test("Java extraction phase remains visible when a file event becomes detail", () => {
    const html = render({ stage: "java", javaPhase: "extracting", progress: null, detail: { kind: "file", status: "processed" } });
    expect(html).toContain("解包 Java"); expect(html).toContain("文件处理完成");
  });
  test("parent stage label can identify archive import while sharing counters", () => {
    expect(render({ stage: "download", progress: null, detail: null }, "Importing archive")).toContain("Importing archive");
  });
});
