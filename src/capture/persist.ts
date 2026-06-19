/**
 * Persist pipeline: gate → redact → insert. [TASK-033]
 *
 * Isolates the storage/privacy decision from the PTY mechanics so the
 * redaction-before-write guarantee is unit-testable without spawning a shell.
 * Dependencies are injected so tests can use a fake store and fake gates.
 */
import { BackscrollConfig, CommandInput, OutputBlock } from '../types';
import { redact } from '../redaction/redact';
import { isPaused as defaultIsPaused, shouldRecord as defaultShouldRecord } from './recording-gate';

export interface PersistDeps {
  /** Insert a finished command record; returns its id. */
  insertCommand: (input: CommandInput) => number;
  /** Override the pause check (defaults to the real marker check). */
  isPaused?: () => boolean;
  /** Override the exclude check (defaults to the real config-based gate). */
  shouldRecord?: (command: string, cwd: string | null, config: BackscrollConfig) => boolean;
}

/**
 * Apply the privacy gate and redaction to an output block, then persist it.
 * Returns the new command id, or null when the block was dropped (paused or
 * excluded). Redaction always runs before insertCommand is called.
 */
export function persistBlock(
  block: OutputBlock,
  config: BackscrollConfig,
  deps: PersistDeps,
  sessionId: number | null
): number | null {
  const paused = (deps.isPaused ?? defaultIsPaused)();
  if (paused) return null;

  const gate = deps.shouldRecord ?? defaultShouldRecord;
  if (!gate(block.command, block.cwd, config)) return null;

  const input: CommandInput = {
    sessionId,
    command: redact(block.command, config),
    cwd: block.cwd,
    gitBranch: block.gitBranch,
    exitCode: block.exitCode,
    startedAt: block.startedAt,
    durationMs: block.durationMs,
    source: block.source,
    output: redact(block.output, config),
  };

  return deps.insertCommand(input);
}
