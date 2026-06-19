/**
 * Shell history file parsers (for `bsc import`).
 *
 * Imported entries are metadata-only (no output — it's gone). Timestamps are
 * used when the history format records them; otherwise we fall back to the
 * file's mtime so entries still sort sensibly.
 */

export interface HistoryEntry {
  command: string;
  /** epoch ms */
  startedAt: number;
}

// zsh EXTENDED_HISTORY line: ": <epoch>:<elapsed>;<command>"
const ZSH_EXT = /^:\s*(\d+):\d+;(.*)$/;

/** Parse a zsh history file (extended or plain). `fallbackTs` is the file mtime. */
export function parseZshHistory(content: string, fallbackTs: number): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let current: { command: string; ts: number } | null = null;

  const flush = (): void => {
    if (current) {
      const command = current.command.replace(/\\$/, '').trim();
      if (command) entries.push({ command, startedAt: current.ts });
    }
    current = null;
  };

  for (const line of content.split('\n')) {
    const m = ZSH_EXT.exec(line);
    if (m) {
      flush();
      current = { ts: parseInt(m[1] ?? '0', 10) * 1000, command: m[2] ?? '' };
    } else if (current && current.command.endsWith('\\')) {
      // Multi-line command continuation.
      current.command = `${current.command.slice(0, -1)}\n${line}`;
    } else {
      flush();
      if (line.trim()) current = { ts: fallbackTs, command: line };
    }
  }
  flush();
  return entries;
}

/** Parse a bash history file (plain, with optional HISTTIMEFORMAT `#<epoch>` lines). */
export function parseBashHistory(content: string, fallbackTs: number): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let pendingTs: number | null = null;

  for (const line of content.split('\n')) {
    const tsm = /^#(\d{9,})$/.exec(line);
    if (tsm) {
      pendingTs = parseInt(tsm[1] ?? '0', 10) * 1000;
      continue;
    }
    if (!line.trim()) continue;
    entries.push({ command: line, startedAt: pendingTs ?? fallbackTs });
    pendingTs = null;
  }
  return entries;
}
