import { describe, expect, test } from 'bun:test';
import fixture from './fixtures/protocol-v1.json';
import { CoreSession } from './rpc';
import type { ServerLogResult, ServerCommandResult, ServerQueryResult } from './types';

// Compile-time checks complement exact-wire replay; no permissive mock dispatcher.
const logs: ServerLogResult = { ...fixture.logs.result, stage: 'server.logs' };
const command: ServerCommandResult = { ...fixture.command.result, stage: 'server.command', accepted: true };
const query: ServerQueryResult = { ...fixture.query.result, stage: 'server.query', mode: 'full' };

describe('pinned protocol-v1 contract examples', () => {
  test('fixtures still match the authoritative checked-in handoff examples', async () => {
    const handoff = await Bun.file(new URL('../../gui-handoff.md', import.meta.url)).text();
    for (const example of [fixture.identity, fixture.logs, fixture.command, fixture.queryRequest, fixture.query]) {
      expect(handoff).toContain(JSON.stringify(example));
    }
  });

  test('Query wrapper sends the published top-level params and preserves the reply', async () => {
    const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
      expect({ method, params }).toEqual({ method: fixture.queryRequest.method, params: fixture.queryRequest.params });
      return query as T;
    });
    expect(await session.serverQuery('/srv/jmcl/servers', 'demo', 'full')).toEqual(query);
  });

  test('logs retain cursor/file pair and command acknowledgement is not console output', async () => {
    const calls: unknown[] = [];
    const session = CoreSession.createForTesting(async <T>(method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return (method === 'server.logs' ? logs : command) as T;
    });
    const first = await session.serverLogs('/srv/jmcl/servers', 'demo');
    await session.serverLogs('/srv/jmcl/servers', 'demo', { cursor: first.next_cursor, file_id: first.file_id });
    const acknowledged = await session.serverCommand('/srv/jmcl/servers', 'demo', 'list');
    expect(calls).toEqual([
      { method: 'server.logs', params: { directory: '/srv/jmcl/servers', id: 'demo' } },
      { method: 'server.logs', params: { directory: '/srv/jmcl/servers', id: 'demo', cursor: 33, file_id: 123456 } },
      { method: 'server.command', params: { directory: '/srv/jmcl/servers', id: 'demo', command: 'list' } },
    ]);
    expect(acknowledged).toEqual(command);
    expect(acknowledged).not.toHaveProperty('text');
  });
});
