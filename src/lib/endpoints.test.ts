import { describe, expect, test } from "bun:test";
import { canonicalEndpointConfig, createSshEndpoint, editSshEndpoint, validateEndpointConfig, validateDestination, validateEndpoint, parseEndpointConfig, reconcileSelectedEndpointId, deleteSshEndpoint } from "./endpoints";
import { readEndpointConfig, writeEndpointConfig } from "./native";
import { resetMockEndpointConfig } from "./mockTransport";

const id = "123e4567-e89b-42d3-a456-426614174000";
const endpoint = (patch: Record<string, unknown> = {}) => ({ id, kind: "ssh", label: "Remote", destination: "pi", ...patch });

describe("endpoint config defaults", () => {
  test("uses one canonical local endpoint for a new install", () => {
    expect(canonicalEndpointConfig()).toEqual({
      version: 1,
      endpoints: [{ id: "local", kind: "local", label: "Local" }],
    });
  });

  test("creates an SSH endpoint with injected UUID and keeps its ID through edits", () => {
    const created = createSshEndpoint({ label: " Pi ", destination: " pi ", randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" });
    expect(created).toEqual({ id: "123e4567-e89b-42d3-a456-426614174000", kind: "ssh", label: "Pi", destination: "pi" });
    expect(editSshEndpoint(created, { label: "New", destination: "new-host" })).toEqual({ ...created, label: "New", destination: "new-host" });
  });

  test("enforces endpoint count and Unicode scalar, destination byte, and path byte limits", () => {
    const records = Array.from({ length: 63 }, (_, index) => ({ ...endpoint(), id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}` }));
    expect(() => validateEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, ...records] })).not.toThrow();
    expect(() => validateEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, ...records, { ...records[0], id: "123e4567-e89b-42d3-a456-999999999999" }] })).toThrow();
    expect(() => validateEndpoint(endpoint({ label: "😀".repeat(80) }))).not.toThrow();
    expect(() => validateEndpoint(endpoint({ label: "😀".repeat(81) }))).toThrow();
    expect(() => validateDestination("a".repeat(255))).not.toThrow();
    expect(() => validateDestination("a".repeat(256))).toThrow();
    expect(() => validateEndpoint(endpoint({ serversDirectory: `/${"é".repeat(2047)}a` }))).not.toThrow();
    expect(() => validateEndpoint(endpoint({ serversDirectory: `/${"é".repeat(2048)}` }))).toThrow();
  });

  test("accepts conservative SSH destination tokens and rejects options, shell syntax, and bad IPv6", () => {
    for (const value of ["pi", "user@pi", "host.example", "user@[2001:db8::1]"]) expect(validateDestination(value)).toBe(value);
    for (const value of ["-oProxyCommand=x", "two words", "bad\nname", "host;id", "[2001:::1]", "user@@pi", "[abc]"]) expect(() => validateDestination(value)).toThrow();
    expect(() => validateEndpoint(endpoint({ id: "123E4567-E89B-42D3-A456-426614174000" }))).toThrow();
    expect(() => validateEndpoint(endpoint({ label: "bad\u0000label" }))).toThrow();
    expect(() => validateEndpoint({ id: "local", kind: "local", label: "Local", destination: "pi" })).toThrow();
  });

  test("unknown fields invalidate storage reads and strict mutation validation rejects them", () => {
    const valid = { version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, endpoint()] };
    expect(parseEndpointConfig({ ...valid, extra: true })).toEqual(canonicalEndpointConfig());
    expect(parseEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local", arbitrary: "x" }, endpoint()] })).toEqual(canonicalEndpointConfig());
    expect(parseEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, { ...endpoint(), executable: "/ssh" }] })).toEqual(canonicalEndpointConfig());
    expect(() => validateEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, { ...endpoint(), executable: "/ssh" }] })).toThrow();
    expect(parseEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, endpoint(), endpoint()] })).toEqual(canonicalEndpointConfig());
    expect(() => validateEndpoint(endpoint({ serversDirectory: "relative" }))).toThrow();
    expect(parseEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local", destination: "pi" }, endpoint()] })).toEqual(canonicalEndpointConfig());
  });

  test("trims surrounding label whitespace before rejecting control characters", () => {
    expect(validateEndpoint(endpoint({ label: "\tRemote\t" })).label).toBe("Remote");
  });

  test("mock native endpoint persistence deep-clones and resets in isolation", async () => {
    resetMockEndpointConfig();
    const config = validateEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, endpoint({ serversDirectory: "/servers" })] });
    await writeEndpointConfig(config);
    config.endpoints[1]!.label = "mutated";
    const read = await readEndpointConfig();
    expect(read.endpoints[1]!.kind === "ssh" ? read.endpoints[1]!.label : "").toBe("Remote");
    (read.endpoints[1] as { serversDirectory?: string }).serversDirectory = "/mutated";
    expect((await readEndpointConfig()).endpoints[1]).toMatchObject({ serversDirectory: "/servers" });
    resetMockEndpointConfig();
    expect(await readEndpointConfig()).toEqual(canonicalEndpointConfig());
  });

  test("selection reconciliation retains existing IDs and deletion falls back only when selected", () => {
    const config = validateEndpointConfig({ version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }, endpoint()] });
    expect(reconcileSelectedEndpointId(id, config)).toBe(id);
    expect(reconcileSelectedEndpointId("deleted", config)).toBe("local");
    expect(reconcileSelectedEndpointId(null, config)).toBe("local");
    expect(deleteSshEndpoint(config, id, id)).toEqual({ config: canonicalEndpointConfig(), selectedEndpointId: "local" });
    expect(deleteSshEndpoint(config, id, "local").selectedEndpointId).toBe("local");
    expect(() => deleteSshEndpoint(config, "local")).toThrow();
  });

  test("storage parsing falls back atomically for absent, corrupt, unsupported, malformed, and oversized data", () => {
    for (const value of [undefined, null, "{", JSON.stringify({ version: 2, endpoints: [] }), JSON.stringify({ version: 1, endpoints: {} }), " ".repeat(256 * 1024 + 1)]) {
      expect(parseEndpointConfig(value)).toEqual(canonicalEndpointConfig());
    }
  });
});
