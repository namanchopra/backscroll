/**
 * Pure browser-side formatting helpers.
 *
 * No Node imports, no external libraries. The current time (`now`) is always
 * injected so every function stays deterministic and testable.
 */

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const MS_WEEK = 604_800_000;
const MS_MONTH = 2_592_000_000;
const MS_YEAR = 31_536_000_000;

const JUST_NOW_THRESHOLD = 45_000;

interface RelativeUnit {
  readonly ms: number;
  readonly label: string;
}

const RELATIVE_UNITS: readonly RelativeUnit[] = [
  { ms: MS_YEAR, label: 'y' },
  { ms: MS_MONTH, label: 'mo' },
  { ms: MS_WEEK, label: 'w' },
  { ms: MS_DAY, label: 'd' },
  { ms: MS_HOUR, label: 'h' },
  { ms: MS_MINUTE, label: 'm' },
];

/**
 * Render a timestamp relative to `now`.
 *
 * - Negative diff (timestamp in the future) → "in the future".
 * - Diff < 45s → "just now".
 * - Otherwise the largest matching unit of y/mo/w/d/h/m as "N<unit> ago".
 * - Remaining sub-minute spans fall back to seconds as "Ns ago".
 */
export function relativeTime(ts: number, now: number): string {
  const diff = now - ts;

  if (diff < 0) {
    return 'in the future';
  }

  if (diff < JUST_NOW_THRESHOLD) {
    return 'just now';
  }

  for (const unit of RELATIVE_UNITS) {
    if (diff >= unit.ms) {
      const value = Math.floor(diff / unit.ms);
      return `${value}${unit.label} ago`;
    }
  }

  const seconds = Math.floor(diff / 1000);
  return `${seconds}s ago`;
}

/**
 * Render an elapsed duration in milliseconds as a compact human string.
 *
 * - null or negative → "—".
 * - < 1000ms → "Nms".
 * - < 9.95s → one decimal second, e.g. "1.2s".
 * - Otherwise whole seconds, carrying into minutes so the output never emits
 *   "60s" or "Xm60s" (e.g. 90000 → "1m30s", 59600 → "1m", 12000 → "12s").
 */
export function duration(ms: number | null): string {
  if (ms === null || ms < 0) {
    return '—';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 9950) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m${seconds}s`;
}

/**
 * Map a process exit code to a Tailwind text color class.
 *
 * - null (still running / unknown) → "text-slate-500".
 * - 0 (success) → "text-emerald-400".
 * - non-zero (failure) → "text-rose-400".
 */
export function statusClass(exitCode: number | null): string {
  if (exitCode === null) {
    return 'text-slate-500';
  }

  return exitCode === 0 ? 'text-emerald-400' : 'text-rose-400';
}

/**
 * Map a process exit code to a status glyph.
 *
 * - null (still running / unknown) → "?".
 * - 0 (success) → "✓".
 * - non-zero (failure) → "✗".
 */
export function statusGlyph(exitCode: number | null): string {
  if (exitCode === null) {
    return '?';
  }

  return exitCode === 0 ? '✓' : '✗';
}

/**
 * Bucket a timestamp into a coarse, human time group relative to `now`, for the
 * timeline group headers in the result list. Buckets are mutually exclusive and
 * ordered newest → oldest:
 *
 * - future timestamp → "Today" (clamped; treated as the most recent group).
 * - same calendar-relative day (< 24h) → "Today".
 * - previous day (< 48h) → "Yesterday".
 * - within the last 7 days → "This week".
 * - within the last ~4 weeks → "N weeks ago" (1–4).
 * - within the last ~12 months → "N months ago" (1–11).
 * - older → "Older".
 */
export function timeGroup(ts: number, now: number): string {
  const diff = now - ts;

  if (diff < MS_DAY) {
    return 'Today';
  }
  if (diff < 2 * MS_DAY) {
    return 'Yesterday';
  }
  if (diff < MS_WEEK) {
    return 'This week';
  }
  if (diff < MS_MONTH) {
    const weeks = Math.floor(diff / MS_WEEK);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (diff < MS_YEAR) {
    const months = Math.floor(diff / MS_MONTH);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  return 'Older';
}
