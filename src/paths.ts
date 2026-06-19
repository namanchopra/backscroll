/**
 * Data-directory and file-path resolution. [TASK-005]
 *
 * Everything Backscroll writes lives under one private directory, resolved
 * from $BACKSCROLL_DIR, then $XDG_DATA_HOME, then ~/.local/share/backscroll.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

/** Resolve the Backscroll data directory (does not create it). */
export function dataDir(): string {
  const override = process.env.BACKSCROLL_DIR;
  if (override && override.trim()) return override;

  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'backscroll');
}

/** Path to the SQLite database file. */
export function dbPath(): string {
  return path.join(dataDir(), 'backscroll.sqlite');
}

/** Path to the JSON config file. */
export function configPath(): string {
  return path.join(dataDir(), 'config.json');
}

/** Presence of this file means recording is paused. */
export function pauseMarkerPath(): string {
  return path.join(dataDir(), 'paused');
}

/**
 * Create the data directory with owner-only (0700) permissions, idempotently.
 * The DB may contain captured output, so it must never be group/other readable.
 */
export function ensureDataDir(): string {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir mode is masked by umask; force the permissions explicitly.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort — some filesystems don't support chmod */
  }
  return dir;
}
