import { parseZshHistory, parseBashHistory } from '../src/history/parse';

describe('parseZshHistory', () => {
  it('parses extended format with timestamps', () => {
    const content = ': 1700000000:0;git status\n: 1700000005:2;npm test\n';
    const e = parseZshHistory(content, 999);
    expect(e).toHaveLength(2);
    expect(e[0]).toEqual({ command: 'git status', startedAt: 1_700_000_000_000 });
    expect(e[1]!.command).toBe('npm test');
  });

  it('joins multi-line (backslash continuation) commands', () => {
    const content = ': 1700000000:0;echo one \\\ntwo\n';
    const e = parseZshHistory(content, 0);
    expect(e).toHaveLength(1);
    expect(e[0]!.command).toContain('two');
    expect(e[0]!.command).toContain('\n');
  });

  it('falls back to file mtime for plain (non-extended) lines', () => {
    const e = parseZshHistory('ls -la\npwd\n', 12345);
    expect(e).toHaveLength(2);
    expect(e[0]).toEqual({ command: 'ls -la', startedAt: 12345 });
  });
});

describe('parseBashHistory', () => {
  it('parses plain lines with mtime fallback', () => {
    expect(parseBashHistory('ls\npwd\n', 555)).toEqual([
      { command: 'ls', startedAt: 555 },
      { command: 'pwd', startedAt: 555 },
    ]);
  });

  it('uses HISTTIMEFORMAT #<epoch> timestamp lines', () => {
    const e = parseBashHistory('#1700000000\ngit log\n', 0);
    expect(e).toHaveLength(1);
    expect(e[0]).toEqual({ command: 'git log', startedAt: 1_700_000_000_000 });
  });
});
