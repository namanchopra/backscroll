/**
 * Recording gate — pause + exclude privacy controls. [TASK-014]
 *
 * Decides whether a command may be recorded at all, before redaction. Two
 * independent gates: a global pause marker, and per-command/-dir exclude
 * patterns from config.
 */
import fs from 'fs';
import { pauseMarkerPath, ensureDataDir } from '../paths';
import { BackscrollConfig } from '../types';

/** True when recording is globally paused (pause marker present). */
export function isPaused(): boolean {
  try {
    return fs.existsSync(pauseMarkerPath());
  } catch {
    return false;
  }
}

/** Create or remove the pause marker. */
export function setPaused(paused: boolean): void {
  const marker = pauseMarkerPath();
  if (paused) {
    ensureDataDir();
    fs.writeFileSync(marker, `paused\n`, { mode: 0o600 });
  } else {
    try {
      fs.unlinkSync(marker);
    } catch {
      /* already resumed — no-op */
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesCommand(command: string, pattern: string): boolean {
  if (pattern.includes('*') || pattern.includes('?')) return globToRegExp(pattern).test(command);
  return command.includes(pattern);
}

function matchesDir(cwd: string, pattern: string): boolean {
  if (pattern.includes('*') || pattern.includes('?')) return globToRegExp(pattern).test(cwd);
  if (cwd === pattern) return true;
  // Path-prefix match only — a substring match would over-exclude (e.g. the
  // pattern '/tmp' must not match '/var/tmp/foo').
  const prefix = pattern.endsWith('/') ? pattern : `${pattern}/`;
  return cwd.startsWith(prefix);
}

/**
 * Whether a command in `cwd` should be recorded given config exclude lists.
 * Empty exclude lists allow everything (default-permissive).
 */
export function shouldRecord(
  command: string,
  cwd: string | null,
  config: BackscrollConfig
): boolean {
  for (const pat of config.excludeCommands) {
    if (pat && matchesCommand(command, pat)) return false;
  }
  if (cwd) {
    for (const pat of config.excludeDirs) {
      if (pat && matchesDir(cwd, pat)) return false;
    }
  }
  return true;
}
