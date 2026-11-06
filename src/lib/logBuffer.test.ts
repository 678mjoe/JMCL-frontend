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

  test("preserves standalone and consecutive newline records, including empty lines", () => {
    const buffer = new StreamLineBuffer();
    expect(buffer.push("stdout", "", "newline")).toEqual([{ stream: "stdout", text: "" }]);
    expect(buffer.push("stdout", "", "newline")).toEqual([{ stream: "stdout", text: "" }]);
    expect(buffer.push("stderr", "", "newline")).toEqual([{ stream: "stderr", text: "" }]);
    expect(buffer.flush()).toEqual([]);
  });

  test("a newline after a partial record finishes that line without inventing another", () => {
    const buffer = new StreamLineBuffer();
    expect(buffer.push("stdout", "partial", "more")).toEqual([]);
    expect(buffer.push("stdout", "", "newline")).toEqual([{ stream: "stdout", text: "partial" }]);
    expect(buffer.push("stdout", "", "newline")).toEqual([{ stream: "stdout", text: "" }]);
    expect(buffer.flush()).toEqual([]);
  });

  test("EOF flushes only the affected nonempty tail and an empty EOF adds no line", () => {
    const buffer = new StreamLineBuffer();
    expect(buffer.push("stdout", "", "eof")).toEqual([]);
    buffer.push("stdout", "out", "more");
    buffer.push("stderr", "err", "more");
    expect(buffer.push("stdout", "", "eof")).toEqual([{ stream: "stdout", text: "out" }]);
    expect(buffer.push("stdout", "", "eof")).toEqual([]);
    expect(buffer.flush()).toEqual([{ stream: "stderr", text: "err" }]);
    expect(buffer.flush()).toEqual([]);
  });

  test("keeps compatibility with payload-embedded newlines without duplicating their ending", () => {
    const buffer = new StreamLineBuffer();
    expect(buffer.push("stdout", "one\r\n\r\n", "newline")).toEqual([
      { stream: "stdout", text: "one" }, { stream: "stdout", text: "" },
    ]);
    expect(buffer.push("stdout", "\n", "newline")).toEqual([{ stream: "stdout", text: "" }]);
    expect(buffer.push("stderr", "two\n", "eof")).toEqual([{ stream: "stderr", text: "two" }]);
    expect(buffer.flush()).toEqual([]);
  });
});
