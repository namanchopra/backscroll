/**
 * Interactive fuzzy picker. [TASK-024]
 *
 * Raw-mode keypress loop over a result set: type to narrow, ↑/↓ to move, an
 * output preview pane for the highlighted row, ⏎ copies the command to the
 * clipboard, esc/Ctrl-C/Ctrl-D quits. Terminal state is always restored on
 * exit, including on stdin EOF/error.
 */
import pc from 'picocolors';
import { SearchResult } from '../types';
import { Store } from '../db/store';
import { copyToClipboard } from './clipboard';
import { humanizeRelative } from '../util/time';

export interface PickerOptions {
  query: string;
  now: number;
}

const KEY = {
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_N: '\x0e',
  CTRL_P: '\x10',
  ESC: '\x1b',
  ENTER_CR: '\r',
  ENTER_LF: '\n',
  BACKSPACE: '\x7f',
  BACKSPACE_ALT: '\b',
  UP: '\x1b[A',
  UP_ALT: '\x1bOA',
  DOWN: '\x1b[B',
  DOWN_ALT: '\x1bOB',
};

function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function runPicker(
  results: SearchResult[],
  store: Store,
  opts: PickerOptions
): Promise<number> {
  return new Promise<number>((resolve) => {
    const stdin = process.stdin;
    const out = process.stdout;

    if (!stdin.isTTY) {
      resolve(0);
      return;
    }

    let filter = '';
    let selected = 0;
    let view = results;
    // Cache the (first few lines of) preview per command id so navigation
    // doesn't re-query the full output blob on every keystroke.
    const previewCache = new Map<number, string>();

    const recompute = (): void => {
      const f = filter.toLowerCase();
      view = f ? results.filter((r) => r.command.toLowerCase().includes(f)) : results;
      if (selected >= view.length) selected = Math.max(0, view.length - 1);
      if (selected < 0) selected = 0;
    };

    const previewFor = (id: number): string => {
      const cached = previewCache.get(id);
      if (cached !== undefined) return cached;
      const rec = store.getCommandById(id);
      const text =
        rec && rec.output ? rec.output.split('\n').slice(0, 3).join('\n') : '';
      previewCache.set(id, text);
      return text;
    };

    const render = (): void => {
      const rows = out.rows || 24;
      const cols = out.columns || 80;
      const listHeight = Math.max(3, rows - 8);
      let buf = '\x1b[2J\x1b[H';
      buf += `${pc.bold('bsc search')}  ${pc.dim(`${view.length}/${results.length}`)}\n`;
      buf += `${pc.cyan('› ')}${filter}\n`;
      buf += `${pc.dim('─'.repeat(Math.min(cols, 70)))}\n`;

      const start = Math.max(
        0,
        Math.min(selected - Math.floor(listHeight / 2), Math.max(0, view.length - listHeight))
      );
      const shown = view.slice(start, start + listHeight);
      shown.forEach((r, i) => {
        const idx = start + i;
        const active = idx === selected;
        const glyph =
          r.exitCode === null ? pc.dim('?') : r.exitCode === 0 ? pc.green('✓') : pc.red('✗');
        const when = pc.dim(humanizeRelative(r.startedAt, opts.now).padStart(7));
        const cmd = truncate(r.command.replace(/\s+/g, ' '), cols - 16);
        const body = `${glyph} ${when}  ${active ? pc.bold(cmd) : cmd}`;
        buf += `${active ? pc.cyan('❯ ') : '  '}${body}\n`;
      });

      buf += `${pc.dim('─'.repeat(Math.min(cols, 70)))}\n`;
      const sel = view[selected];
      if (sel) {
        const text = previewFor(sel.id);
        const previewLines = (text || pc.dim('(no output captured)'))
          .split('\n')
          .slice(0, 3)
          .map((l) => truncate(l, cols - 2));
        buf += `${pc.dim(previewLines.join('\n'))}\n`;
      }
      buf += `${pc.dim('↑↓ move · type to filter · ⏎ copy · esc quit')}\n`;
      out.write(buf);
    };

    const finish = (sel: SearchResult | null): void => {
      try {
        stdin.setRawMode(false);
      } catch {
        /* terminal gone */
      }
      stdin.pause();
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onEnd);
      out.write('\x1b[2J\x1b[H');

      if (sel) {
        const res = copyToClipboard(sel.command);
        if (res.ok) {
          out.write(`${pc.green('✓ copied to clipboard:')} ${sel.command}\n`);
        } else {
          out.write(`${sel.command}\n`);
          out.write(pc.yellow(`(clipboard unavailable: ${res.error})\n`));
        }
      } else {
        out.write(pc.dim('cancelled\n'));
      }
      resolve(0);
    };

    const onEnd = (): void => finish(null);

    const onData = (data: Buffer): void => {
      const s = data.toString('utf8');
      // Quit keys may arrive anywhere in a coalesced chunk.
      if (s === KEY.ESC || s.includes(KEY.CTRL_C) || s.includes(KEY.CTRL_D)) {
        finish(null);
        return;
      }
      // Scan the chunk: a single read can contain multiple keys (held arrows,
      // paste). Recognize escape sequences, append only printable chars.
      let changed = false;
      let i = 0;
      while (i < s.length) {
        if (s.startsWith(KEY.UP, i) || s.startsWith(KEY.UP_ALT, i)) {
          selected = Math.max(0, selected - 1);
          i += 3;
          continue;
        }
        if (s.startsWith(KEY.DOWN, i) || s.startsWith(KEY.DOWN_ALT, i)) {
          selected = Math.min(view.length - 1, selected + 1);
          i += 3;
          continue;
        }
        const ch = s[i] as string;
        if (ch === KEY.CTRL_P) {
          selected = Math.max(0, selected - 1);
          i += 1;
          continue;
        }
        if (ch === KEY.CTRL_N) {
          selected = Math.min(view.length - 1, selected + 1);
          i += 1;
          continue;
        }
        if (ch === KEY.ENTER_CR || ch === KEY.ENTER_LF) {
          finish(view[selected] ?? null);
          return;
        }
        if (ch === KEY.BACKSPACE || ch === KEY.BACKSPACE_ALT) {
          filter = filter.slice(0, -1);
          changed = true;
          i += 1;
          continue;
        }
        if (ch === KEY.ESC) {
          // Skip an unrecognized escape sequence rather than dumping its raw
          // bytes into the filter.
          i += 1;
          const next = s[i];
          if (next === '[' || next === 'O') {
            i += 1;
            while (i < s.length) {
              const c = s[i] as string;
              i += 1;
              if (/[A-Za-z~]/.test(c)) break;
            }
          }
          continue;
        }
        if (ch >= ' ') {
          filter += ch;
          changed = true;
          i += 1;
          continue;
        }
        i += 1; // ignore other control bytes
      }
      if (selected < 0) selected = 0;
      if (changed) recompute();
      render();
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('error', onEnd);
    render();
  });
}
