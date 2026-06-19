/**
 * Shared domain types for Backscroll. [TASK-003]
 *
 * These are the contracts every other module depends on. Keep them free of
 * runtime imports so they can be imported anywhere without side effects.
 */

/** Where a command record came from. */
export type CommandSource = 'pty' | 'hook';

/** One `bsc rec` recording session. */
export interface SessionRecord {
  id: number;
  /** epoch milliseconds */
  startedAt: number;
  /** epoch milliseconds, null while the session is still open */
  endedAt: number | null;
  shell: string | null;
  tty: string | null;
  hostname: string | null;
  bscVersion: string | null;
}

/** A single executed command, as stored. */
export interface CommandRecord {
  id: number;
  sessionId: number | null;
  /** redacted command text */
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  /** epoch milliseconds */
  startedAt: number;
  durationMs: number | null;
  source: CommandSource;
  /** redacted, ANSI-stripped output; null when no output was captured (hook source) */
  output: string | null;
  outputBytes: number | null;
}

/** Insert payload for a command (no id yet, output optional). */
export interface CommandInput {
  sessionId: number | null;
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  startedAt: number;
  durationMs: number | null;
  source: CommandSource;
  /** null = no output captured (metadata-only / hook source) */
  output: string | null;
}

/** A per-command output block emitted by the segmenter. */
export interface OutputBlock {
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  startedAt: number;
  durationMs: number | null;
  /** ANSI-stripped output text */
  output: string;
  /** true when output was capped at maxOutputBytes */
  truncated: boolean;
  source: CommandSource;
}

/** Filters for `bsc search`. */
export interface SearchFilters {
  /** FTS query string (required) */
  query: string;
  /** directory prefix match */
  cwd?: string;
  /** only exit code 0 */
  successOnly?: boolean;
  /** epoch ms lower bound (inclusive) */
  since?: number;
  /** epoch ms upper bound (inclusive) */
  until?: number;
  /** max rows to return */
  limit?: number;
}

/** A search hit. */
export interface SearchResult {
  id: number;
  command: string;
  cwd: string | null;
  gitBranch: string | null;
  exitCode: number | null;
  startedAt: number;
  durationMs: number | null;
  source: CommandSource;
  /** one-line output snippet around the match, if any */
  snippet: string | null;
  /** FTS rank (lower = more relevant) */
  rank: number;
}

/** User configuration, merged over defaults. */
export interface BackscrollConfig {
  /** master switch for redaction; default true */
  redactionEnabled: boolean;
  /** extra user-supplied regex sources applied during redaction */
  redactionExtraPatterns: string[];
  /** command patterns (glob/substring) to never record */
  excludeCommands: string[];
  /** directory patterns (glob/substring) to never record */
  excludeDirs: string[];
  /** per-command output cap in bytes; output beyond this is truncated */
  maxOutputBytes: number;
}

/** A single redaction hit (for testing / diagnostics). */
export interface RedactionMatch {
  kind: string;
  start: number;
  end: number;
}
