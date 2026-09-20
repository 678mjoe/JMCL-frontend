import { describe, expect, test } from "bun:test";
import { shouldUseMockTransport } from "./transportMode";

describe("mock transport environment", () => {
  test("requires Vite development mode or a compile-time test build", () => {
    expect(
      shouldUseMockTransport({
        viteDev: false,
        viteTransport: "mock",
        testMode: false,
      }),
    ).toBe(false);
    expect(
      shouldUseMockTransport({
        viteDev: true,
        viteTransport: "mock",
        testMode: false,
      }),
    ).toBe(true);
    expect(
      shouldUseMockTransport({ viteDev: false, testMode: true }),
    ).toBe(true);
  });
});
