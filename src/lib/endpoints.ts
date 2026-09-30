export type EndpointId = string;
export type LocalEndpoint = { id: "local"; kind: "local"; label: "Local" };
export type SshEndpoint = {
  id: EndpointId;
  kind: "ssh";
  label: string;
  destination: string;
  serversDirectory?: string;
};
export type Endpoint = LocalEndpoint | SshEndpoint;
export type EndpointConfigV1 = { version: 1; endpoints: Endpoint[] };

export const ENDPOINT_CONFIG_FILE_NAME = "endpoints.v1.json";
export const MAX_ENDPOINT_CONFIG_BYTES = 256 * 1024;
export const MAX_ENDPOINTS = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SSH_KEYS = new Set(["id", "kind", "label", "destination", "serversDirectory"]);
const LOCAL_KEYS = new Set(["id", "kind", "label"]);

export class EndpointValidationError extends Error {
  readonly code = "ENDPOINT_CONFIG_INVALID";
  constructor(message = "Endpoint configuration is invalid") { super(message); this.name = "EndpointValidationError"; }
}

export function canonicalEndpointConfig(): EndpointConfigV1 {
  return { version: 1, endpoints: [{ id: "local", kind: "local", label: "Local" }] };
}

function fail(): never { throw new EndpointValidationError(); }
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string"; }

export function validateDestination(value: unknown): string {
  if (!text(value)) return fail();
  const destination = value.trim();
  if (destination.length < 1 || new TextEncoder().encode(destination).length > 255 ||
      !/^[\x21-\x7e]+$/.test(destination) || destination.startsWith("-") ||
      /[\s\\;|&$`<>"'(){}!*?]/.test(destination)) return fail();
  const at = destination.indexOf("@");
  if (at !== destination.lastIndexOf("@")) return fail();
  const user = at >= 0 ? destination.slice(0, at) : undefined;
  const host = at >= 0 ? destination.slice(at + 1) : destination;
  if (user !== undefined && !/^[A-Za-z0-9._-]+$/.test(user)) return fail();
  if (/^\[[^\]]+\]$/.test(host)) {
    try { new URL(`http://${host}/`); } catch { return fail(); }
    return destination;
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(host)) return fail();
  return destination;
}

export function validateEndpoint(value: unknown): Endpoint {
  if (!plainObject(value)) return fail();
  if (value.id === "local" && value.kind === "local") {
    if (Object.keys(value).some((key) => !LOCAL_KEYS.has(key)) || value.label !== "Local") return fail();
    return { id: "local", kind: "local", label: "Local" };
  }
  if (value.kind !== "ssh" || Object.keys(value).some((key) => !SSH_KEYS.has(key)) ||
      !text(value.id) || !UUID.test(value.id)) return fail();
  if (!text(value.label)) return fail();
  const label = value.label.trim();
  if (!label || [...label].length > 80 || /\p{Cc}/u.test(label)) return fail();
  const destination = validateDestination(value.destination);
  let serversDirectory: string | undefined;
  if (value.serversDirectory !== undefined) {
    if (!text(value.serversDirectory)) return fail();
    const trimmed = value.serversDirectory.trim();
    if (trimmed) {
      if (!trimmed.startsWith("/") || new TextEncoder().encode(trimmed).length > 4096 || /[\0\r\n]/.test(trimmed)) return fail();
      serversDirectory = trimmed;
    }
  }
  return { id: value.id, kind: "ssh", label, destination, ...(serversDirectory ? { serversDirectory } : {}) };
}

export function validateEndpointConfig(value: unknown): EndpointConfigV1 {
  if (!plainObject(value) || Object.keys(value).some((key) => key !== "version" && key !== "endpoints") ||
      value.version !== 1 || !Array.isArray(value.endpoints) || value.endpoints.length < 1 || value.endpoints.length > MAX_ENDPOINTS) return fail();
  const endpoints = value.endpoints.map(validateEndpoint);
  if (endpoints.filter((endpoint) => endpoint.id === "local").length !== 1 || endpoints[0]?.id !== "local" ||
      new Set(endpoints.map((endpoint) => endpoint.id)).size !== endpoints.length) return fail();
  const config = { version: 1 as const, endpoints };
  if (new TextEncoder().encode(JSON.stringify(config)).length > MAX_ENDPOINT_CONFIG_BYTES) return fail();
  return config;
}

export function parseEndpointConfig(value: unknown): EndpointConfigV1 {
  try {
    if (typeof value === "string") {
      if (new TextEncoder().encode(value).length > MAX_ENDPOINT_CONFIG_BYTES) return canonicalEndpointConfig();
      value = JSON.parse(value) as unknown;
    }
    if (!plainObject(value) || !Array.isArray(value.endpoints)) return canonicalEndpointConfig();
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_ENDPOINT_CONFIG_BYTES) return canonicalEndpointConfig();
    // Storage reads use the same strict schema as writes and Rust serde parsing.
    return validateEndpointConfig(value);
  } catch { return canonicalEndpointConfig(); }
}

export function generateEndpointUuid(source: { randomUUID?: () => string; getRandomValues: (bytes: Uint8Array) => Uint8Array } = crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  // randomUUID is secure-context-only, but getRandomValues remains available
  // to the HTTP Vite Mock browser on the private Docker bridge.
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSshEndpoint(input: Omit<SshEndpoint, "id" | "kind"> & { randomUUID: () => string }): SshEndpoint {
  return validateEndpoint({ id: input.randomUUID(), kind: "ssh", label: input.label, destination: input.destination, serversDirectory: input.serversDirectory }) as SshEndpoint;
}
export function editSshEndpoint(endpoint: SshEndpoint, patch: Pick<SshEndpoint, "label" | "destination"> & { serversDirectory?: string }): SshEndpoint {
  return validateEndpoint({ ...endpoint, ...patch, id: endpoint.id, kind: "ssh" }) as SshEndpoint;
}
export function deleteSshEndpoint(config: EndpointConfigV1, id: string, selectedId = "local"): { config: EndpointConfigV1; selectedEndpointId: string } {
  if (id === "local") return fail();
  const validated = validateEndpointConfig(config);
  if (!validated.endpoints.some((endpoint) => endpoint.id === id && endpoint.kind === "ssh")) return fail();
  return { config: { version: 1, endpoints: validated.endpoints.filter((endpoint) => endpoint.id !== id) }, selectedEndpointId: selectedId === id ? "local" : selectedId };
}
export function reconcileSelectedEndpointId(selectedId: unknown, config: EndpointConfigV1): string {
  return typeof selectedId === "string" && config.endpoints.some((endpoint) => endpoint.id === selectedId) ? selectedId : "local";
}

export class EndpointRepository {
  constructor(private readonly adapter: {
    read: () => Promise<unknown>;
    write: (config: EndpointConfigV1) => Promise<void>;
  }) {}
  async read(): Promise<EndpointConfigV1> {
    return parseEndpointConfig(await this.adapter.read());
  }
  async write(config: EndpointConfigV1): Promise<void> {
    await this.adapter.write(validateEndpointConfig(config));
  }
}
