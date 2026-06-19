/**
 * Config loading and defaults. [TASK-006]
 *
 * A missing, empty, or malformed config file must never crash recording — we
 * warn and fall back to defaults.
 */
import fs from 'fs';
import { BackscrollConfig } from './types';
import { configPath, ensureDataDir } from './paths';

export const DEFAULT_CONFIG: BackscrollConfig = {
  redactionEnabled: true,
  redactionExtraPatterns: [],
  excludeCommands: [],
  excludeDirs: [],
  maxOutputBytes: 1_000_000, // 1 MB per command
};

/** Merge a partial config over the defaults. */
export function mergeConfig(partial: Partial<BackscrollConfig>): BackscrollConfig {
  return {
    redactionEnabled: partial.redactionEnabled ?? DEFAULT_CONFIG.redactionEnabled,
    redactionExtraPatterns: partial.redactionExtraPatterns ?? [],
    excludeCommands: partial.excludeCommands ?? [],
    excludeDirs: partial.excludeDirs ?? [],
    maxOutputBytes: partial.maxOutputBytes ?? DEFAULT_CONFIG.maxOutputBytes,
  };
}

/** Load config from disk (or a given path), tolerating missing/bad files. */
export function loadConfig(file: string = configPath()): BackscrollConfig {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BackscrollConfig>;
    return mergeConfig(parsed);
  } catch (err) {
    process.stderr.write(
      `bsc: could not read config (${(err as Error).message}); using defaults\n`
    );
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Persist `config` as pretty JSON to disk. Ensures the (owner-only) data dir
 * exists first, then writes the config file with 0600 permissions so captured
 * settings stay private. Touches a JSON file only — never spawns a process.
 */
export function saveConfig(config: BackscrollConfig, file: string = configPath()): void {
  ensureDataDir();
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
