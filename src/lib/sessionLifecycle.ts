export interface ClosableSession {
  close(): Promise<void>;
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
