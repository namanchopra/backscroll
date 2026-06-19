/**
 * Result formatting and match highlighting. [TASK-018]
 *
 * picocolors auto-disables colour when output is not a TTY or NO_COLOR is set.
 */
import pc from 'picocolors';
import { CommandRecord, SearchResult } from '../types';
import { humanizeRelative, humanizeDuration } from '../util/time';

function statusGlyph(exit: number | null): string {
  if (exit === null) return pc.dim('?');
  return exit === 0 ? pc.green('✓') : pc.red('✗');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, tokens: string[]): string {
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  return text.replace(re, (m) => pc.inverse(m));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export interface FormatOptions {
  query?: string;
  now?: number;
  columns?: number;
}

/** Render search results as aligned, highlighted lines. */
export function formatResults(results: SearchResult[], opts: FormatOptions = {}): string {
  if (results.length === 0) return pc.dim('No matches.');
  const now = opts.now ?? Date.now();
  const tokens = (opts.query ?? '').match(/\S+/g) ?? [];
  const cols = opts.columns ?? process.stdout.columns ?? 100;
  const lines: string[] = [];

  for (const r of results) {
    const id = pc.dim(`#${r.id}`);
    const glyph = statusGlyph(r.exitCode);
    const when = pc.cyan(humanizeRelative(r.startedAt, now).padStart(8));
    const cwd = r.cwd ? pc.blue(truncate(r.cwd, 28)) : pc.dim('—');
    const cmdMax = Math.max(20, cols - 56);
    const cmd = highlight(truncate(r.command.replace(/\s+/g, ' '), cmdMax), tokens);
    lines.push(`${id}  ${glyph} ${when}  ${cwd}  ${cmd}`);
    if (r.snippet) {
      lines.push(pc.dim('     ↳ ') + highlight(truncate(r.snippet, cols - 8), tokens));
    }
  }
  return lines.join('\n');
}

/** Render the metadata header shown by `bsc show`. */
export function formatCommandHeader(rec: CommandRecord, now: number = Date.now()): string {
  const glyph = statusGlyph(rec.exitCode);
  return [
    pc.bold(`#${rec.id}  ${glyph} ${rec.command}`),
    `${pc.dim('  cwd:    ')}${rec.cwd ?? '—'}`,
    `${pc.dim('  branch: ')}${rec.gitBranch ?? '—'}`,
    `${pc.dim('  exit:   ')}${rec.exitCode === null ? '—' : String(rec.exitCode)}`,
    `${pc.dim('  when:   ')}${new Date(rec.startedAt).toISOString()} (${humanizeRelative(rec.startedAt, now)})`,
    `${pc.dim('  took:   ')}${humanizeDuration(rec.durationMs)}`,
    `${pc.dim('  source: ')}${rec.source}`,
  ].join('\n');
}
