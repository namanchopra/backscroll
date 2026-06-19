/**
 * HTTP-agnostic API handlers. [TASK-004]
 *
 * These functions take a Store and parsed inputs and return a plain
 * { status, json } reply. They contain zero transport knowledge so the HTTP
 * server layer and unit tests can both drive them identically. They never read
 * the clock directly — `now` is injected for deterministic time parsing.
 *
 * IMPORTANT: handleRerunIntent records intent only. It does NOT execute the
 * recorded command — no child_process, no exec/spawn here, by design. The
 * control handlers below are equally process-free: pause touches a marker file,
 * import only reads history files + writes the DB, and config writes a JSON
 * file. Nothing in this module spawns a shell.
 */

import { Store } from '../db/store';
import { SearchFilters, SearchResult, CommandRecord, BackscrollConfig } from '../types';
import {
  ApiResult,
  ApiSearchResponse,
  ApiCommandDetail,
  ApiStats,
  RerunResponse,
  ApiStatus,
  ApiConfig,
  ImportResult,
} from './contract';
import { parseTimeSpec } from '../util/time';
import { isPaused, setPaused } from '../capture/recording-gate';
import { dataDir, dbPath } from '../paths';
import { bscVersion } from '../version';
import { loadConfig, mergeConfig, saveConfig } from '../config';
import { importHistory } from '../commands/import';

/** A transport-neutral handler reply: an HTTP status and a JSON-serialisable body. */
export interface ApiReply {
  status: number;
  json: unknown;
}

/** Default page size when `limit` is absent or unparseable. */
const DEFAULT_LIMIT = 50;
/** Upper bound on a single page; protects the DB from runaway queries. */
const MAX_LIMIT = 200;
/** Lower bound on a single page. */
const MIN_LIMIT = 1;

/** Clamp `n` into the inclusive [min, max] range. */
function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Project a SearchResult onto the wire shape, dropping the internal FTS rank. */
function toApiResult(r: SearchResult): ApiResult {
  return {
    id: r.id,
    command: r.command,
    cwd: r.cwd,
    gitBranch: r.gitBranch,
    exitCode: r.exitCode,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    source: r.source,
    snippet: r.snippet,
  };
}

/** Project a full CommandRecord onto the wire detail shape (includes output). */
function toApiCommandDetail(rec: CommandRecord): ApiCommandDetail {
  return {
    id: rec.id,
    command: rec.command,
    cwd: rec.cwd,
    gitBranch: rec.gitBranch,
    exitCode: rec.exitCode,
    startedAt: rec.startedAt,
    durationMs: rec.durationMs,
    source: rec.source,
    output: rec.output,
  };
}

/**
 * GET /api/search — full-text search with optional filters and pagination.
 *
 * Query params: q, cwd, success ('true' → successOnly), since, until, limit,
 * offset. since/until accept relative ("3w") or ISO time specs and are parsed
 * against the injected `now`; an unparseable value yields a 400 rather than a
 * throw.
 */
export function handleSearch(store: Store, params: URLSearchParams, now: number): ApiReply {
  const filters: SearchFilters = {
    query: params.get('q') ?? '',
  };

  const cwd = params.get('cwd');
  if (cwd) filters.cwd = cwd;

  if (params.get('success') === 'true') filters.successOnly = true;

  const since = params.get('since');
  if (since !== null) {
    try {
      filters.since = parseTimeSpec(since, now);
    } catch (err) {
      return { status: 400, json: { error: (err as Error).message } };
    }
  }

  const until = params.get('until');
  if (until !== null) {
    try {
      filters.until = parseTimeSpec(until, now);
    } catch (err) {
      return { status: 400, json: { error: (err as Error).message } };
    }
  }

  const limitRaw = params.get('limit');
  const parsedLimit = limitRaw !== null ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : clamp(parsedLimit, MIN_LIMIT, MAX_LIMIT);

  const offsetRaw = params.get('offset');
  const parsedOffset = offsetRaw !== null ? parseInt(offsetRaw, 10) : NaN;
  const offset = Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset;

  filters.limit = limit;
  filters.offset = offset;

  const results = store.search(filters).map(toApiResult);
  const total = store.countCommands(filters);

  const body: ApiSearchResponse = { results, total, offset, limit };
  return { status: 200, json: body };
}

/**
 * GET /api/command/:id — full detail (including captured output) for one
 * command. Validates the id is a positive integer; 404 when absent.
 */
export function handleCommand(store: Store, idRaw: string): ApiReply {
  if (!/^\d+$/.test(idRaw)) {
    return { status: 400, json: { error: `invalid command id: "${idRaw}"` } };
  }
  const id = parseInt(idRaw, 10);
  const rec = store.getCommandById(id);
  if (rec === null) {
    return { status: 404, json: { error: `command #${id} not found` } };
  }
  const body: ApiCommandDetail = toApiCommandDetail(rec);
  return { status: 200, json: body };
}

