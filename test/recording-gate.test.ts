/**
 * Tests for the recording gate — pause + exclude privacy controls. [TASK-032]
 *
 * isPaused/setPaused touch the filesystem under the data dir, which is resolved
 * from $BACKSCROLL_DIR live at call time (see paths.ts). Each test therefore
 * runs against an isolated temp data dir so we never read or mutate the real
 * one.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { isPaused, setPaused, shouldRecord } from '../src/capture/recording-gate';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config';

describe('recording-gate', () => {
  let prevDir: string | undefined;

  beforeEach(() => {
    prevDir = process.env.BACKSCROLL_DIR;
    process.env.BACKSCROLL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-gate-'));
  });

  afterEach(() => {
    // Always clear any marker, then remove the isolated data dir.
    setPaused(false);
    const dir = process.env.BACKSCROLL_DIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });

    if (prevDir === undefined) delete process.env.BACKSCROLL_DIR;
    else process.env.BACKSCROLL_DIR = prevDir;
  });

  describe('pause marker (isPaused / setPaused)', () => {
    it('round-trips through paused and resumed states', () => {
      expect(isPaused()).toBe(false);

      setPaused(true);
      expect(isPaused()).toBe(true);

      setPaused(false);
      expect(isPaused()).toBe(false);
    });

    it('treats setPaused(false) as a no-op when not paused (does not throw)', () => {
      expect(isPaused()).toBe(false);
      expect(() => setPaused(false)).not.toThrow();
      expect(isPaused()).toBe(false);
    });
  });

  describe('shouldRecord — exclude by command', () => {
    it('blocks a command matching an excludeCommands glob', () => {
      const config = mergeConfig({ excludeCommands: ['*vault*'] });
      expect(shouldRecord('vault read secret/x', '/home/me', config)).toBe(false);
    });

    it('records a command that does not match the exclude glob', () => {
      const config = mergeConfig({ excludeCommands: ['*vault*'] });
      expect(shouldRecord('ls -la', '/home/me', config)).toBe(true);
    });
  });

  describe('shouldRecord — exclude by dir', () => {
    it('blocks a cwd nested under an excluded directory', () => {
      const config = mergeConfig({ excludeDirs: ['/home/me/secrets'] });
      expect(shouldRecord('ls', '/home/me/secrets/db', config)).toBe(false);
    });

    it('records a cwd outside the excluded directory', () => {
      const config = mergeConfig({ excludeDirs: ['/home/me/secrets'] });
      expect(shouldRecord('ls', '/home/me/work', config)).toBe(true);
    });
  });

  describe('shouldRecord — default permissive', () => {
    it('records everything with the empty default config', () => {
      expect(shouldRecord('anything', '/any/dir', DEFAULT_CONFIG)).toBe(true);
    });

    it('records when cwd is null and exclude lists are empty (edge case)', () => {
      expect(shouldRecord('anything', null, DEFAULT_CONFIG)).toBe(true);
    });
  });
});
