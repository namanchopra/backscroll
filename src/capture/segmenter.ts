/**
 * Output segmenter. [TASK-012]
 *
 * Consumes the OSC 133 token stream and emits one OutputBlock per command
 * (the bytes between a `C` marker and its `D`). Enforces a per-command output
 * cap to bound memory against runaway commands, and degrades to a single
 * "unsegmented" block if no markers ever arrive (heuristic fallback).
 */
import { Osc133Parser, Osc133Token } from './osc133';
import { stripAnsi } from './ansi';
import { OutputBlock } from '../types';

interface Accumulator {
  parts: string[];
  bytes: number;
  truncated: boolean;
}

interface OpenBlock extends Accumulator {
  command: string;
  cwd: string | null;
  branch: string | null;
  startedAt: number;
}

export interface SegmenterOptions {
  maxOutputBytes: number;
  /** injectable clock for deterministic tests */
  now?: () => number;
}

function emptyAccumulator(): Accumulator {
  return { parts: [], bytes: 0, truncated: false };
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Slice `text` to at most `maxBytes` UTF-8 bytes, on a codepoint boundary. */
function sliceToBytes(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text;
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const cb = utf8Bytes(ch);
    if (bytes + cb > maxBytes) break;
    out += ch;
    bytes += cb;
  }
  return out;
}

function lastWhitespaceIndex(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') return i;
  }
  return -1;
}

export class Segmenter {
  private parser = new Osc133Parser();
  private open: OpenBlock | null = null;
  private sawMarker = false;
  private fallback: Accumulator = emptyAccumulator();
  private readonly max: number;
  private readonly now: () => number;

  constructor(opts: SegmenterOptions) {
    this.max = opts.maxOutputBytes;
    this.now = opts.now ?? ((): number => Date.now());
  }

  /** Feed a raw PTY chunk; returns any blocks completed by it. */
  feed(data: string): OutputBlock[] {
    return this.consume(this.parser.feed(data));
  }

  /** Finalize the stream; returns any trailing/fallback block. */
  end(): OutputBlock[] {
    const blocks = this.consume(this.parser.flush());
    if (this.open) {
      blocks.push(this.finalizeOpen(null, null));
    } else if (!this.sawMarker && this.fallback.bytes > 0) {
      blocks.push(this.finalizeFallback());
    }
    return blocks;
  }

  private consume(tokens: Osc133Token[]): OutputBlock[] {
    const blocks: OutputBlock[] = [];
    for (const t of tokens) {
      if (t.type === 'marker') {
        this.sawMarker = true;
        this.fallback = emptyAccumulator(); // markers work — drop fallback buffer
        if (t.kind === 'C') {
          if (this.open) blocks.push(this.finalizeOpen(null, null));
          this.open = {
            command: t.command ?? '',
            cwd: t.cwd ?? null,
            branch: t.branch ?? null,
            startedAt: this.now(),
            ...emptyAccumulator(),
          };
        } else if (t.kind === 'D') {
          if (this.open) {
            blocks.push(this.finalizeOpen(t.exitCode ?? null, t.durationMs ?? null));
          }
        } else if (t.kind === 'A') {
          // New prompt; close any command that never sent a D (e.g. Ctrl-C).
          if (this.open) blocks.push(this.finalizeOpen(null, null));
        }
        // 'B' (command start boundary) is ignored — we segment on C..D.
      } else {
        if (this.open) {
          this.appendCapped(this.open, t.text);
        } else if (!this.sawMarker) {
          this.appendCapped(this.fallback, t.text);
        }
        // else: output between commands (prompt redraw / echo) is discarded.
      }
    }
    return blocks;
  }

  private appendCapped(target: Accumulator, text: string): void {
    if (target.truncated) return;
    const len = utf8Bytes(text);
    if (target.bytes + len <= this.max) {
      target.parts.push(text);
      target.bytes += len;
      return;
    }
    const remaining = this.max - target.bytes;
    if (remaining > 0) {
      // Cap by UTF-8 byte budget (not UTF-16 code units), then trim back to the
      // last nearby whitespace so we don't persist a half-captured token (a
      // possible secret) straddling the cap before redaction runs.
      let slice = sliceToBytes(text, remaining);
      const wsIdx = lastWhitespaceIndex(slice);
      if (wsIdx >= 0 && slice.length - wsIdx <= 200) {
        slice = slice.slice(0, wsIdx + 1);
      }
      if (slice) {
        target.parts.push(slice);
        target.bytes += utf8Bytes(slice);
      }
    }
    target.truncated = true;
  }

  private renderOutput(acc: Accumulator): string {
    let output = stripAnsi(acc.parts.join(''));
    if (acc.truncated) {
      output += `\n…[truncated, output exceeded ${this.max} bytes]`;
    }
    return output;
  }

  private finalizeOpen(exitCode: number | null, durationMs: number | null): OutputBlock {
    const b = this.open as OpenBlock;
    this.open = null;
    return {
      command: b.command,
      cwd: b.cwd,
      gitBranch: b.branch,
      exitCode,
      startedAt: b.startedAt,
      durationMs: durationMs ?? this.now() - b.startedAt,
      output: this.renderOutput(b),
      truncated: b.truncated,
      source: 'pty',
    };
  }

  private finalizeFallback(): OutputBlock {
    const acc = this.fallback;
    this.fallback = emptyAccumulator();
    return {
      command: '(unsegmented session output)',
      cwd: null,
      gitBranch: null,
      exitCode: null,
      startedAt: this.now(),
      durationMs: null,
      output: this.renderOutput(acc),
      truncated: acc.truncated,
      source: 'pty',
    };
  }
}
