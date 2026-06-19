/**
 * Store unit tests. [TASK-031]
 *
 * Exercises insert + FTS round-trip and every SearchFilters branch against a
 * fresh in-memory database per test, so no real files are touched.
 */
import { openDatabase, DB } from '../src/db/database';
import { Store } from '../src/db/store';
import { CommandInput, SearchFilters } from '../src/types';

/** Build a fully-populated CommandInput, overriding only what a test cares about. */
function makeInput(overrides: Partial<CommandInput> = {}): CommandInput {
  return {
    sessionId: null,
    command: 'echo hello',
    cwd: '/home/me/work',
    gitBranch: 'main',
    exitCode: 0,
    startedAt: 1_000,
    durationMs: 12,
    source: 'pty',
    output: 'hello',
    ...overrides,
  };
}

describe('Store', () => {
  let db: DB;
  let store: Store;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new Store(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips an insert and finds it by an OUTPUT-only term', () => {
    const id = store.insertCommand(
      makeInput({
        command: 'run thing',
        output: 'Server started on :8080 docker ok',
      })
    );
    expect(id).toBeGreaterThan(0);

    // "docker" appears only in the output, never in the command text.
    const results = store.search({ query: 'docker' });
    expect(results).toHaveLength(1);
    const hit = results[0]!;
    expect(hit.id).toBe(id);
    expect(hit.command).toBe('run thing');
    expect(hit.snippet).toContain('docker');
  });

  it('successOnly returns only the exit-0 row', () => {
    const okId = store.insertCommand(
      makeInput({ command: 'deploy alpha', exitCode: 0, output: 'deploy result' })
    );
    store.insertCommand(
      makeInput({ command: 'deploy beta', exitCode: 1, output: 'deploy result' })
    );

    const filters: SearchFilters = { query: 'deploy', successOnly: true };
    const results = store.search(filters);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(okId);
    expect(results[0]!.exitCode).toBe(0);
  });

  it('cwd prefix filter restricts results to the matching directory', () => {
    const workId = store.insertCommand(
      makeInput({ command: 'build site', cwd: '/home/me/work', output: 'build result' })
    );
    store.insertCommand(
      makeInput({ command: 'build site', cwd: '/home/me/other', output: 'build result' })
    );

    const results = store.search({ query: 'build', cwd: '/home/me/work' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(workId);
    expect(results[0]!.cwd).toBe('/home/me/work');
  });

  it('limit caps the number of returned rows', () => {
    for (let i = 0; i < 4; i++) {
      store.insertCommand(
        makeInput({ command: `task ${i}`, output: 'common matchable token', startedAt: 1_000 + i })
      );
    }

    const results = store.search({ query: 'matchable', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.length).toBe(2);
  });

  it('since/until bound the time window inclusively', () => {
    store.insertCommand(makeInput({ command: 'older', output: 'window token', startedAt: 1_000 }));
    store.insertCommand(makeInput({ command: 'middle', output: 'window token', startedAt: 2_000 }));
    store.insertCommand(makeInput({ command: 'newer', output: 'window token', startedAt: 3_000 }));

    // since excludes rows older than the bound.
    const sinceResults = store.search({ query: 'window', since: 2_000 });
    expect(sinceResults.map((r) => r.startedAt).sort((a, b) => a - b)).toEqual([2_000, 3_000]);

    // until excludes rows newer than the bound.
    const untilResults = store.search({ query: 'window', until: 2_000 });
    expect(untilResults.map((r) => r.startedAt).sort((a, b) => a - b)).toEqual([1_000, 2_000]);

    // combined bounds isolate the single middle row (inclusive on both ends).
    const windowResults = store.search({ query: 'window', since: 2_000, until: 2_000 });
    expect(windowResults).toHaveLength(1);
    expect(windowResults[0]!.startedAt).toBe(2_000);
  });

  it('a null-output command is still searchable by its COMMAND text', () => {
    const id = store.insertCommand(
      makeInput({ command: 'kubectl get pods', output: null, source: 'hook' })
    );

    const results = store.search({ query: 'kubectl' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(id);
    // No output captured, so there is no snippet.
    expect(results[0]!.snippet).toBeNull();

    const record = store.getCommandById(id);
    expect(record).not.toBeNull();
    expect(record!.output).toBeNull();
    expect(record!.outputBytes).toBeNull();
    expect(record!.command).toBe('kubectl get pods');
  });
});
