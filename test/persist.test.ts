/**
 * Tests for the persist pipeline. [TASK-033]
 *
 * The critical guarantee under test is redaction-before-write: persistBlock must
 * redact BOTH command and output before the row ever reaches insertCommand, so
 * raw secrets can never land in storage. We also verify the two drop gates
 * (paused / excluded) short-circuit before any insert, and that disabling
 * redaction passes the text through unmasked.
 *
 * Dependencies are injected (insertCommand + gate overrides) so nothing here
 * touches the real filesystem pause marker or the SQLite store.
 */
import { persistBlock, PersistDeps } from '../src/capture/persist';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config';
import { CommandInput, OutputBlock } from '../src/types';

const RAW_GH_SECRET = 'ghp_0123456789abcdefghijABCDEFGHIJ012345';
const RAW_AWS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';

/** Build a valid OutputBlock carrying secrets in both command and output. */
const block = (over: Partial<OutputBlock> = {}): OutputBlock => ({
  command: `export TOKEN=${RAW_GH_SECRET}`,
  cwd: '/home/me/work',
  gitBranch: null,
  exitCode: 0,
  startedAt: 1000,
  durationMs: 5,
  output: `logging in with AWS_SECRET_ACCESS_KEY=${RAW_AWS_SECRET} done`,
  truncated: false,
  source: 'pty',
  ...over,
});

/** A capturing fake store: records every insert and returns a fixed id. */
function capturingDeps(
  id: number,
  over: Partial<PersistDeps> = {}
): { deps: PersistDeps; calls: CommandInput[] } {
  const calls: CommandInput[] = [];
  const deps: PersistDeps = {
    insertCommand: (input: CommandInput): number => {
      calls.push(input);
      return id;
    },
    isPaused: () => false,
    shouldRecord: () => true,
    ...over,
  };
  return { deps, calls };
}

describe('persistBlock', () => {
  it('redacts both command and output before writing (privacy guarantee)', () => {
    const { deps, calls } = capturingDeps(42);

    const result = persistBlock(block(), DEFAULT_CONFIG, deps, 7);

    // Returns the store-assigned id and inserts exactly once.
    expect(result).toBe(42);
    expect(calls).toHaveLength(1);

    const written = calls[0]!;

    // Command and output are redacted...
    expect(written.command).toContain('«redacted:');
    expect(written.output).not.toBeNull();
    expect(written.output).toContain('«redacted:');

    // ...and the raw secrets never reach the store.
    expect(written.command).not.toContain(RAW_GH_SECRET);
    expect(written.command).not.toContain('ghp_');
    expect(written.output).not.toContain(RAW_AWS_SECRET);
    expect(written.output).not.toContain('wJalr');

    // Metadata passes through verbatim.
    expect(written.sessionId).toBe(7);
    expect(written.source).toBe('pty');
  });

  it('drops the block (returns null, no insert) when paused', () => {
    const { deps, calls } = capturingDeps(42, {
      isPaused: () => true,
      shouldRecord: () => true,
    });

    const result = persistBlock(block(), DEFAULT_CONFIG, deps, null);

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('drops the block (returns null, no insert) when excluded by the gate', () => {
    const { deps, calls } = capturingDeps(42, {
      isPaused: () => false,
      shouldRecord: () => false,
    });

    const result = persistBlock(block(), DEFAULT_CONFIG, deps, null);

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('inserts unmasked text when redaction is disabled (edge case)', () => {
    const { deps, calls } = capturingDeps(99);
    const config = mergeConfig({ redactionEnabled: false });

    const result = persistBlock(block(), config, deps, 3);

    expect(result).toBe(99);
    expect(calls).toHaveLength(1);

    const written = calls[0]!;
    // Redaction off => command/output stored verbatim, secrets intact.
    expect(written.command).toBe(`export TOKEN=${RAW_GH_SECRET}`);
    expect(written.output).toBe(`logging in with AWS_SECRET_ACCESS_KEY=${RAW_AWS_SECRET} done`);
    expect(written.command).not.toContain('«redacted:');
  });
});
