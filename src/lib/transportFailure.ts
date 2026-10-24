/** Native local-pipe failure codes. Exact matching preserves the transport
 * semantics when errors cross IPC without the RpcError prototype. */
export const localCoreTransportCodes = [
  "CORE_BINARY_UNAVAILABLE", "CORE_SPAWN_FAILED", "CORE_RPC_EOF", "CORE_RPC_READ_FAILED", "CORE_RPC_WRITE_FAILED",
  "CORE_RPC_READERS_STOPPED", "CORE_PROTOCOL_ERROR",
] as const;
const localCoreTransportFailures = new Set<string>(localCoreTransportCodes);
export const isLocalCoreTransportFailure = (code: string | null): boolean => code !== null && localCoreTransportFailures.has(code);
