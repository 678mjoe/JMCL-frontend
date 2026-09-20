/**
 * Application-level write coordination for one Minecraft instance.
 *
 * The core protocol permits multiple sessions, so a shared session queue is
 * not enough: this registry deliberately lives above CoreSession and keys
 * writes by the normalized instance path. Reads never acquire a lease.
 */
export type InstanceMutation =
  | "create"
  | "validate"
  | "install"
  | "launch"
  | "delete"
  | "content-install"
  | "content-set-version"
  | "content-enable"
  | "content-disable"
  | "content-remove"
  | "content-adopt"
  | "world-rename"
  | "world-duplicate"
  | "world-delete"
  | "world-import"
  | "world-export"
  | "world-backup"
  | "world-restore"
  | "world-backup-delete";

export class InstanceBusyError extends Error {
  readonly instanceId: string;
  readonly operation: InstanceMutation;

  constructor(instanceId: string, operation: InstanceMutation) {
    super(`Instance ${instanceId} is busy with another mutating operation`);
    this.name = "InstanceBusyError";
    this.instanceId = instanceId;
    this.operation = operation;
  }
}

export class InstanceOperationCoordinator {
  private readonly active = new Map<string, InstanceMutation>();

  isBusy(instanceId: string): boolean {
    return this.active.has(instanceId);
  }

  operationFor(instanceId: string): InstanceMutation | undefined {
    return this.active.get(instanceId);
  }

  tryAcquire(instanceId: string, operation: InstanceMutation): () => void {
    if (this.active.has(instanceId)) {
      throw new InstanceBusyError(instanceId, operation);
    }
    this.active.set(instanceId, operation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.active.get(instanceId) === operation) this.active.delete(instanceId);
    };
  }

  async run<T>(instanceId: string, operation: InstanceMutation, action: () => Promise<T>): Promise<T> {
    const release = this.tryAcquire(instanceId, operation);
    try {
      return await action();
    } finally {
      release();
    }
  }
}

/** One process-wide registry shared by all sessions and React providers. */
export const instanceCoordinator = new InstanceOperationCoordinator();

function normalizedPath(path: string): string {
  const slashPath = path.replaceAll("\\", "/");
  const absolute = slashPath.startsWith("/");
  const parts: string[] = [];

  for (const segment of slashPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      const driveFloor = parts[0]?.endsWith(":") ? 1 : 0;
      if (parts.length > driveFloor && parts.at(-1) !== "..") parts.pop();
      else if (!absolute && driveFloor === 0) parts.push(segment);
      continue;
    }
    parts.push(segment);
  }

  const normalized = parts.join("/");
  if (absolute) return `/${normalized}`.replace(/\/$/, "") || "/";
  return normalized || ".";
}

/** A stable key for an instance root plus id, independent of slash style. */
export function instanceMutationKey(directory: string, id: string): string {
  return `${normalizedPath(directory)}/${id}`;
}

/** Convert an instance's game directory (`<root>/<id>/.minecraft`) to its key. */
export function instanceMutationKeyFromGameDirectory(directory: string): string {
  const normalized = normalizedPath(directory);
  return normalized.endsWith("/.minecraft")
    ? normalized.slice(0, -"/.minecraft".length)
    : normalized;
}
