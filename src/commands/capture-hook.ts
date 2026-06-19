/**
 * `bsc capture-hook` (hidden) — write a metadata-only row from the zsh hook.
 * [supports TASK-013 / TASK-019]
 *
 * Called (backgrounded) by the shell integration when NOT inside `bsc rec`.
 * It must never disrupt the user's shell, so every path returns quietly.
 */
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { loadConfig } from '../config';
import { redact } from '../redaction/redact';
import { isPaused, shouldRecord } from '../capture/recording-gate';

export interface CaptureHookOptions {
  cmdB64?: string;
  cwdB64?: string;
  branchB64?: string;
  exit?: string;
  dur?: string;
}

function decode(value: string | undefined): string {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function captureHookCommand(opts: CaptureHookOptions): number {
  try {
    if (isPaused()) return 0;

    const command = decode(opts.cmdB64).trim();
    if (!command) return 0;

    const cwd = decode(opts.cwdB64) || null;
    const branch = decode(opts.branchB64) || null;
    const config = loadConfig();
    if (!shouldRecord(command, cwd, config)) return 0;

    const exitCode = opts.exit !== undefined && /^-?\d+$/.test(opts.exit) ? parseInt(opts.exit, 10) : null;
    const durationMs = opts.dur !== undefined && /^\d+$/.test(opts.dur) ? parseInt(opts.dur, 10) : null;

    const store = new Store(getDb());
    store.insertCommand({
      sessionId: null,
      command: redact(command, config),
      cwd,
      gitBranch: branch,
      exitCode,
      startedAt: Date.now() - (durationMs ?? 0),
      durationMs,
      source: 'hook',
      output: null,
    });
    return 0;
  } catch {
    return 0;
  }
}
