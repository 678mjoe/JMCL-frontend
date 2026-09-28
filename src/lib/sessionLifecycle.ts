export interface ClosableSession {
  close(): Promise<void>;
}

/** Owns one persistent control session and disposes opens that outlive their source. */
export class SessionOwner<S extends ClosableSession> {
  private generation = 0;
  private session: S | null = null;

  async open(openSession: () => Promise<S>): Promise<S | null> {
    const generation = ++this.generation;
    const session = await openSession();
    if (generation !== this.generation) {
      await session.close().catch(() => undefined);
      return null;
    }
    const previous = this.session;
    this.session = session;
    if (previous && previous !== session) await previous.close().catch(() => undefined);
    return session;
  }

  async close(): Promise<void> {
    this.generation += 1;
    const session = this.session;
    this.session = null;
    if (session) await session.close();
  }
}

/** Guarantees that opening and closing errors remain part of the operation. */
export async function withOpenedSession<T, S extends ClosableSession>(
  open: () => Promise<S>,
  action: (session: S) => Promise<T>,
): Promise<T> {
  const session = await open();
  try {
    return await action(session);
  } finally {
    await session.close();
  }
}

/**
 * Like withOpenedSession, but checks cancellation after an asynchronous open.
 * That ordering is important: a cancellation while `open()` is pending still
 * closes the session that eventually resolves.
 */
export async function withCancellableOpenedSession<T, S extends ClosableSession>(
  open: () => Promise<S>,
  isCancelled: () => boolean,
  action: (session: S) => Promise<T>,
): Promise<T | undefined> {
  const session = await open();
  try {
    if (isCancelled()) return undefined;
    return await action(session);
  } finally {
    await session.close();
  }
}
