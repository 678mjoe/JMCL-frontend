import { describe, expect, test } from "bun:test";
import {
  appendLaunchOutput,
  runLaunchRequest,
  runtimeInstallEvent,
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
