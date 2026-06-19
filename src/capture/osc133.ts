/**
 * OSC 133 marker tokenizer. [TASK-011]
 *
 * Our injected shell integration emits these sequences around each command:
 *
 *   ESC ] 133 ; A                                ST   → prompt start
 *   ESC ] 133 ; C ; cmd=<b64> ; cwd=<b64> ; branch=<b64> ST → command start
 *   ESC ] 133 ; D ; <exit> ; dur=<ms>           ST   → command end
 *
 * (ST = BEL `\x07` or `ESC \`.) The tokenizer splits a raw PTY byte stream
 * into ordered tokens: plain output text vs. 133 marker events. Anything that
 * is not a 133 sequence — including other ANSI/OSC escapes — is passed through
 * as output text (the segmenter strips ANSI later).
 *
 * It is fed arbitrary chunks and correctly handles a marker split across two
 * `feed()` calls by retaining the incomplete tail in an internal buffer.
 */

const ESC = '\x1b';
const BEL = '\x07';
const OSC_PREFIX = `${ESC}]133;`;

export type Osc133Kind = 'A' | 'B' | 'C' | 'D';

export interface OutputToken {
  type: 'output';
  text: string;
}

export interface MarkerToken {
  type: 'marker';
  kind: Osc133Kind;
  command?: string;
  cwd?: string;
  branch?: string;
  exitCode?: number | null;
  durationMs?: number | null;
}

export type Osc133Token = OutputToken | MarkerToken;

function decodeB64(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

function parseMarkerBody(body: string): MarkerToken {
  const parts = body.split(';');
  const kind = (parts[0] || '').toUpperCase() as Osc133Kind;
  const token: MarkerToken = { type: 'marker', kind };

  if (kind === 'C') {
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      const key = p.slice(0, eq);
      const val = p.slice(eq + 1);
      if (key === 'cmd') token.command = decodeB64(val);
      else if (key === 'cwd') token.cwd = decodeB64(val);
      else if (key === 'branch') token.branch = decodeB64(val);
    }
  } else if (kind === 'D') {
    const exitRaw = parts[1];
    if (exitRaw !== undefined && exitRaw !== '' && /^-?\d+$/.test(exitRaw)) {
      token.exitCode = parseInt(exitRaw, 10);
    } else {
      token.exitCode = null;
    }
    for (const p of parts.slice(2)) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      if (p.slice(0, eq) === 'dur') {
        const ms = parseInt(p.slice(eq + 1), 10);
        token.durationMs = Number.isNaN(ms) ? null : ms;
      }
    }
  }

  return token;
}

export class Osc133Parser {
  private buf = '';

  /** Feed a raw chunk; returns ordered tokens. Incomplete tails are retained. */
  feed(data: string): Osc133Token[] {
    this.buf += data;
    const tokens: Osc133Token[] = [];
    let out = '';
    let i = 0;
    const n = this.buf.length;

    const flushOut = (): void => {
      if (out) {
        tokens.push({ type: 'output', text: out });
        out = '';
      }
    };

    while (i < n) {
      const ch = this.buf[i] as string;
      if (ch !== ESC) {
        out += ch;
        i++;
        continue;
      }

      const tail = this.buf.slice(i);
      if (tail.startsWith(OSC_PREFIX)) {
        const term = this.findTerminator(i + OSC_PREFIX.length);
        if (term === null) {
          // Incomplete marker — retain from i and wait for more data.
          break;
        }
        flushOut();
        const body = this.buf.slice(i + OSC_PREFIX.length, term.index);
        tokens.push(parseMarkerBody(body));
        i = term.index + term.length;
        continue;
      }

      if (OSC_PREFIX.startsWith(tail)) {
        // Could become a 133 marker once more bytes arrive — retain.
        break;
      }

      // Some other escape sequence: emit ESC as output and keep scanning (the
      // following bytes are ordinary output / other ANSI, stripped later).
      out += ch;
      i++;
    }

    flushOut();
    this.buf = this.buf.slice(i);
    return tokens;
  }

  /** Anything left buffered at end of stream, as output (best effort). */
  flush(): Osc133Token[] {
    const tokens: Osc133Token[] = [];
    if (this.buf) {
      tokens.push({ type: 'output', text: this.buf });
      this.buf = '';
    }
    return tokens;
  }

  /** Find ST (`\x07` or `ESC \`) at/after `from`; null if not yet present. */
  private findTerminator(from: number): { index: number; length: number } | null {
    for (let j = from; j < this.buf.length; j++) {
      const c = this.buf[j];
      if (c === BEL) return { index: j, length: 1 };
      if (c === ESC) {
        if (j + 1 >= this.buf.length) return null; // incomplete ESC \
        if (this.buf[j + 1] === '\\') return { index: j, length: 2 };
      }
    }
    return null;
  }
}
