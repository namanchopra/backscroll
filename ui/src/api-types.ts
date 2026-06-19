/**
 * Mirror of src/server/contract.ts — keep in sync.
 *
 * The SPA cannot import from src/ (separate build), so these wire-format DTOs
 * are duplicated here verbatim. If you change a contract in
 * src/server/contract.ts, update this file to match field-for-field.
 *
 * Pure types only — no runtime code.
 */

/**
 * Mirror of CommandSource from src/types.ts (contract.ts imports it from
 * ../types, which the SPA build cannot reach).
 */
export type CommandSource = 'pty' | 'hook' | 'history';

/** One search hit as returned over the wire. */
export interface ApiResult {
  id: number;
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  /** epoch milliseconds */
  startedAt: number;
  durationMs: number | null;
  source: CommandSource;
  /** one-line output snippet around the match, if any */
  snippet: string | null;
}

/** Response body for a search query. */
export interface ApiSearchResponse {
  results: ApiResult[];
  /** total number of matches available (ignoring pagination) */
  total: number;
  offset: number;
  limit: number;
}

/** Full command detail including captured output. */
export interface ApiCommandDetail {
  id: number;
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  /** epoch milliseconds */
  startedAt: number;
  durationMs: number | null;
  source: CommandSource;
  /** redacted, ANSI-stripped output; null when no output was captured */
  output: string | null;
}

/** Aggregate statistics about the recorded command corpus. */
export interface ApiStats {
  total: number;
  /** count of commands keyed by source */
  bySource: Record<string, number>;
  /** epoch milliseconds of the earliest command, null when empty */
  firstAt: number | null;
  /** epoch milliseconds of the latest command, null when empty */
  lastAt: number | null;
}

/** Response body for a re-run request. */
export interface RerunResponse {
  ok: boolean;
  /** the command text that was (or would be) re-run */
  command: string;
}

/** Runtime status of the recorder + store, for the control UI. */
export interface ApiStatus {
  /** true when recording is globally paused (pause marker present) */
  paused: boolean;
  /** absolute path to the Backscroll data directory */
  dataDir: string;
  /** absolute path to the SQLite database file */
  dbPath: string;
  /** running bsc version */
  version: string;
  /** total recorded commands */
  total: number;
}

/** User configuration as exposed over the wire (mirrors BackscrollConfig). */
export interface ApiConfig {
  redactionEnabled: boolean;
  redactionExtraPatterns: string[];
  excludeCommands: string[];
  excludeDirs: string[];
  maxOutputBytes: number;
}

/** Result counts from a history import pass. */
export interface ImportResult {
  imported: number;
  skipped: number;
  excluded: number;
  filesRead: number;
}

/** Query parameters accepted by the /api/search endpoint. */
export interface SearchQuery {
  q?: string;
  cwd?: string;
  success?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}
