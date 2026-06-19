/**
 * `bsc search <query>` — filtered search, with interactive picker. [TASK-022 + TASK-025]
 */
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { parseTimeSpec } from '../util/time';
import { formatResults } from '../ui/format';
import { runPicker } from '../ui/picker';
import { SearchFilters } from '../types';

export interface SearchOptions {
  cwd?: string;
  success?: boolean;
  since?: string;
  until?: string;
  limit?: string;
  /** commander sets this false when --no-pick is passed */
  pick?: boolean;
}

export async function searchCommand(
  query: string | undefined,
  opts: SearchOptions
): Promise<number> {
  const now = Date.now();
  const filters: SearchFilters = { query: query ?? '' };

  if (opts.cwd) filters.cwd = opts.cwd;
  if (opts.success) filters.successOnly = true;
  // parseTimeSpec throws on invalid input; the CLI wrapper reports it cleanly.
  if (opts.since) filters.since = parseTimeSpec(opts.since, now);
  if (opts.until) filters.until = parseTimeSpec(opts.until, now);
  if (opts.limit) {
    const n = parseInt(opts.limit, 10);
    if (Number.isNaN(n) || n <= 0) throw new Error(`invalid --limit "${opts.limit}"`);
    filters.limit = n;
  }

  const store = new Store(getDb());
  const results = store.search(filters);

  if (results.length === 0) {
    process.stdout.write('No matches.\n');
    return 0;
  }

  const interactive = opts.pick !== false && Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  if (interactive) {
    return runPicker(results, store, { query: filters.query, now });
  }

  process.stdout.write(`${formatResults(results, { query: filters.query, now })}\n`);
  return 0;
}
