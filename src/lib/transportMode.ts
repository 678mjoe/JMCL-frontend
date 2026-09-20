export interface TransportEnvironment {
  viteDev: boolean;
  viteTransport?: string;
  testMode: boolean;
}

/**
 * Mock transport is available from Vite's development build or from an
 * explicitly marked test runtime. A production bundle never trusts a global
 * variable to switch transport implementations.
 */
export function shouldUseMockTransport(
  environment: TransportEnvironment,
): boolean {
  return (
    (environment.viteDev && environment.viteTransport === "mock") ||
    environment.testMode
  );
}

export function isMockTransport(): boolean {
  return shouldUseMockTransport({
    viteDev: import.meta.env?.DEV === true,
    viteTransport: import.meta.env?.VITE_JMCL_TRANSPORT,
    // `MODE` is statically replaced by Vite. In a production bundle this
    // expression folds to false, so a page cannot switch transports through
    // a mutable browser global. `bun run test` explicitly supplies MODE=test.
    testMode: import.meta.env?.MODE === "test",
  });
}