/** GET /api/stats — aggregate corpus statistics. */
export function handleStats(store: Store): ApiReply {
  const stats: ApiStats = store.getStats();
  return { status: 200, json: stats };
}

/**
 * POST /api/rerun/:id — record the *intent* to re-run a recorded command.
 *
 * This pushes the command text onto the provided `queue` for a consumer to act
 * on later. It deliberately performs NO execution: no child_process, no
 * exec/spawn. Validates the id; 404 when the command is absent.
 */
export function handleRerunIntent(store: Store, idRaw: string, queue: string[]): ApiReply {
  if (!/^\d+$/.test(idRaw)) {
    return { status: 400, json: { error: `invalid command id: "${idRaw}"` } };
  }
  const id = parseInt(idRaw, 10);
  const rec = store.getCommandById(id);
  if (rec === null) {
    return { status: 404, json: { error: `command #${id} not found` } };
  }
  queue.push(rec.command);
  const body: RerunResponse = { ok: true, command: rec.command };
  return { status: 200, json: body };
}

/** Sane bounds for the per-command output cap (bytes). */
const MIN_OUTPUT_BYTES = 1024;
const MAX_OUTPUT_BYTES = 100_000_000;

/** Narrow an unknown value to a plain (non-array) object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when `v` is an array whose every element is a string. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * GET /api/status — recorder + store status for the control UI.
 *
 * Reads the pause marker and resolves data/db paths + version; the only store
 * touch is getStats().total. No process is spawned.
 */
export function handleStatus(store: Store): ApiReply {
  const body: ApiStatus = {
    paused: isPaused(),
    dataDir: dataDir(),
    dbPath: dbPath(),
    version: bscVersion(),
    total: store.getStats().total,
  };
  return { status: 200, json: body };
}

/**
 * POST /api/pause — toggle the global recording pause marker.
 *
 * Body: { paused: boolean }. A non-boolean `paused` is a 400. setPaused only
 * creates/removes a marker file — it never spawns a process.
 */
export function handlePause(body: unknown): ApiReply {
  if (!isObject(body) || typeof body.paused !== 'boolean') {
    return { status: 400, json: { error: '`paused` must be a boolean' } };
  }
  setPaused(body.paused);
  const out: PauseResult = { paused: body.paused };
  return { status: 200, json: out };
}

/** Minimal pause-reply shape ({ paused }). */
interface PauseResult {
  paused: boolean;
}

/**
 * POST /api/import — backfill shell history from the zsh/bash flags.
 *
 * The browser may only pass { zsh?, bash? } — there is deliberately no `file`
 * path from the wire. importHistory reads history files and writes the DB; it
 * spawns nothing.
 */
export function handleImport(body: unknown): ApiReply {
  const opts: { zsh?: boolean; bash?: boolean } = {};
  if (isObject(body)) {
    if (body.zsh === true) opts.zsh = true;
    if (body.bash === true) opts.bash = true;
  }
  const result: ImportResult = importHistory(opts);
  return { status: 200, json: result };
}

/** GET /api/config — current effective configuration. */
export function handleGetConfig(): ApiReply {
  const body: ApiConfig = loadConfig();
  return { status: 200, json: body };
}

/**
 * POST /api/config — validate a partial config, merge over current, persist.
 *
 * Validation: redactionEnabled must be boolean; the three string-list fields
 * must be arrays of strings; maxOutputBytes must be a positive integer (clamped
 * to [MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES]). Any wrong type yields a 400 and no
 * write. saveConfig writes a JSON file only — no process is spawned.
 */
export function handleSetConfig(body: unknown): ApiReply {
  if (!isObject(body)) {
    return { status: 400, json: { error: 'config body must be an object' } };
  }

  const partial: Partial<BackscrollConfig> = {};

  if ('redactionEnabled' in body) {
    if (typeof body.redactionEnabled !== 'boolean') {
      return { status: 400, json: { error: '`redactionEnabled` must be a boolean' } };
    }
    partial.redactionEnabled = body.redactionEnabled;
  }

  for (const field of ['redactionExtraPatterns', 'excludeCommands', 'excludeDirs'] as const) {
    if (field in body) {
      const val = body[field];
      if (!isStringArray(val)) {
        return { status: 400, json: { error: `\`${field}\` must be an array of strings` } };
      }
      partial[field] = val;
    }
  }

  if ('maxOutputBytes' in body) {
    const n = body.maxOutputBytes;
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { status: 400, json: { error: '`maxOutputBytes` must be a positive integer' } };
    }
    partial.maxOutputBytes = clamp(n, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
  }

  const merged = mergeConfig({ ...loadConfig(), ...partial });
  saveConfig(merged);
  const out: ApiConfig = merged;
  return { status: 200, json: out };
}
