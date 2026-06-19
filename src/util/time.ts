/**
 * Time parsing and humanizing. [TASK-016]
 *
 * `now` is always injected so the logic is deterministic and testable — no
 * hidden Date.now() in the parse path.
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000, // 30 days
  y: 31_536_000_000, // 365 days
};

// 'mo' must precede 'm' so "3mo" isn't read as "3m" + "o".
const RELATIVE_RE = /^(\d+)\s*(mo|s|m|h|d|w|y)$/i;

/**
 * Parse a relative duration ("3w", "2d", "45m", "1mo") or an ISO date into
 * an absolute epoch-ms timestamp. Relative values are interpreted as
 * "that long before `now`". Throws on anything unparseable.
 */
export function parseTimeSpec(input: string, now: number): number {
  const trimmed = input.trim();
  const rel = trimmed.match(RELATIVE_RE);
  if (rel) {
    const n = parseInt(rel[1] as string, 10);
    const unit = (rel[2] as string).toLowerCase();
    const ms = UNIT_MS[unit];
    if (ms === undefined) throw new Error(`Unknown time unit: "${rel[2]}"`);
    return now - n * ms;
  }

  // Reject a bare number: Date.parse would silently read it as a year
  // ("3" -> 2001, "45" -> 2044), which is never what the user meant.
  if (/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `Ambiguous time "${input}": add a unit (e.g. ${trimmed}d, ${trimmed}w) or use an ISO date.`
    );
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;

  throw new Error(`Cannot parse time: "${input}" (use e.g. 3w, 2d, 45m, or an ISO date)`);
}

/** "3w ago", "2d ago", "5m ago", "just now". */
export function humanizeRelative(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 0) return 'in the future';
  if (diff < 45_000) return 'just now';
  const units: Array<[string, number]> = [
    ['y', UNIT_MS.y as number],
    ['mo', UNIT_MS.mo as number],
    ['w', UNIT_MS.w as number],
    ['d', UNIT_MS.d as number],
    ['h', UNIT_MS.h as number],
    ['m', UNIT_MS.m as number],
  ];
  for (const [label, ms] of units) {
    const v = Math.floor(diff / ms);
    if (v >= 1) return `${v}${label} ago`;
  }
  return `${Math.floor(diff / 1000)}s ago`;
}

/** "350ms", "1.2s", "12s", "1m", "2m3s". */
export function humanizeDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = ms / 1000;
  // Show one decimal under ~10s; otherwise round to whole seconds and carry into
  // minutes so we never emit "60s" or "1m60s".
  if (totalSec < 9.95) return `${(Math.round(totalSec * 10) / 10).toFixed(1)}s`;
  const whole = Math.round(totalSec);
  if (whole < 60) return `${whole}s`;
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return sec === 0 ? `${min}m` : `${min}m${sec}s`;
}
