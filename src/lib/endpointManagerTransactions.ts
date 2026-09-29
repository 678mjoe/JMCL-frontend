import { createSshEndpoint, deleteSshEndpoint, editSshEndpoint, validateEndpointConfig, type EndpointConfigV1, type SshEndpoint } from "./endpoints";

export interface EndpointMutationRepository {
  read(): Promise<EndpointConfigV1>;
  write(config: EndpointConfigV1): Promise<void>;
}

export async function saveEndpointTransaction(options: {
  repository: EndpointMutationRepository;
  endpointId: string | null;
  draft: Pick<SshEndpoint, "label" | "destination"> & { serversDirectory?: string };
  randomUUID?: () => string;
}): Promise<EndpointConfigV1> {
  const latest = validateEndpointConfig(await options.repository.read());
  let endpoint: SshEndpoint;
  if (options.endpointId === null) {
    endpoint = createSshEndpoint({ ...options.draft, randomUUID: options.randomUUID ?? (() => crypto.randomUUID()) });
  } else {
    const current = latest.endpoints.find((item) => item.id === options.endpointId);
    if (!current || current.kind !== "ssh") throw new Error("Endpoint no longer exists");
    endpoint = editSshEndpoint(current, options.draft);
  }
  const next = validateEndpointConfig({
    version: 1,
    endpoints: options.endpointId === null
      ? [...latest.endpoints, endpoint]
      : latest.endpoints.map((item) => item.id === endpoint.id ? endpoint : item),
  });
  await options.repository.write(next);
  return next;
}

export interface DeleteEndpointTransactionOptions {
  repository: EndpointMutationRepository;
  endpointId: string;
  selectedEndpointId: string;
  persistSelectedEndpointId: (id: string) => void;
  publishConfig: (config: EndpointConfigV1) => void;
  prepareEndpointDeletion: (endpointId: string) => Promise<void>;
  closeEndpointSessions: (id: string) => Promise<void>;
  cleanupEndpointCache: (endpointId: string) => Promise<void>;
}

export type DeleteEndpointResult = { deleted: false; cleanupComplete: false } | { deleted: true; cleanupComplete: boolean };

/**
 * Commit endpoint removal first. Advisory cleanup runs only after source
 * invalidation and write draining. Cache cleanup is delegated to the server
 * controller so it shares the advisory cache write queue.
 */
export async function deleteEndpointTransaction(options: DeleteEndpointTransactionOptions): Promise<DeleteEndpointResult> {
  let next: ReturnType<typeof deleteSshEndpoint>;
  try {
    const latestConfig = await options.repository.read();
    next = deleteSshEndpoint(latestConfig, options.endpointId, options.selectedEndpointId);
    await options.repository.write(next.config);
  } catch {
    return { deleted: false, cleanupComplete: false };
  }

  let cleanupComplete = true;
  if (next.selectedEndpointId !== options.selectedEndpointId) {
    try { options.persistSelectedEndpointId(next.selectedEndpointId); }
    catch { cleanupComplete = false; }
  }
  options.publishConfig(next.config);

  try {
    await options.prepareEndpointDeletion(options.endpointId);
  } catch {
    cleanupComplete = false;
  }
  try { await options.closeEndpointSessions(options.endpointId); }
  catch { cleanupComplete = false; }

  try { await options.cleanupEndpointCache(options.endpointId); }
  catch { cleanupComplete = false; }
  return { deleted: true, cleanupComplete };
}

/** Serialize endpoint config mutations so two UI actions cannot overwrite one another. */
export class EndpointMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
