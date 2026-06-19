/**
 * API handler tests. [TASK-017]
 *
 * Drives the transport-neutral handlers in src/server/api.ts directly against a
 * fresh in-memory Store. Covers search pagination + filtering, command detail
 * lookup, aggregate stats, the (non-executing) rerun-intent queue, and the edge
 * case where a bare-number `since` must yield a 400 rather than a thrown error.
 */
import { openDatabase, DB } from '../src/db/database';
import { Store } from '../src/db/store';
import { CommandInput } from '../src/types';
import {
  handleSearch,
  handleCommand,
  handleStats,
  handleRerunIntent,
  ApiReply,
} from '../src/server/api';
import {
  ApiSearchResponse,
  ApiCommandDetail,
  ApiStats,
  RerunResponse,
} from '../src/server/contract';

/** Fixed clock so since/until parsing (where used) is deterministic. */
const NOW = 1_700_000_000_000;

/**
 * A fixed corpus of 12 commands with a mix of exit codes, cwds, sources, and
 * distinct startedAt values. Row index 4 carries known output text ('docker')
 * so output-term search can be asserted precisely.
 */
const SEED: CommandInput[] = Array.from({ length: 12 }, (_, i) => ({
  sessionId: null,
  command: `cmd-${i} run`,
  cwd: i % 2 ? '/home/a' : '/home/b',
  gitBranch: null,
  exitCode: i % 3 === 0 ? 0 : 1,
  startedAt: 1_000 + i,
  durationMs: 5,
  // Three distinct sources for the stats assertion.
  source: i < 6 ? 'pty' : i < 9 ? 'hook' : 'history',
  // Only one row mentions docker; the rest have unrelated output.
  output: i === 4 ? 'starting docker container daemon ok' : `output line ${i}`,
}));

/** Count of seeded rows whose exit code is 0. */
const SUCCESS_COUNT = SEED.filter((c) => c.exitCode === 0).length;

function bodyOf<T>(reply: ApiReply): T {
  return reply.json as T;
}

describe('API handlers', () => {
  let db: DB;
  let store: Store;
  /** ids assigned to each seeded row, in seed order. */
  const ids: number[] = [];

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new Store(db);
    ids.length = 0;
    for (const input of SEED) ids.push(store.insertCommand(input));
  });

  afterEach(() => {
    db.close();
  });

  it('handleSearch paginates: total stays constant and the two pages are disjoint', () => {
    const page1 = handleSearch(store, new URLSearchParams('q=&limit=5&offset=0'), NOW);
    const page2 = handleSearch(store, new URLSearchParams('q=&limit=5&offset=5'), NOW);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const b1 = bodyOf<ApiSearchResponse>(page1);
    const b2 = bodyOf<ApiSearchResponse>(page2);

    // Empty query → matches every seeded row.
    expect(b1.total).toBe(SEED.length);
    expect(b2.total).toBe(SEED.length);

    expect(b1.limit).toBe(5);
    expect(b2.limit).toBe(5);
    expect(b1.offset).toBe(0);
    expect(b2.offset).toBe(5);

    expect(b1.results).toHaveLength(5);
    expect(b2.results).toHaveLength(5);

    // The two pages must not share any result id.
    const idsP1 = new Set(b1.results.map((r) => r.id));
    const shared = b2.results.filter((r) => idsP1.has(r.id));
    expect(shared).toEqual([]);
  });

  it('handleSearch matches by output term and filters success-only to exit 0', () => {
    // 'docker' only appears in the output of seeded row index 4.
    const byOutput = handleSearch(store, new URLSearchParams('q=docker'), NOW);
    expect(byOutput.status).toBe(200);
    const outBody = bodyOf<ApiSearchResponse>(byOutput);
    expect(outBody.total).toBe(1);
    expect(outBody.results).toHaveLength(1);
    expect(outBody.results[0]!.id).toBe(ids[4]);

    // success=true → only exit-code-0 rows, regardless of query text.
    const successOnly = handleSearch(store, new URLSearchParams('q=&success=true'), NOW);
    expect(successOnly.status).toBe(200);
    const sucBody = bodyOf<ApiSearchResponse>(successOnly);
    expect(sucBody.total).toBe(SUCCESS_COUNT);
    expect(sucBody.results.every((r) => r.exitCode === 0)).toBe(true);
  });

  it('handleCommand returns 200 with output for a valid id, 404 missing, 400 non-numeric', () => {
    const validId = ids[4]!;
    const ok = handleCommand(store, String(validId));
    expect(ok.status).toBe(200);
    const detail = bodyOf<ApiCommandDetail>(ok);
    expect(detail.id).toBe(validId);
    expect(detail.output).toBe('starting docker container daemon ok');

    const missing = handleCommand(store, '99999');
    expect(missing.status).toBe(404);

    const bad = handleCommand(store, 'abc');
    expect(bad.status).toBe(400);
  });

  it('handleStats reports total and per-source counts', () => {
    const reply = handleStats(store);
    expect(reply.status).toBe(200);

    const stats = bodyOf<ApiStats>(reply);
    expect(stats.total).toBe(SEED.length);
    // Seed assigns: pty for i<6, hook for 6<=i<9, history for i>=9.
    expect(stats.bySource).toEqual({ pty: 6, hook: 3, history: 3 });
  });

  it('handleRerunIntent records intent onto the queue without executing', () => {
    const validId = ids[2]!;
    const expectedCommand = SEED[2]!.command;

    const queue: string[] = [];
    const r = handleRerunIntent(store, String(validId), queue);

    expect(r.status).toBe(200);
    const body = bodyOf<RerunResponse>(r);
    expect(body.command).toBe(expectedCommand);
    expect(queue).toContain(expectedCommand);
    expect(queue).toEqual([expectedCommand]);

    // A missing id is a 404 and must not mutate the queue.
    const before = [...queue];
    const missing = handleRerunIntent(store, '99999', queue);
    expect(missing.status).toBe(404);
    expect(queue).toEqual(before);
  });

  it('EDGE: handleSearch with a bare-number `since` returns 400 instead of throwing', () => {
    let reply: ApiReply | undefined;
    expect(() => {
      reply = handleSearch(store, new URLSearchParams('since=3'), NOW);
    }).not.toThrow();

    expect(reply!.status).toBe(400);
    const err = bodyOf<{ error: string }>(reply!);
    expect(typeof err.error).toBe('string');
  });
});
