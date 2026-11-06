import { describe, expect, test } from "bun:test";
import {
  appendLaunchOutput,
  runLaunchRequest,
  runtimeInstallEvent,
  type LaunchEvent,
} from "./launchRunner";

const encoded = (value: string) => btoa(value);

describe("runLaunchRequest", () => {
  test("recognizes the direct managed-runtime event shape emitted by launch.execute", () => {
    expect(
      runtimeInstallEvent({
        kind: "event",
        data: {
          event: "progress",
          progress: { bytes_processed: 1024, bytes_total: 2048 },
        },
      }),
    ).toEqual({
      event: "progress",
      data: {
        event: "progress",
        progress: { bytes_processed: 1024, bytes_total: 2048 },
      },
    });
  });

  test("flushes unterminated stdout and stderr tails when the RPC rejects", async () => {
    const lines: { stream: string; text: string }[] = [];

    await expect(
      runLaunchRequest(
        async (onEvent) => {
          onEvent({
            kind: "event",
            data: {
              event: "stdout",
              stdout: {
                encoding: "base64",
                end: "more",
                data: encoded("partial stdout"),
              },
            },
          });
          onEvent({
            kind: "event",
            data: {
              event: "stderr",
              stderr: {
                encoding: "base64",
                end: "more",
                data: encoded("partial stderr"),
              },
            },
          });
          throw new Error("launch failed");
        },
        (event, buffer) =>
          appendLaunchOutput(event, buffer, (line) => lines.push(line)),
        (line) => lines.push(line),
      ),
    ).rejects.toThrow("launch failed");

    expect(lines).toEqual([
      { stream: "stdout", text: "partial stdout" },
      { stream: "stderr", text: "partial stderr" },
    ]);
  });
});

const bytesEvent = (
  stream: "stdout" | "stderr",
  bytes: Uint8Array,
  end: "more" | "newline" | "eof" = "more",
): LaunchEvent => ({
  kind: "event",
  data: {
    event: stream,
    [stream]: { encoding: "base64", data: btoa(String.fromCharCode(...bytes)), end },
  },
});

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("launch output UTF-8 streaming", () => {
  test("reassembles a multibyte character across the core's 16 KiB boundary", async () => {
    const text = "a".repeat(16383) + "中";
    const bytes = utf8(text);
    const lines: { stream: string; text: string }[] = [];
    await runLaunchRequest(async (emit) => {
      emit(bytesEvent("stdout", bytes.slice(0, 16384)));
      emit(bytesEvent("stdout", bytes.slice(16384), "newline"));
    }, (event, buffer) => appendLaunchOutput(event, buffer, line => lines.push(line)),
    line => lines.push(line));
    expect(lines).toEqual([{ stream: "stdout", text }]);
  });

  test("isolates stdout, stderr and concurrent launches and flushes EOF immediately", async () => {
    const lines: { stream: string; text: string }[] = [];
    const otherLines: { stream: string; text: string }[] = [];
    const middle = utf8("中");
    const emoji = utf8("😀");
    await runLaunchRequest(async (emit) => {
      emit(bytesEvent("stdout", middle.slice(0, 1)));
      emit(bytesEvent("stderr", emoji.slice(0, 2)));
      await runLaunchRequest(async (otherEmit) => {
        otherEmit(bytesEvent("stdout", utf8("独立"), "eof"));
        expect(otherLines).toEqual([{ stream: "stdout", text: "独立" }]);
      }, (event, buffer) => appendLaunchOutput(event, buffer, line => otherLines.push(line)),
      line => otherLines.push(line));
      emit(bytesEvent("stderr", emoji.slice(2), "eof"));
      expect(lines).toEqual([{ stream: "stderr", text: "😀" }]);
      emit(bytesEvent("stdout", middle.slice(1), "newline"));
    }, (event, buffer) => appendLaunchOutput(event, buffer, line => lines.push(line)),
    line => lines.push(line));
    expect(lines).toEqual([
      { stream: "stderr", text: "😀" }, { stream: "stdout", text: "中" },
    ]);
  });

  test("finalizes incomplete UTF-8 at newline and EOF without leaking into the next line", async () => {
    const lines: { stream: string; text: string }[] = [];
    await runLaunchRequest(async (emit) => {
      emit(bytesEvent("stdout", utf8("中").slice(0, 1)));
      emit(bytesEvent("stdout", new Uint8Array(), "newline"));
      emit(bytesEvent("stdout", utf8("next\r\n"), "newline"));
      emit(bytesEvent("stderr", utf8("中").slice(0, 2), "eof"));
      expect(lines).toEqual([
        { stream: "stdout", text: "�" },
        { stream: "stdout", text: "next" },
        { stream: "stderr", text: "�" },
      ]);
    }, (event, buffer) => appendLaunchOutput(event, buffer, line => lines.push(line)),
    line => lines.push(line));
    expect(lines).toHaveLength(3);
  });

  for (const fails of [false, true]) {
    test(`flushes pending decoder tails on RPC ${fails ? "failure" : "success"} and ignores late events`, async () => {
      const lines: { stream: string; text: string }[] = [];
      let lateEmit: ((event: LaunchEvent) => void) | undefined;
      let handled = 0;
      const request = runLaunchRequest(async (emit) => {
        lateEmit = emit;
        emit(bytesEvent("stdout", utf8("prefix中").slice(0, -1)));
        emit(bytesEvent("stderr", utf8("😀").slice(0, 2)));
        if (fails) throw new Error("synthetic RPC failure");
        return 42;
      }, (event, buffer) => {
        handled++;
        appendLaunchOutput(event, buffer, line => lines.push(line));
      }, line => lines.push(line));
      if (fails) await expect(request).rejects.toThrow("synthetic RPC failure");
      else expect(await request).toBe(42);
      expect(lines).toEqual([
        { stream: "stdout", text: "prefix�" }, { stream: "stderr", text: "�" },
      ]);
      lateEmit?.(bytesEvent("stdout", utf8("late\n"), "newline"));
      expect(handled).toBe(2);
      expect(lines).toHaveLength(2);
    });
  }
});
