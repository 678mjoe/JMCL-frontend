import { describe, expect, test } from "bun:test";
import { StreamLineBuffer } from "./logBuffer";

describe("StreamLineBuffer", () => {
  test("keeps interleaved stdout and stderr fragments separate", () => {
    const buffer = new StreamLineBuffer();
    expect(buffer.push("stdout", "out-", "more")).toEqual([]);
    expect(buffer.push("stderr", "err-", "more")).toEqual([]);
    expect(buffer.push("stdout", "line\n", "newline")).toEqual([{ stream: "stdout", text: "out-line" }]);
    expect(buffer.push("stderr", "line\n", "newline")).toEqual([{ stream: "stderr", text: "err-line" }]);
  });

  test("flushes unterminated tails with their original stream", () => {
    const buffer = new StreamLineBuffer();
    buffer.push("stderr", "warning", "more");
    buffer.push("stdout", "ready", "more");
    expect(buffer.flush()).toEqual([
      { stream: "stdout", text: "ready" },
      { stream: "stderr", text: "warning" },
    ]);
  });
});
