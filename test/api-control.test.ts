/**
 * Control-endpoint handler tests. [web-UI control surface]
 *
 * Drives the new transport-neutral control handlers in src/server/api.ts
 * (status, pause, import, config) directly against an in-memory Store and a
 * temp BACKSCROLL_DIR. These verify the marker-file / JSON-file side effects and
 * the input validation, and assert that neither api.ts nor server.ts imports
 * child_process — the hard invariant that none of these endpoints spawn a shell.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { openDatabase, closeDb, DB } from '../src/db/database';
import { Store } from '../src/db/store';
import {
  handleStatus,
  handlePause,
  handleGetConfig,
  handleSetConfig,
  ApiReply,
} from '../src/server/api';
import { ApiStatus, ApiConfig } from '../src/server/contract';
import { dataDir, dbPath } from '../src/paths';
import { bscVersion } from '../src/version';
import { importHistory } from '../src/commands/import';

function bodyOf<T>(reply: ApiReply): T {
  return reply.json as T;
}

describe('API control handlers', () => {
  let dir: string;
  let db: DB;
  let store: Store;
  const savedEnv = process.env.BACKSCROLL_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-control-'));
    process.env.BACKSCROLL_DIR = dir;
    db = openDatabase(':memory:');
    store = new Store(db);
  });

  afterEach(() => {
    db.close();
    // The history-import path uses the singleton DB; close it so each test starts clean.
    closeDb();
    if (savedEnv === undefined) delete process.env.BACKSCROLL_DIR;
    else process.env.BACKSCROLL_DIR = savedEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('handleStatus reports paused/dataDir/dbPath/version/total', () => {
    store.insertCommand({
      sessionId: null,
      command: 'git status',
      cwd: '/home/a',
      gitBranch: null,
      exitCode: 0,
      startedAt: 1000,
      durationMs: 1,
      source: 'pty',
      output: null,
    });

    const reply = handleStatus(store);
    expect(reply.status).toBe(200);

    const status = bodyOf<ApiStatus>(reply);
    expect(status.paused).toBe(false);
    expect(status.dataDir).toBe(dataDir());
    expect(status.dataDir).toBe(dir);
    expect(status.dbPath).toBe(dbPath());
    expect(status.version).toBe(bscVersion());
    expect(status.total).toBe(1);
  });

  it('handlePause(true) then status shows paused true; handlePause(false) flips it back', () => {
    expect(bodyOf<ApiStatus>(handleStatus(store)).paused).toBe(false);

    const on = handlePause({ paused: true });
    expect(on.status).toBe(200);
    expect(bodyOf<{ paused: boolean }>(on).paused).toBe(true);
    expect(bodyOf<ApiStatus>(handleStatus(store)).paused).toBe(true);

    const off = handlePause({ paused: false });
    expect(off.status).toBe(200);
    expect(bodyOf<{ paused: boolean }>(off).paused).toBe(false);
    expect(bodyOf<ApiStatus>(handleStatus(store)).paused).toBe(false);
  });

  it('handlePause rejects a non-boolean body with 400', () => {
    expect(handlePause({ paused: 'yes' }).status).toBe(400);
    expect(handlePause({}).status).toBe(400);
    expect(handlePause(null).status).toBe(400);
    expect(handlePause(5).status).toBe(400);
  });

  it('handleSetConfig persists valid values; handleGetConfig returns them', () => {
    const reply = handleSetConfig({
      redactionEnabled: false,
      redactionExtraPatterns: ['foo', 'bar'],
      excludeCommands: ['secret'],
      excludeDirs: ['/private'],
      maxOutputBytes: 50_000,
    });
    expect(reply.status).toBe(200);

    const saved = bodyOf<ApiConfig>(reply);
    expect(saved.redactionEnabled).toBe(false);
    expect(saved.redactionExtraPatterns).toEqual(['foo', 'bar']);
    expect(saved.excludeCommands).toEqual(['secret']);
    expect(saved.excludeDirs).toEqual(['/private']);
    expect(saved.maxOutputBytes).toBe(50_000);

    // The value must round-trip through disk via handleGetConfig().
    const got = bodyOf<ApiConfig>(handleGetConfig());
    expect(got).toEqual(saved);

    // And it must actually be on disk in the temp data dir.
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(true);
  });

  it('handleSetConfig clamps maxOutputBytes into the sane [1024, 100_000_000] range', () => {
    const low = bodyOf<ApiConfig>(handleSetConfig({ maxOutputBytes: 1 }));
    expect(low.maxOutputBytes).toBe(1024);

    const high = bodyOf<ApiConfig>(handleSetConfig({ maxOutputBytes: 999_999_999 }));
    expect(high.maxOutputBytes).toBe(100_000_000);
  });

  it('handleSetConfig rejects bad types with 400 and writes nothing', () => {
    expect(handleSetConfig({ maxOutputBytes: 'x' }).status).toBe(400);
    expect(handleSetConfig({ excludeCommands: 5 }).status).toBe(400);
    expect(handleSetConfig({ excludeDirs: [1, 2, 3] }).status).toBe(400);
    expect(handleSetConfig({ redactionEnabled: 'true' }).status).toBe(400);
    expect(handleSetConfig({ redactionExtraPatterns: 'nope' }).status).toBe(400);
    expect(handleSetConfig({ maxOutputBytes: -5 }).status).toBe(400);
    expect(handleSetConfig({ maxOutputBytes: 1.5 }).status).toBe(400);
    expect(handleSetConfig(null).status).toBe(400);

    // None of the rejected calls should have created a config file.
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
  });

  it('importHistory dedup still holds on re-import (no child_process)', () => {
    const histFile = path.join(dir, 'hist');
    fs.writeFileSync(histFile, ': 1700000000:0;git status\n: 1700000005:0;npm test\n');

    const first = importHistory({ file: histFile });
    expect(first.filesRead).toBe(1);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);

    const second = importHistory({ file: histFile });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });
});

describe('control surface never spawns a process', () => {
  const root = path.join(__dirname, '..');

  // Match an actual import/require of child_process, ignoring the prose in the
  // module headers that mention it precisely to document its absence.
  const importsChildProcess =
    /(?:from\s+['"]child_process['"])|(?:require\(\s*['"]child_process['"]\s*\))|(?:import\s*\(\s*['"]child_process['"]\s*\))/;

  for (const rel of ['src/server/api.ts', 'src/server/server.ts']) {
    it(`${rel} does not import child_process or call exec/spawn`, () => {
      const source = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(source).not.toMatch(importsChildProcess);
      // Disallow the child_process call surfaces. `.exec(` (RegExp.prototype.exec)
      // is allowed, so require these names not to be a member access on something.
      expect(source).not.toMatch(/(?<!\.)\b(?:execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/);
    });
  }
});
