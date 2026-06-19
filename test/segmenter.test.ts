/**
 * Tests for the output segmenter. [TASK-030]
 *
 * Verifies that the segmenter emits one OutputBlock per C..D command, enforces
 * the per-command output cap (marking blocks truncated), and degrades to a
 * single "unsegmented" fallback block when no markers ever arrive.
 */
import { Segmenter } from '../src/capture/segmenter';
import { OutputBlock } from '../src/types';

const ESC = '\x1b';
const BEL = '\x07';

/** Encode a string as base64, matching the shell-integration wire format. */
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Build a C (command-start) marker. */
const cMarker = (cmd: string, cwd = '/tmp', branch = 'main'): string =>
  `${ESC}]133;C;cmd=${b64(cmd)};cwd=${b64(cwd)};branch=${b64(branch)}${BEL}`;

/** Build a D (command-end) marker. */
const dMarker = (exit: number, durMs = 5): string =>
  `${ESC}]133;D;${exit};dur=${durMs}${BEL}`;

describe('Segmenter', () => {
  it('emits one OutputBlock per C..D command', () => {
    const s = new Segmenter({ maxOutputBytes: 1_000_000, now: () => 1000 });

    const blocks: OutputBlock[] = [];
    blocks.push(...s.feed(`${cMarker('echo hi')}hi\n${dMarker(0)}`));
    blocks.push(...s.feed(`${cMarker('false')}oops\n${dMarker(1)}`));
    blocks.push(...s.end());

    expect(blocks).toHaveLength(2);

    const first = blocks[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected first block');
    expect(first.command).toBe('echo hi');
    expect(first.output).toContain('hi');
    expect(first.exitCode).toBe(0);

    const second = blocks[1];
    expect(second).toBeDefined();
    if (!second) throw new Error('expected second block');
    expect(second.command).toBe('false');
    expect(second.exitCode).toBe(1);
  });

  it('caps oversized command output and marks the block truncated', () => {
    const s = new Segmenter({ maxOutputBytes: 10, now: () => 1 });

    const blocks: OutputBlock[] = [];
    blocks.push(...s.feed(cMarker('cat big')));
    blocks.push(...s.feed('x'.repeat(100)));
    blocks.push(...s.feed(dMarker(0)));
    blocks.push(...s.end());

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block).toBeDefined();
    if (!block) throw new Error('expected one block');

    expect(block.truncated).toBe(true);
    expect(block.output).toContain('truncated');
  });

  it('falls back to a single unsegmented block when no markers arrive', () => {
    const s = new Segmenter({ maxOutputBytes: 1_000_000, now: () => 1000 });

    const blocks: OutputBlock[] = [];
    expect(() => {
      blocks.push(...s.feed('some output with no markers\n'));
      blocks.push(...s.end());
    }).not.toThrow();

    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const block = blocks[0];
    expect(block).toBeDefined();
    if (!block) throw new Error('expected fallback block');

    // The fallback label identifies the unsegmented session output.
    expect(block.command).toContain('unsegmented');
    expect(block.output).toContain('some output with no markers');
  });
});
