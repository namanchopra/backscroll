import { stripAnsi } from '../src/capture/ansi';

describe('stripAnsi', () => {
  it('strips SGR colour codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips cursor/clear sequences without eating surrounding text', () => {
    expect(stripAnsi('a\x1b[2Kb\x1b[Hc')).toBe('abc');
  });

  // Regression: OSC 7 (cwd) / OSC 0;2 (title) reports used to leak `file://...`.
  it('strips OSC reports, BEL- and ST-terminated', () => {
    expect(stripAnsi('done\x1b]7;file://host/Users/me/proj\x07')).toBe('done');
    expect(stripAnsi('x\x1b]0;my title\x07y')).toBe('xy');
    expect(stripAnsi('x\x1b]7;file://h/p\x1b\\y')).toBe('xy');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('just plain text 123')).toBe('just plain text 123');
  });
});
