/**
 * `bsc rec` — launch a PTY-wrapped recording shell. [TASK-020]
 */
import os from 'os';
import pc from 'picocolors';
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { loadConfig } from '../config';
import { runRecorder } from '../capture/pty-recorder';
import { dbPath } from '../paths';
import { bscVersion } from '../version';

export async function recCommand(): Promise<number> {
  if (process.env.BACKSCROLL_REC) {
    process.stderr.write(
      pc.yellow('bsc: already inside a recording session — nested `bsc rec` refused.\n')
    );
    return 1;
  }

  const store = new Store(getDb());
  const config = loadConfig();
  const startedAt = Date.now();
  const sessionId = store.createSession({
    startedAt,
    shell: process.env.SHELL ?? null,
    tty: process.env.TTY ?? null,
    hostname: os.hostname(),
    bscVersion: bscVersion(),
  });

  process.stderr.write(pc.dim(`● recording → ${dbPath()}  (exit the shell to stop)\n`));

  try {
    return await runRecorder({
      insertCommand: (input) => store.insertCommand(input),
      config,
      sessionId,
    });
  } finally {
    // Always close the session row, even if the recorder failed to start.
    store.endSession(sessionId, Date.now());
  }
}
