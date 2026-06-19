import { parseTimeSpec, humanizeDuration } from '../src/util/time';

describe('parseTimeSpec', () => {
  const NOW = 1_700_000_000_000;

  it('parses relative units', () => {
    expect(parseTimeSpec('3d', NOW)).toBe(NOW - 3 * 86_400_000);
    expect(parseTimeSpec('45m', NOW)).toBe(NOW - 45 * 60_000);
    expect(parseTimeSpec('1mo', NOW)).toBe(NOW - 2_592_000_000);
  });

  it('parses ISO dates', () => {
    expect(parseTimeSpec('2024-01-01', NOW)).toBe(Date.parse('2024-01-01'));
  });

  // Regression: a bare number used to fall through to Date.parse and be read as
  // a year ("3" -> 2001, "45" -> 2044) instead of erroring.
  it('rejects a bare number rather than misreading it as a year', () => {
    expect(() => parseTimeSpec('3', NOW)).toThrow();
    expect(() => parseTimeSpec('45', NOW)).toThrow();
    expect(() => parseTimeSpec('2024', NOW)).toThrow();
  });

  it('throws on gibberish', () => {
    expect(() => parseTimeSpec('whenever', NOW)).toThrow();
  });
});

describe('humanizeDuration', () => {
  // Regression: independent floor(min)+round(sec) used to emit "1m60s"/"60s".
  it('never emits "60s" or "Xm60s"', () => {
    for (const ms of [119_600, 59_600, 59_990, 60_000, 119_999, 89_900]) {
      const s = humanizeDuration(ms);
      expect(s).not.toBe('60s');
      expect(s).not.toMatch(/m60s$/);
    }
  });

  it('formats representative durations', () => {
    expect(humanizeDuration(350)).toBe('350ms');
    expect(humanizeDuration(1_200)).toBe('1.2s');
    expect(humanizeDuration(12_000)).toBe('12s');
    expect(humanizeDuration(59_600)).toBe('1m');
    expect(humanizeDuration(90_000)).toBe('1m30s');
    expect(humanizeDuration(null)).toBe('—');
  });
});
