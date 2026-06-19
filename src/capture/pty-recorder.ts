/**
 * PTY recorder — terminal mechanics. [TASK-015]
 *
 * Spawns the user's shell under a PTY with a temp ZDOTDIR that sources their
 * config plus our integration, transparently bridges stdio, tees output into
 * the segmenter, and hands each completed block to the persist pipeline. This
 * module owns terminal mechanics only — the storage/privacy decision lives in
 * persist.ts.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import * as pty from 'node-pty';
import { Segmenter } from './segmenter';
import { persistBlock } from './persist';
import { BackscrollConfig, CommandInput, OutputBlock } from '../types';
import { zshSnippet } from '../shell/integration';

export interface RecorderDeps {
  insertCommand: (input: CommandInput) => number;
  config: BackscrollConfig;
  sessionId: number | null;
}

/** Run the recording shell to completion; resolves with its exit code. */
export function runRecorder(deps: RecorderDeps): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let tmpDir: string | undefined;
    try {
      const shell = process.env.SHELL || 'zsh';
      const origZdotdir = process.env.ZDOTDIR || os.homedir();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-rec-'));
      const rc = [
        'export BACKSCROLL_REC=1',
        `if [ -f "${origZdotdir}/.zshrc" ]; then source "${origZdotdir}/.zshrc"; fi`,
        // Suppress zsh's "%" partial-line marker so it doesn't pollute output.
        'unsetopt PROMPT_SP 2>/dev/null',
        zshSnippet({ forRec: true }),
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmpDir, '.zshrc'), rc, { mode: 0o600 });

      const child = pty.spawn(shell, [], {
        name: process.env.TERM || 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        cwd: process.cwd(),
        env: { ...process.env, ZDOTDIR: tmpDir, BACKSCROLL_REC: '1' },
      });

      const recTmpDir = tmpDir;
      const segmenter = new Segmenter({ maxOutputBytes: deps.config.maxOutputBytes });

      const persist = (blocks: OutputBlock[]): void => {
        for (const b of blocks) {
          try {
            persistBlock(b, deps.config, { insertCommand: deps.insertCommand }, deps.sessionId);
          } catch {
            /* a write error must never crash the user's shell */
          }
        }
      };

      child.onData((data: string) => {
        process.stdout.write(data); // transparent passthrough
        persist(segmenter.feed(data)); // capture
      });

      const stdin = process.stdin;
      const wasRaw = Boolean(stdin.isRaw);
      // Decode incrementally so a multibyte keystroke/paste split across two
      // 'data' events isn't corrupted into U+FFFD before reaching the shell.
      const decoder = new StringDecoder('utf8');
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const onStdin = (d: Buffer): void => {
        child.write(decoder.write(d));
      };
      stdin.on('data', onStdin);

      const onResize = (): void => {
        child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
      };
      process.stdout.on('resize', onResize);

      // Forward fatal signals to the child (its onExit drives cleanup), and
      // restore the terminal on any hard process exit as a last resort.
      const onSignal = (): void => {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
      };
      const onProcExit = (): void => {
        try {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
        } catch {
          /* terminal gone */
        }
      };
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
      process.once('SIGHUP', onSignal);
      process.once('exit', onProcExit);

      let done = false;
      const cleanup = (): void => {
        if (done) return;
        done = true;
        try {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
        } catch {
          /* terminal already gone */
        }
        stdin.pause();
        stdin.removeListener('data', onStdin);
        process.stdout.removeListener('resize', onResize);
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        process.removeListener('SIGHUP', onSignal);
        process.removeListener('exit', onProcExit);
        try {
          fs.rmSync(recTmpDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      };

      child.onExit(({ exitCode }: { exitCode: number }) => {
        persist(segmenter.end());
        cleanup();
        resolve(exitCode);
      });
    } catch (err) {
      // Synchronous setup failed (e.g. spawn-helper not executable). Clean up
      // the temp dir and reject so the caller can still close the session row.
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
