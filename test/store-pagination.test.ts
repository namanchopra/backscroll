/**
 * Store pagination + aggregation tests. [TASK-019]
 *
 * Covers offset-based paging on search(), countCommands() ignoring
 * limit/offset, and getStats() over both a populated and an empty store. Each
 * test runs against a fresh in-memory database so no real files are touched.
 */
import { openDatabase, DB } from '../src/db/database';
import { Store } from '../src/db/store';
import { CommandInput } from '../src/types';

/**
 * Insert `n` commands with strictly increasing startedAt so recency order is
 * deterministic. cwd alternates /a /b, exitCode is 0 on every third row, and
 * source is overridable for the stats tests.
 */
function seed(store: Store, n: number, source: CommandInput['source'] = 'pty'): void {
  for (let i = 0; i < n; i++) {
    const input: CommandInput = {
      sessionId: null,
      command: `cmd ${i}`,
      cwd: i % 2 ? '/a' : '/b',
      gitBranch: null,
      exitCode: i % 3 === 0 ? 0 : 1,
      startedAt: 1000 + i,
      durationMs: 1,
      source,
      output: `out ${i}`,
    };
    store.insertCommand(input);
  }
}

describe('Store pagination + aggregation', () => {
  let db: DB;
  let store: Store;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new Store(db);
  });

  afterEach(() => {
    db.close();
  });

  it('offset paging yields disjoint, recency-ordered pages across the boundary', () => {
    seed(store, 25);

    const page1 = store.search({ query: '', limit: 10, offset: 0 });
    const page2 = store.search({ query: '', limit: 10, offset: 10 });

    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(10);

    // No row id appears on both pages.
    const ids1 = new Set(page1.map((r) => r.id));
    const ids2 = new Set(page2.map((r) => r.id));
    const shared = [...ids2].filter((id) => ids1.has(id));
    expect(shared).toEqual([]);

    // Each page is internally descending by startedAt (most recent first)...
    for (let i = 1; i < page1.length; i++) {
      expect(page1[i - 1]!.startedAt).toBeGreaterThan(page1[i]!.startedAt);
    }
    for (let i = 1; i < page2.length; i++) {
      expect(page2[i - 1]!.startedAt).toBeGreaterThan(page2[i]!.startedAt);
    }

    // ...and order is continuous across the page boundary.
    expect(page1[page1.length - 1]!.startedAt).toBeGreaterThan(page2[0]!.startedAt);
  });

  it('countCommands honors filters and ignores limit/offset', () => {
    seed(store, 25);

    // exit-0 rows: i % 3 === 0 for i in [0, 25) -> 0,3,...,24 -> 9 rows.
    let expectedSuccess = 0;
    let expectedCwdA = 0;
    for (let i = 0; i < 25; i++) {
      if (i % 3 === 0) expectedSuccess++;
      if (i % 2) expectedCwdA++; // cwd === '/a'
    }

    expect(store.countCommands({ query: '', successOnly: true })).toBe(expectedSuccess);
    expect(store.countCommands({ query: '', cwd: '/a' })).toBe(expectedCwdA);

    // limit/offset must not affect the count.
    expect(store.countCommands({ query: '', successOnly: true, limit: 1, offset: 100 })).toBe(
      expectedSuccess
    );
  });

  it('getStats aggregates total, per-source counts, and first/last timestamps', () => {
    // pty: startedAt 1000..1004 (5 rows)
    seed(store, 5, 'pty');
    // hook: startedAt 1000..1002 (3 rows)
    seed(store, 3, 'hook');
    // history: startedAt 1000..1001 (2 rows)
    seed(store, 2, 'history');

    const stats = store.getStats();

    expect(stats.total).toBe(10);
    expect(stats.bySource).toEqual({ pty: 5, hook: 3, history: 2 });
    // Sum of per-source counts equals total.
    const sum = Object.values(stats.bySource).reduce((a, b) => a + b, 0);
    expect(sum).toBe(stats.total);
    // Min/max startedAt across all seeded rows.
    expect(stats.firstAt).toBe(1000);
    expect(stats.lastAt).toBe(1004);
  });

  it('EDGE: getStats on an empty store returns zeros and null timestamps without throwing', () => {
    const stats = store.getStats();

    expect(stats.total).toBe(0);
    expect(stats.bySource).toEqual({});
    expect(stats.firstAt).toBeNull();
    expect(stats.lastAt).toBeNull();
  });
});
