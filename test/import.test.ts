import fs from 'fs';
import os from 'os';
import path from 'path';
import { importCommand } from '../src/commands/import';
import { getDb, closeDb } from '../src/db/database';
import { Store } from '../src/db/store';

describe('bsc import (history backfill)', () => {
  let dir: string;
  let histFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-import-'));
    process.env.BACKSCROLL_DIR = dir;
    histFile = path.join(dir, 'hist');
    fs.writeFileSync(
      histFile,
      ': 1700000000:0;git status\n' +
        ': 1700000005:0;npm test\n' +
        ': 1700000010:0;export API_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaa\n'
    );
  });

  afterEach(() => {
    closeDb();
    delete process.env.BACKSCROLL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const historyRows = () =>
    new Store(getDb()).getRecentCommands(1000).filter((c) => c.source === 'history');

  it('imports history and is idempotent on re-run (regression: separator mismatch)', () => {
    importCommand({ file: histFile });
    expect(historyRows()).toHaveLength(3);
    importCommand({ file: histFile }); // re-import must NOT duplicate
    expect(historyRows()).toHaveLength(3);
  });

  it('redacts secrets in imported commands', () => {
    importCommand({ file: histFile });
    const tokenRow = historyRows().find((r) => r.command.includes('API_TOKEN'));
    expect(tokenRow).toBeDefined();
    expect(tokenRow!.command).toContain('«redacted');
    expect(tokenRow!.command).not.toContain('ghp_');
  });
});
