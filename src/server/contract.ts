/**
 * API DTO contracts shared between the HTTP server and the web SPA. [TASK-001]
 *
 * These describe the JSON shapes that cross the network boundary. They mirror
 * the domain types in '../types' but are intentionally separate so the wire
 * format can evolve independently of internal storage shapes.
 *
 * Pure types only — no runtime code, no side-effecting imports.
 */

import type { CommandSource } from '../types';

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

/** Request body to re-run a previously recorded command. */
export interface RerunRequest {
  id: number;
}

/** Response body for a re-run request. */
export interface RerunResponse {
  ok: boolean;
  /** the command text that was (or would be) re-run */
  command: string;
}
