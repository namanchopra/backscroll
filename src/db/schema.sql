-- Backscroll storage schema. [TASK-004]
-- Three tables (sessions · commands · output) + a contentless FTS5 index
-- maintained transactionally by the store layer (rowid = commands.id).

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY,
  started_at  INTEGER NOT NULL,         -- epoch ms
  ended_at    INTEGER,
  shell       TEXT,
  tty         TEXT,
  hostname    TEXT,
  bsc_version TEXT
);

CREATE TABLE IF NOT EXISTS commands (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  command      TEXT NOT NULL,           -- redacted
  cwd          TEXT,
  git_branch   TEXT,
  exit_code    INTEGER,                 -- NULL if unknown
  started_at   INTEGER NOT NULL,        -- epoch ms
  duration_ms  INTEGER,
  source       TEXT NOT NULL            -- 'pty' | 'hook'
);

CREATE INDEX IF NOT EXISTS idx_commands_cwd     ON commands(cwd);
CREATE INDEX IF NOT EXISTS idx_commands_exit    ON commands(exit_code);
CREATE INDEX IF NOT EXISTS idx_commands_started ON commands(started_at);

CREATE TABLE IF NOT EXISTS output (
  command_id INTEGER PRIMARY KEY REFERENCES commands(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,            -- redacted, ANSI-stripped
  bytes      INTEGER NOT NULL
);

-- Contentless FTS5 index: matches return rowid, we join back to commands.
-- Maintained explicitly by the store (insert/delete) so the indexed text can
-- be assembled from two tables (command + output) at write time.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  command,
  output,
  content='',
  tokenize='porter unicode61'
);
