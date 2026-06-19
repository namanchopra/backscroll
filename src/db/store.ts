/**
 * Store API. [TASK-008]
 *
 * The only module that talks SQL. insertCommand writes commands + output +
 * search_fts in one transaction so the full-text index can never drift from
 * the rows it indexes.
 */
import { DB } from './database';
import {
  CommandInput,
  CommandRecord,
  CommandSource,
  SearchFilters,
  SearchResult,
} from '../types';

interface CommandRow {
  id: number;
  session_id: number | null;
  command: string;
  cwd: string | null;
  git_branch: string | null;
  exit_code: number | null;
  started_at: number;
  duration_ms: number | null;
  source: string;
  output: string | null;
}

export interface SessionMeta {
  startedAt: number;
  shell?: string | null;
  tty?: string | null;
  hostname?: string | null;
  bscVersion?: string | null;
}

function toRecord(row: CommandRow): CommandRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    command: row.command,
    cwd: row.cwd,
    gitBranch: row.git_branch,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    source: row.source as CommandSource,
    output: row.output,
    outputBytes: row.output != null ? Buffer.byteLength(row.output, 'utf8') : null,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Find the earliest index in `hay` (already lowercased) where `token` or a
 * stem of it appears. FTS5 matches via the porter stemmer (running→run), so an
 * exact substring lookup would miss legitimately-matched rows; fall back to
 * progressively shorter prefixes down to 3 chars.
 */
function findTokenIndex(hay: string, token: string): number {
  const t = token.toLowerCase();
  const min = Math.min(3, t.length);
  for (let cut = t.length; cut >= min; cut--) {
    const at = hay.indexOf(t.slice(0, cut));
    if (at >= 0) return at;
  }
  return -1;
}

/** Build a one-line snippet of `output` around the first matching token. */
function makeSnippet(output: string | null, tokens: string[]): string | null {
  if (!output || tokens.length === 0) return null;
  const hay = output.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const at = findTokenIndex(hay, t);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  if (idx < 0) return null;
  const start = Math.max(0, idx - 30);
  const end = Math.min(output.length, idx + 70);
  let snip = output.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snip = `…${snip}`;
  if (end < output.length) snip = `${snip}…`;
  return snip;
}

export class Store {
  constructor(private readonly db: DB) {}

  createSession(meta: SessionMeta): number {
    const info = this.db
      .prepare(
        `INSERT INTO sessions (started_at, ended_at, shell, tty, hostname, bsc_version)
         VALUES (?, NULL, ?, ?, ?, ?)`
      )
      .run(
        meta.startedAt,
        meta.shell ?? null,
        meta.tty ?? null,
        meta.hostname ?? null,
        meta.bscVersion ?? null
      );
    return Number(info.lastInsertRowid);
  }

  endSession(id: number, endedAt: number): void {
    this.db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(endedAt, id);
  }

  insertCommand(input: CommandInput): number {
    const tx = this.db.transaction((c: CommandInput): number => {
      const info = this.db
        .prepare(
          `INSERT INTO commands
             (session_id, command, cwd, git_branch, exit_code, started_at, duration_ms, source)
           VALUES (@sessionId, @command, @cwd, @gitBranch, @exitCode, @startedAt, @durationMs, @source)`
        )
        .run({
          sessionId: c.sessionId,
          command: c.command,
          cwd: c.cwd,
          gitBranch: c.gitBranch,
          exitCode: c.exitCode,
          startedAt: c.startedAt,
          durationMs: c.durationMs,
          source: c.source,
        });
      const id = Number(info.lastInsertRowid);

      if (c.output !== null) {
        this.db
          .prepare(`INSERT INTO output (command_id, data, bytes) VALUES (?, ?, ?)`)
          .run(id, c.output, Buffer.byteLength(c.output, 'utf8'));
      }

      this.db
        .prepare(`INSERT INTO search_fts (rowid, command, output) VALUES (?, ?, ?)`)
        .run(id, c.command, c.output ?? '');

      return id;
    });
    return tx(input);
  }

