/**
 * Regression tests for the code-review fixes (each would have failed before).
 */
import { Segmenter } from '../src/capture/segmenter';
import { redact } from '../src/redaction/redact';
import { shouldRecord } from '../src/capture/recording-gate';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config';
import { openDatabase } from '../src/db/database';
import { Store } from '../src/db/store';

const ESC = '\x1b';
const BEL = '\x07';
const b64 = (x: string): string => Buffer.from(x, 'utf8').toString('base64');

describe('segmenter output cap is byte-accurate', () => {
  it('caps multibyte output by UTF-8 bytes, not UTF-16 code units', () => {
    const s = new Segmenter({ maxOutputBytes: 10, now: () => 1 });
    s.feed(`${ESC}]133;C;cmd=${b64('x')}${BEL}`);
    s.feed('世界你好朋友世界你好'); // 10 CJK chars = 30 bytes
    const blocks = s.feed(`${ESC}]133;D;0${BEL}`);
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b.truncated).toBe(true);
    const body = b.output.replace(/\n….*$/s, ''); // strip the truncation marker
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(10);
  });
});

describe('redaction does not over-redact following tokens', () => {
  it('masks the secret value but preserves a following key=value pair', () => {
    const out = redact('password=foo,bar=baz', DEFAULT_CONFIG);
    expect(out).toContain('«redacted:assignment»');
    expect(out).toContain('bar=baz'); // value match must stop at the comma
  });
});

describe('recording-gate dir exclude is path-prefix, not substring', () => {
  it('excludes /tmp/... but not /var/tmp/...', () => {
    const cfg = mergeConfig({ excludeDirs: ['/tmp'] });
    expect(shouldRecord('ls', '/var/tmp/foo', cfg)).toBe(true); // not under /tmp
    expect(shouldRecord('ls', '/tmp/foo', cfg)).toBe(false); // prefix match
    expect(shouldRecord('ls', '/tmp', cfg)).toBe(false); // exact match
  });
});

describe('snippet survives porter stemming', () => {
  it('returns a snippet when the FTS match was via a stem (running ~ run)', () => {
    const db = openDatabase(':memory:');
    const store = new Store(db);
    store.insertCommand({
      sessionId: null,
      command: 'do it',
      cwd: null,
      gitBranch: null,
      exitCode: 0,
      startedAt: 1,
      durationMs: 1,
      source: 'pty',
      output: 'the server is run now and ok',
    });
    const r = store.search({ query: 'running' });
    expect(r).toHaveLength(1);
    expect(r[0]!.snippet).not.toBeNull();
    db.close();
  });
});
