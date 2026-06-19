/**
 * `bsc pause` / `bsc resume` / `bsc status`. [TASK-021]
 */
import pc from 'picocolors';
import { isPaused, setPaused } from '../capture/recording-gate';
import { dataDir, dbPath } from '../paths';

export function pauseCommand(): number {
  setPaused(true);
  process.stdout.write(pc.yellow('● recording paused — `bsc resume` to re-enable.\n'));
  return 0;
}

export function resumeCommand(): number {
  setPaused(false);
  process.stdout.write(pc.green('● recording resumed.\n'));
  return 0;
}

export function statusCommand(): number {
  const paused = isPaused();
  process.stdout.write(`recording: ${paused ? pc.yellow('PAUSED') : pc.green('active')}\n`);
  process.stdout.write(pc.dim(`data dir:  ${dataDir()}\n`));
  process.stdout.write(pc.dim(`database:  ${dbPath()}\n`));
  return 0;
}
