/**
 * `bsc import` — backfill existing shell history. [feature: history import]
 *
 * Imports ~/.zsh_history and/or ~/.bash_history as metadata-only commands
 * (source='history', no output — it's already gone). Commands are redacted and
 * run through the exclude gate before storage, and import is idempotent.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import pc from 'picocolors';
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { loadConfig } from '../config';
import { redact } from '../redaction/redact';
import { shouldRecord } from '../capture/recording-gate';
import { parseZshHistory, parseBashHistory, HistoryEntry } from '../history/parse';

export interface ImportOptions {
  zsh?: boolean;
  bash?: boolean;
  file?: string;
}

interface HistFile {
  kind: 'zsh' | 'bash';
  path: string;
}

function fileMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return Date.now();
  }
}

function resolveFiles(opts: ImportOptions): HistFile[] {
  if (opts.file) {
    return [{ kind: opts.file.includes('bash') ? 'bash' : 'zsh', path: opts.file }];
  }
  // Default: import whichever was requested, or both if neither flag is set.
  const both = !opts.zsh && !opts.bash;
  const files: HistFile[] = [];
  if (opts.zsh || both) files.push({ kind: 'zsh', path: path.join(os.homedir(), '.zsh_history') });
  if (opts.bash || both) files.push({ kind: 'bash', path: path.join(os.homedir(), '.bash_history') });
  return files;
}

export function importCommand(opts: ImportOptions): number {
  const config = loadConfig();
  const store = new Store(getDb());
  const existing = store.existingHistoryKeys();

  let imported = 0;
  let skipped = 0;
  let excluded = 0;
  let filesRead = 0;

  for (const hf of resolveFiles(opts)) {
    if (!fs.existsSync(hf.path)) {
      process.stderr.write(pc.dim(`  (no ${hf.path})\n`));
      continue;
    }
    filesRead += 1;
    const content = fs.readFileSync(hf.path, 'utf8');
    const mtime = fileMtime(hf.path);
    const entries: HistoryEntry[] =
      hf.kind === 'zsh' ? parseZshHistory(content, mtime) : parseBashHistory(content, mtime);

    for (const entry of entries) {
      const raw = entry.command.trim();
      if (!raw) continue;
      if (!shouldRecord(raw, null, config)) {
        excluded += 1;
        continue;
      }
      const command = redact(raw, config);
      const key = `${entry.startedAt} ${command}`;
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      store.insertCommand({
        sessionId: null,
        command,
        cwd: null,
        gitBranch: null,
        exitCode: null,
        startedAt: entry.startedAt,
        durationMs: null,
        source: 'history',
        output: null,
      });
      existing.add(key);
      imported += 1;
    }
  }

  if (filesRead === 0) {
    process.stderr.write(pc.yellow('bsc: no history files found to import.\n'));
    return 1;
  }

  const parts = [`${pc.green('✓')} imported ${imported} commands`];
  if (skipped) parts.push(`${skipped} already present`);
  if (excluded) parts.push(`${excluded} excluded`);
  process.stdout.write(`${parts.join(', ')}\n`);
  return 0;
}