  /**
   * Build the shared FROM / WHERE / ORDER / rank fragments and bound params for
   * a set of filters. Used by both search() and countCommands() so their
   * matching semantics (cwd prefix, successOnly, since/until, FTS MATCH when
   * the query is non-empty) can never drift apart.
   */
  private buildQueryParts(filters: SearchFilters): {
    tokens: string[];
    from: string;
    where: string;
    order: string;
    rankSel: string;
    params: Record<string, unknown>;
  } {
    const tokens = filters.query.match(/\S+/g) ?? [];
    const conds: string[] = [];
    const params: Record<string, unknown> = {};

    let from: string;
    let order: string;
    let rankSel: string;

    if (tokens.length > 0) {
      const fts = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
      from = `FROM search_fts
              JOIN commands c ON c.id = search_fts.rowid
              LEFT JOIN output o ON o.command_id = c.id`;
      conds.push('search_fts MATCH @q');
      params.q = fts;
      order = 'ORDER BY bm25(search_fts)';
      rankSel = ', bm25(search_fts) AS rank';
    } else {
      from = `FROM commands c LEFT JOIN output o ON o.command_id = c.id`;
      order = 'ORDER BY c.started_at DESC';
      rankSel = ', 0 AS rank';
    }

    if (filters.cwd) {
      conds.push(`c.cwd LIKE @cwd ESCAPE '\\'`);
      params.cwd = `${escapeLike(filters.cwd)}%`;
    }
    if (filters.successOnly) conds.push('c.exit_code = 0');
    if (filters.since !== undefined) {
      conds.push('c.started_at >= @since');
      params.since = filters.since;
    }
    if (filters.until !== undefined) {
      conds.push('c.started_at <= @until');
      params.until = filters.until;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return { tokens, from, where, order, rankSel, params };
  }

  search(filters: SearchFilters): SearchResult[] {
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 50;
    const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;
    const { tokens, from, where, order, rankSel, params } = this.buildQueryParts(filters);
    params.limit = limit;
    params.offset = offset;

    const sql = `SELECT c.id, c.session_id, c.command, c.cwd, c.git_branch, c.exit_code,
                        c.started_at, c.duration_ms, c.source, o.data AS output ${rankSel}
                 ${from} ${where} ${order} LIMIT @limit OFFSET @offset`;

    const rows = this.db.prepare(sql).all(params) as Array<CommandRow & { rank: number }>;
    return rows.map((r) => ({
      id: r.id,
      command: r.command,
      cwd: r.cwd,
      gitBranch: r.git_branch,
      exitCode: r.exit_code,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      source: r.source as CommandSource,
      snippet: makeSnippet(r.output, tokens),
      rank: r.rank,
    }));
  }

  /**
   * Count rows matching the same WHERE/MATCH logic as search(), ignoring
   * limit/offset. Useful for pagination ("X of N results").
   */
  countCommands(filters: SearchFilters): number {
    const { from, where, params } = this.buildQueryParts(filters);
    const sql = `SELECT count(*) AS n ${from} ${where}`;
    const row = this.db.prepare(sql).get(params) as { n: number };
    return row.n;
  }

  /**
   * Aggregate store statistics: total command count, counts grouped by source,
   * and the earliest/latest started_at. Empty store yields total 0, an empty
   * bySource map, and null first/last timestamps.
   */
  getStats(): { total: number; bySource: Record<string, number>; firstAt: number | null; lastAt: number | null } {
    const totalRow = this.db.prepare(`SELECT count(*) AS n FROM commands`).get() as { n: number };
    const sourceRows = this.db
      .prepare(`SELECT source, count(*) AS n FROM commands GROUP BY source`)
      .all() as Array<{ source: string; n: number }>;
    const rangeRow = this.db
      .prepare(`SELECT min(started_at) AS firstAt, max(started_at) AS lastAt FROM commands`)
      .get() as { firstAt: number | null; lastAt: number | null };

    const bySource: Record<string, number> = {};
    for (const r of sourceRows) bySource[r.source] = r.n;

    return {
      total: totalRow.n,
      bySource,
      firstAt: rangeRow.firstAt ?? null,
      lastAt: rangeRow.lastAt ?? null,
    };
  }

  getCommandById(id: number): CommandRecord | null {
    const row = this.db
      .prepare(
        `SELECT c.*, o.data AS output
         FROM commands c LEFT JOIN output o ON o.command_id = c.id
         WHERE c.id = ?`
      )
      .get(id) as CommandRow | undefined;
    return row ? toRecord(row) : null;
  }

  getRecentCommands(limit: number): CommandRecord[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, o.data AS output
         FROM commands c LEFT JOIN output o ON o.command_id = c.id
         ORDER BY c.started_at DESC LIMIT ?`
      )
      .all(limit) as CommandRow[];
    return rows.map(toRecord);
  }

  /**
   * Keys (`<started_at> <command>`) of already-imported history rows, so
   * `bsc import` is idempotent. Must use the SAME separator as import.ts.
   * Commands are the stored (redacted) form.
   */
  existingHistoryKeys(): Set<string> {
    const rows = this.db
      .prepare(`SELECT started_at, command FROM commands WHERE source = 'history'`)
      .all() as Array<{ started_at: number; command: string }>;
    return new Set(rows.map((r) => `${r.started_at} ${r.command}`));
  }
}
