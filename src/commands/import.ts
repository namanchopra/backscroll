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

/** Counts returned by a history import pass. */
export interface ImportResult {
  imported: number;
  skipped: number;
  excluded: number;
  filesRead: number;
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

/**
 * Core history import: parse → redact → gate → insert → dedup. Returns the
 * tallied counts and performs NO printing, so both the CLI command and the web
 * API handler can reuse it. Files that don't exist are silently skipped (they
 * just don't bump `filesRead`); never spawns a process.
 */
export function importHistory(opts: ImportOptions): ImportResult {
  const config = loadConfig();
  const store = new Store(getDb());
  const existing = store.existingHistoryKeys();

  let imported = 0;
  let skipped = 0;
  let excluded = 0;
  let filesRead = 0;

  for (const hf of resolveFiles(opts)) {
    if (!fs.existsSync(hf.path)) continue;
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

  return { imported, skipped, excluded, filesRead };
}

export function importCommand(opts: ImportOptions): number {
  // Note the files we *would* read, so we can warn about missing ones the same
  // way the original CLI did — importHistory itself stays print-free.
  for (const hf of resolveFiles(opts)) {
    if (!fs.existsSync(hf.path)) process.stderr.write(pc.dim(`  (no ${hf.path})\n`));
  }

  const result = importHistory(opts);

  if (result.filesRead === 0) {
    process.stderr.write(pc.yellow('bsc: no history files found to import.\n'));
    return 1;
  }

  const parts = [`${pc.green('✓')} imported ${result.imported} commands`];
  if (result.skipped) parts.push(`${result.skipped} already present`);
  if (result.excluded) parts.push(`${result.excluded} excluded`);
  process.stdout.write(`${parts.join(', ')}\n`);
  return 0;
}
