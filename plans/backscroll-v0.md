# Plan: Backscroll (`bsc`) — v0

> Generated: 2026-06-19
> Branch: `feat/backscroll-v0`
> Mode: EXPANSION

## Overview

Backscroll is a local-only "time machine" for the terminal. It records every shell command — text, output, cwd, exit code, timestamp, duration, git branch — into a searchable SQLite store so you can later ask *"what was that docker command 3 weeks ago that actually worked?"* and find it instantly, **including the output** that proves it worked. v0 ships: scaffold + CI, a SQLite/FTS5 storage layer, PTY-based recording (`bsc rec`) plus a zsh metadata hook (`bsc init zsh`), filtered search, `bsc show`, an interactive fuzzy picker that copies to clipboard, and first-class privacy (redaction + exclude config + pause). 100% local, no network.

## Scope Challenge

**Repo state:** greenfield — only `.claude/` exists. Node v22.12, npm 11. `fzf` is **not installed** on this machine. Nothing to reuse → **EXPANSION** confirmed.

**Decisions locked with the user (Phase 0):**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Capture mechanism | **PTY + auto-injected OSC 133 markers**, heuristic fallback | Markers come from *our* injected integration, not prompt guesswork → robust across themes (oh-my-zsh, p10k). Metadata travels in the marker payload, so output and metadata stay correlated by construction. |
| Planning mode | **EXPANSION** | Greenfield; full layer decomposition with comprehensive tests. |
| Interactive picker | **Custom Node TUI** | `fzf` absent here; an in-process picker has zero external dependency and consistent cross-platform UX. |
| v0 shells | **zsh only** | Matches the user's macOS default; bash/fish deferred to v1 to keep the fragile-edge surface small. |

**Ruled out:** hooks-only (drops the headline output-search feature — that's the entire differentiator vs atuin); pure heuristic prompt parsing (fragile, the make-or-break risk); shelling out to fzf (external dep, absent here); shipping bash in v0 (doubles the marker/hook test matrix).

**Anti-over-build guardrails (user said "keep it small"):** no daemon, no sync, no web UI, no encryption-at-rest, no stats/dashboards, no `replay`/asciinema export, no bash/fish, no config UI. Output is stored ANSI-stripped (raw escapes dropped) for v0. These are explicit non-goals.

## Capture Architecture (PTY vs Hooks — the make-or-break decision)

Two cleanly separated layers, exactly as requested:

**Layer 1 — Metadata (always-on, lightweight): shell hooks.**
`bsc init zsh` prints a snippet for `.zshrc` that wires `preexec` (capture command + start time) and `precmd` (capture exit code + duration + cwd + branch) and emits **OSC 133** sequences. Outside a `bsc rec` session these hooks can still write *metadata-only* rows (`source='hook'`). This is the atuin-equivalent layer.

**Layer 2 — Output (opt-in per session): PTY wrapper.**
`bsc rec` spawns the user's `$SHELL` under a PTY via `node-pty`, with `ZDOTDIR` pointed at a temp rcfile that sources the same integration (so the user need not have run `init`). All PTY bytes are tee'd to the segmenter. The integration emits per command:

```
OSC 133 ; A ST                          → prompt start
OSC 133 ; C ; cmd=<b64> ; cwd=<b64> ; branch=<b64> ST   → command start + payload
… command output streams here …
OSC 133 ; D ; <exit-code> ; dur=<ms> ST → command end
```

The **segmenter** slices the byte stream on the `C…D` envelope into per-command blocks `{command, output, cwd, branch, exitCode, startedAt, durationMs, source:'pty'}`. **Heuristic fallback:** if no OSC 133 markers arrive within N bytes (e.g. a raw subshell, or a shell we couldn't inject), fall back to detecting prompt redraws to bound blocks — degraded but non-fatal.

**Why PTY over hooks-only:** hooks can't see output. The product promise ("the one that *worked*") requires output. **Why markers over pure heuristics:** we control the emitter, so segmentation is deterministic regardless of the user's prompt theme; heuristics are only the safety net. Trade-off accepted: PTY adds a subshell + `node-pty` native dep + resize/teardown handling — encapsulated entirely in `pty-recorder.ts` (TASK-015), the single make-or-break node.

## Repo Structure

```
backscroll/
├── package.json            bin: { "bsc": "dist/cli.js" }            [001]
├── tsconfig.json           strict, NodeNext                          [001]
├── eslint.config.js .prettierrc.json jest.config.js                  [002]
├── .github/workflows/ci.yml  macOS+Linux × node 20/22                [027]
├── README.md               pitch · arch · privacy · vs-atuin         [028]
└── src/
    ├── cli.ts              commander entry, subcommand wiring         [026]
    ├── types.ts            SessionRecord, CommandRecord, Filters…     [003]
    ├── paths.ts            data-dir / db / config / pause-marker      [005]
    ├── config.ts           defaults + exclude patterns + toggles      [006]
    ├── db/
    │   ├── schema.sql      sessions · commands · output · search_fts  [004]
    │   ├── database.ts     open + migrate + pragmas (WAL)             [007]
    │   └── store.ts        insert/search/getById (+ FTS upkeep)       [008]
    ├── redaction/redact.ts secret masking BEFORE storage             [009]
    ├── capture/
    │   ├── ansi.ts         strip ANSI for stored/searchable text      [010]
    │   ├── osc133.ts       OSC 133 marker state machine               [011]
    │   ├── segmenter.ts    stream → per-command blocks (+ cap/fallback)[012]
    │   ├── recording-gate.ts  pause-marker + exclude checks           [014]
    │   ├── persist.ts      gate → redact → insert (privacy pipeline)  [033]
    │   └── pty-recorder.ts node-pty spawn + tee + teardown            [015]
    ├── shell/
    │   ├── integration.ts  snippet generator                         [013]
    │   └── zsh-integration.zsh  precmd/preexec + OSC 133 template     [013]
    ├── commands/
    │   ├── init.ts  rec.ts  pause.ts  search.ts  show.ts        [019/020/021/022/023]
    ├── ui/
    │   ├── format.ts       results + match highlighting               [018]
    │   ├── clipboard.ts     pbcopy/xclip/wl-copy                      [017]
    │   └── picker.ts        raw-mode fuzzy TUI                        [024]
    └── util/time.ts        --since/--until parse + humanize           [016]
```

## SQLite Schema

Three tables (sessions · commands · output) + a standalone FTS5 index maintained transactionally by the store layer (`rowid = commands.id`). Output lives in its own table so the hot `commands` row stays small and large blobs load lazily on `bsc show`.

```sql
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  started_at  INTEGER NOT NULL,         -- epoch ms
  ended_at    INTEGER,
  shell       TEXT,                     -- 'zsh'
  tty         TEXT,
  hostname    TEXT,
  bsc_version TEXT
);

CREATE TABLE commands (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  command      TEXT NOT NULL,           -- REDACTED text
  cwd          TEXT,
  git_branch   TEXT,
  exit_code    INTEGER,                 -- NULL if unknown
  started_at   INTEGER NOT NULL,        -- epoch ms
  duration_ms  INTEGER,
  source       TEXT NOT NULL            -- 'pty' | 'hook'
);
CREATE INDEX idx_commands_cwd     ON commands(cwd);
CREATE INDEX idx_commands_exit    ON commands(exit_code);
CREATE INDEX idx_commands_started ON commands(started_at);

CREATE TABLE output (
  command_id INTEGER PRIMARY KEY REFERENCES commands(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,             -- REDACTED, ANSI-stripped
  bytes      INTEGER NOT NULL
);

-- contentless FTS5: matches return rowid, we join back to commands
CREATE VIRTUAL TABLE search_fts USING fts5(
  command, output,
  content='', tokenize='porter unicode61'
);
```

Store writes `commands` + `output` + `search_fts` in **one transaction** (rather than triggers, because the FTS row needs columns from two tables assembled at insert time). PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`.

## Search UX

```
$ bsc search "docker run" --cwd ~/work --success --since 3w --limit 20
  #1421  ✓  3w ago   ~/work/api   docker run --rm -p 8080:80 nginx:alpine
                     ↳ …Server started on :80…  (matched output)
  #1390  ✓  4w ago   ~/work/api   docker run -d --name pg postgres:16
```
- Filters: `--cwd <path>` (prefix match), `--success` (exit 0 only), `--since`/`--until` (relative `3w`/`2d`/`1mo` or ISO), `--limit <n>` (default 50).
- FTS5 ranks by relevance; matched terms highlighted in command + a one-line output snippet (picocolors).
- On a TTY, `bsc search` opens the **custom picker** (TASK-024): ↑↓ navigate, fuzzy-narrow as you type, output preview pane, ⏎ copies the selected command to clipboard, esc quits. `--no-pick` / non-TTY → plain list.
- `bsc show <id>` prints the full stored (redacted) output with a metadata header.

## Redaction Approach (first-class, pre-storage)

Redaction runs **in-process, before anything is written to SQLite** — both command text and output pass through `redact()` (TASK-009) on the write path inside `pty-recorder`/store. Layers:
1. **Assignment patterns:** `KEY=value` / `--token=…` / `Authorization: …` where the key matches a secret-ish name (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*PASSWD*`, `*CREDENTIAL*`, `*PRIVATE*`).
2. **Known token shapes:** AWS access/secret keys, GitHub `ghp_`/`gho_`, Slack `xox*`, bearer/JWT (`eyJ…`), `-----BEGIN … PRIVATE KEY-----` blocks, generic long hex/base64.
3. **User-extensible:** extra regexes from config; redaction can be tightened but **not disabled to "off"** silently — default-on.
Matches replaced with `«redacted:KIND»`. The **recording gate** (TASK-014) additionally drops whole commands/dirs matching exclude patterns and honors a pause-marker file (`bsc pause`/`resume`).

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │                  bsc (CLI)                     │
                         │             src/cli.ts   [TASK-026]            │
                         └──┬─────────┬─────────┬─────────┬─────────┬─────┘
              init [019]    │   rec   │ search  │  show   │  pause  │
              ┌─────────────┘  [020]  │ [022]   │ [023]   │ [021]   │
              ▼                 │      │ +pick   │         │         │
   zsh integration         ┌────▼──────┐ [025]   │         │  (pause-marker
   src/shell  [TASK-013]──▶│PTY recorder│         │         │   + exclude
   OSC 133 emitter         │ [TASK-015] │         │         │   = gate[014])
                           └─┬───┬──────┘         │         │
        segmenter[012]       │   │ persist[033]   │         │
        +osc133 [011]        │   │ (gate→redact)  ▼         ▼
        +ansi   [010]────────┘   └──▶┌────────────────────────────┐
                                     │   Store API   [TASK-008]    │◀── picker[024]
   format[018] ─ time[016]──────────▶│   src/db/store.ts           │    clipboard[017]
                                     └──────────────┬──────────────┘
                                                    ▼
                                  ┌──────────────────────────────────┐
                                  │  SQLite + FTS5  [TASK-004 / 007]   │
                                  │  sessions · commands · output      │
                                  │  search_fts (command + output)      │
                                  └──────────────────────────────────┘
  foundation: types[003] · paths[005] · config[006]
  privacy:    persist pipeline[033] = recording-gate[014] (pause/exclude) → redaction[009] (pre-storage) → store[008]
```

## Existing Code Leverage

| Sub-problem | Existing Code | Action |
|-------------|---------------|--------|
| Everything (storage, capture, CLI, UI) | (none — greenfield) | Build new |
| PTY spawn | `node-pty` (dep) | Reuse library |
| Full-text search | `better-sqlite3` + FTS5 | Reuse engine |
| CLI parsing / colors | `commander` / `picocolors` | Reuse libraries |

## Tasks

### TASK-001: Project scaffold & TypeScript config

Create `package.json` with `bin: { "bsc": "dist/cli.js" }`, dependencies (`node-pty`, `better-sqlite3`, `commander`, `picocolors`), devDependencies (`typescript`, `jest`, `ts-jest`, `@types/jest`, `@types/node`, `@types/better-sqlite3`, `eslint`, `typescript-eslint`, `prettier`), and scripts (`build`, `dev`, `test`, `lint`, `format`). Add `tsconfig.json` (strict, `module`/`moduleResolution` NodeNext, `outDir dist`) and `.gitignore` (node_modules, dist, `*.sqlite*`).

**Type:** infra
**Effort:** S

**Acceptance Criteria:**
- [ ] `npm install` succeeds and `npx tsc --noEmit` runs with zero config errors on an empty `src/`
- [ ] `tsconfig.json` has `"strict": true` and emits to `dist/`
- [ ] `.gitignore` excludes `node_modules/`, `dist/`, and `*.sqlite*` (DB must never be committed)

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-002: Lint / format / test tooling configs

Create `eslint.config.js` (flat config using `typescript-eslint` recommended), `.prettierrc.json`, and `jest.config.js` (ts-jest preset, `testEnvironment: 'node'`, `testMatch` for `test/**/*.test.ts`). Do not modify `package.json` (scripts already defined in TASK-001).

**Type:** infra
**Effort:** S

**Acceptance Criteria:**
- [ ] `npm run lint` runs eslint over `src/` with no config errors
- [ ] `npm test` invokes jest and reports "no tests found" cleanly (exit 0 with `--passWithNoTests`)
- [ ] Prettier and eslint do not conflict on a sample formatted file

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-003: Domain types & contracts

Create `src/types.ts` exporting: `SessionRecord`, `CommandRecord` (with `source: 'pty' | 'hook'`), `OutputBlock` (segmenter output), `SearchFilters` (`cwd?`, `successOnly?`, `since?`, `until?`, `limit?`, `query`), `SearchResult` (command + snippet + rank), `BackscrollConfig` (excludeCommands, excludeDirs, redactionExtraPatterns, redactionEnabled, **maxOutputBytes**), and `RedactionMatch`.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] All types compile under strict mode with no `any` in public shapes
- [ ] `CommandRecord.exitCode` is `number | null` and `source` is the literal union
- [ ] `SearchFilters` makes every filter optional except `query`

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-004: SQLite schema (sessions · commands · output · FTS5)

Create `src/db/schema.sql` per the **SQLite Schema** section: `sessions`, `commands` (+ indices on cwd/exit_code/started_at), `output`, and contentless `search_fts(command, output)` using `tokenize='porter unicode61'`. Include `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` as separate setup statements (applied by TASK-007).

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] Loading the schema into a fresh `:memory:` better-sqlite3 db succeeds with no SQL errors
- [ ] `commands.session_id` has `ON DELETE CASCADE` to `sessions(id)` and `output.command_id` cascades from `commands(id)`
- [ ] An FTS `MATCH` query against `search_fts` returns rows after a manual insert (smoke check)

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-005: Data-dir & path resolution

Create `src/paths.ts`: resolve the data directory (`$XDG_DATA_HOME/backscroll` or `~/.local/share/backscroll`; respect `$BACKSCROLL_DIR` override), and expose `dbPath()`, `configPath()`, `pauseMarkerPath()`, plus `ensureDataDir()`. Create the directory with `0700` perms.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `ensureDataDir()` creates the dir recursively and is idempotent on a second call
- [ ] `$BACKSCROLL_DIR` overrides the default location
- [ ] Created directory has owner-only (`0700`) permissions (privacy — no group/other read)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003
**Priority:** P1

---

### TASK-006: Config loader

Create `src/config.ts`: load JSON config from `configPath()`, deep-merge over defaults, return a typed `BackscrollConfig`. Defaults: `redactionEnabled: true`, empty exclude lists, empty extra patterns, `maxOutputBytes: 1_000_000` (1 MB per-command output cap). Tolerate a missing/empty/malformed file by falling back to defaults (warn, never throw).

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] Missing config file returns defaults without throwing
- [ ] Malformed JSON logs a warning and returns defaults (does not crash recording)
- [ ] User values override defaults; unspecified keys keep defaults

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003, TASK-005
**Priority:** P1

---

### TASK-007: Database open & migrate

Create `src/db/database.ts`: open `better-sqlite3` at `dbPath()`, apply `schema.sql` idempotently (split & exec; guarded by `CREATE … IF NOT EXISTS`), set WAL + foreign_keys pragmas, expose a singleton `getDb()` and `closeDb()`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] First open creates all tables; second open is a no-op (no errors)
- [ ] `PRAGMA foreign_keys` reports `1` and `journal_mode` reports `wal` after open
- [ ] Opening against a read-only directory surfaces a clear error (does not silently lose data)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-004, TASK-005
**Priority:** P1

---

### TASK-008: Store API

Create `src/db/store.ts`: `createSession()`, `endSession(id)`, `insertCommand(record)` (writes `commands` + `output` + `search_fts` in one transaction), `search(filters): SearchResult[]` (FTS `MATCH` + cwd/exit/time filters + limit, ordered by rank), `getCommandById(id)`, `getRecentCommands(limit)`. Use prepared statements.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] `insertCommand` then `search` finds the row by a term in its output
- [ ] `search` with `successOnly` excludes non-zero exit codes; `cwd` filter is a prefix match; `limit` caps results
- [ ] Inserting a command with no output (hook source) leaves `output` row absent but command still searchable by command text

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003, TASK-007
**Priority:** P1

---

### TASK-009: Redaction engine (privacy — pre-storage)

Create `src/redaction/redact.ts`: `redact(text, config): string` implementing the layered patterns in the **Redaction Approach** section (secret-key assignments, known token shapes, PEM blocks, extra config patterns). Export the rule list for testing. Replace matches with `«redacted:KIND»`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] `AWS_SECRET_ACCESS_KEY=wJalr...`, a `ghp_` token, and a `Bearer eyJ...` JWT are all masked
- [ ] A benign string like `PATH=/usr/bin` and ordinary prose are left untouched (no over-redaction)
- [ ] Extra patterns from config are applied; with `redactionEnabled:false` the text is returned verbatim (explicit opt-out only)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003
**Priority:** P1

---

### TASK-010: ANSI utilities

Create `src/capture/ansi.ts`: `stripAnsi(s)` removing CSI/SGR/OSC and other escape sequences, returning clean text for storage and search.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] Colored output (`\x1b[31mred\x1b[0m`) reduces to `red`
- [ ] Cursor-movement and clear-line sequences are removed without eating surrounding text
- [ ] Input with no escapes is returned unchanged

**Agent:** nodejs-cli-senior-engineer

**Priority:** P1

---

### TASK-011: OSC 133 marker parser

Create `src/capture/osc133.ts`: a state machine that scans a byte/string stream for `ESC ] 133 ; {A|B|C|D} [; params] ST/BEL` and emits typed events (`promptStart`, `commandStart{cmd,cwd,branch}`, `commandEnd{exitCode,durationMs}`). Decode base64 payload params. Tolerate markers split across chunk boundaries.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] A full `133;C;cmd=<b64>...` then `133;D;0;dur=12` sequence emits commandStart + commandEnd with decoded fields
- [ ] A marker split across two `feed()` calls is still parsed correctly (boundary buffering)
- [ ] Non-133 OSC sequences and malformed params are ignored without throwing

**Agent:** nodejs-cli-senior-engineer

**Priority:** P1

---

### TASK-012: Output segmenter (+ heuristic fallback)

Create `src/capture/segmenter.ts`: consume the PTY stream via the OSC 133 parser, accumulate bytes between `commandStart` and `commandEnd` as that command's output, and emit `OutputBlock`s. **Enforce a configurable output cap (`maxOutputBytes`):** once a command's accumulated output exceeds the cap, stop buffering further bytes for that command and append a `…[truncated N bytes]` marker — this bounds memory against runaway commands (`yes`, `cat bigfile`, `tail -f`). Fallback: if no markers seen, detect prompt redraws to bound blocks (degraded mode). Strip ANSI from stored output via TASK-010.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] A scripted two-command stream with markers yields exactly two `OutputBlock`s with correct command/exit/output
- [ ] Output between markers is captured verbatim (then ANSI-stripped) and assigned to the right command
- [ ] Output exceeding `maxOutputBytes` is truncated with a `…[truncated N bytes]` marker and buffering stops (no unbounded memory growth)
- [ ] A marker-less stream still produces ≥1 block via the heuristic fallback rather than crashing or losing everything

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003, TASK-010, TASK-011
**Priority:** P1

---

### TASK-013: zsh integration snippet (generator + template)

Create `src/shell/zsh-integration.zsh` (the `preexec`/`precmd` functions that emit OSC 133 A/C/D with base64 cmd/cwd/branch payloads) and `src/shell/integration.ts` exporting `zshSnippet({forRec})` to return it as a string. The `forRec` variant assumes it's auto-sourced inside `bsc rec`; the install variant is what `bsc init zsh` prints.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Sourcing the snippet in a real zsh and running a command emits a `133;C` and `133;D` pair (verifiable by piping to `cat -v`)
- [ ] The snippet computes git branch without erroring outside a git repo (empty branch, no stderr noise)
- [ ] `integration.ts` returns valid zsh as a string for both `forRec:true|false`

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003
**Priority:** P1

---

### TASK-014: Recording gate — pause & exclude (privacy)

Create `src/capture/recording-gate.ts`: `isPaused()` (presence of `pauseMarkerPath()`), `setPaused(bool)`, and `shouldRecord(command, cwd, config)` returning false when the command or cwd matches an exclude pattern. Glob/substring matching for excludes.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] With the pause marker present, `isPaused()` is true and the recorder writes nothing
- [ ] A command matching `excludeCommands` (e.g. `*vault*`) and a cwd under `excludeDirs` are both rejected by `shouldRecord`
- [ ] Empty exclude lists allow everything (default behavior)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-005, TASK-006
**Priority:** P1

---

### TASK-015: PTY recorder — terminal mechanics (make-or-break node)

Create `src/capture/pty-recorder.ts`: spawn `$SHELL` via `node-pty` with a temp `ZDOTDIR` rcfile sourcing the `forRec` integration; pipe child↔parent stdio transparently; tee output into the segmenter; handle SIGWINCH resize and clean teardown on exit (always restore termios). Hand each emitted `OutputBlock` to the **persist pipeline (TASK-033)** — this task owns the *terminal mechanics*, not the storage/privacy decision. Returns the child exit code.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] Running `bsc rec` (wired later) gives a fully interactive shell; typing/colors/resize behave like a normal terminal
- [ ] Each command's `OutputBlock` is forwarded to the persist pipeline with correct command/exit/output
- [ ] Terminal raw mode is always restored on exit, including on the child crashing or the parent receiving SIGINT (no broken terminal)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-012, TASK-013, TASK-033
**Priority:** P1

---

### TASK-016: Time parsing & humanize utils

Create `src/util/time.ts`: `parseSince(s)` / `parseUntil(s)` accepting relative (`3w`, `2d`, `1mo`, `45m`) and ISO dates → epoch ms; `humanizeRelative(ms)` ("3w ago") and `humanizeDuration(ms)` ("1.2s").

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `3w` resolves to ~21 days before a passed-in reference time (inject `now` for testability — no hidden `Date.now()`)
- [ ] An ISO string parses to the correct epoch ms
- [ ] An unparseable token throws a clear error (surfaced to the user, not silently ignored)

**Agent:** nodejs-cli-senior-engineer

**Priority:** P1

---

### TASK-017: Clipboard utility

Create `src/ui/clipboard.ts`: `copyToClipboard(text)` using `pbcopy` (darwin), `wl-copy`/`xclip`/`xsel` (linux); detect availability and fail gracefully with a message if none found.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] On macOS, copied text is retrievable via `pbpaste`
- [ ] When no clipboard tool is present, returns a handled failure (no unhandled throw) and tells the user
- [ ] Text with newlines/quotes is copied without shell-escaping corruption (no string interpolation into a shell)

**Agent:** nodejs-cli-senior-engineer

**Priority:** P1

---

### TASK-018: Result formatting & match highlighting

Create `src/ui/format.ts`: render `SearchResult[]` as aligned rows (id, ✓/✗ status glyph, relative time, cwd, command) with picocolors, highlighting matched query terms in the command and a one-line output snippet. Respect `NO_COLOR`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Matched substrings are visibly highlighted; exit 0 shows ✓ and non-zero shows ✗
- [ ] `NO_COLOR=1` (or non-TTY) disables color codes entirely
- [ ] Very long commands/cwd are truncated to terminal width without breaking column alignment

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003, TASK-016
**Priority:** P1

---

### TASK-019: `bsc init zsh` command

Create `src/commands/init.ts`: print the install-variant zsh snippet (TASK-013) to stdout with a one-line comment telling the user to add `eval "$(bsc init zsh)"` to `.zshrc`. Error on unsupported shell arg.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `bsc init zsh` prints valid, sourceable zsh to stdout (nothing else on stdout)
- [ ] `bsc init bash` (or other) exits non-zero with "only zsh supported in v0"
- [ ] Output is pure shell (no color codes) so `eval "$(bsc init zsh)"` works

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-013
**Priority:** P1

---

### TASK-020: `bsc rec` command

Create `src/commands/rec.ts`: create a session in the store, invoke the PTY recorder, end the session on exit, print a one-line "recording → <db>" banner to stderr at start. Exit with the child shell's exit code.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] `bsc rec` opens a subshell; exiting it returns control and ends the session row (`ended_at` set)
- [ ] The startup banner goes to stderr (not stdout) so it doesn't pollute piped capture
- [ ] Nested `bsc rec` inside an existing rec session is detected and refused with a clear message

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-015
**Priority:** P1

---

### TASK-021: `bsc pause` / `resume` / `status` command

Create `src/commands/pause.ts`: `pause` creates the pause marker, `resume` removes it, `status` prints whether recording is paused and the data-dir/db location.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `bsc pause` then `bsc status` reports paused; `bsc resume` then `bsc status` reports active
- [ ] `resume` when not paused is a no-op (no error)
- [ ] `status` prints the resolved DB path so users can verify where data lives

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-005, TASK-014
**Priority:** P1

---

### TASK-022: `bsc search` command (non-interactive)

Create `src/commands/search.ts`: parse `<query>` + `--cwd --success --since --until --limit`, build `SearchFilters` (using TASK-016 to parse times), call `store.search`, and print results via `format`. This is the non-interactive path; the picker is layered in TASK-025.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] `bsc search docker --success --limit 5` returns ≤5 exit-0 results matching "docker"
- [ ] `--since 3w` filters out older rows; `--cwd` restricts by directory prefix
- [ ] An empty result set prints a friendly "no matches" line (exit 0), and an invalid `--since` errors clearly

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-016, TASK-018
**Priority:** P1

---

### TASK-023: `bsc show <id>` command

Create `src/commands/show.ts`: fetch the command + output by id, print a metadata header (command, cwd, branch, exit, time, duration) then the full stored (redacted) output. Error if id not found.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `bsc show <id>` prints the full output block for that command
- [ ] A non-existent id exits non-zero with "command #<id> not found"
- [ ] A hook-sourced command with no output prints the header + "(no output captured)" rather than crashing

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-018
**Priority:** P1

---

### TASK-024: Interactive TUI fuzzy picker

Create `src/ui/picker.ts`: raw-mode keypress loop over a result set — type to fuzzy-narrow, ↑↓ to move, an output-preview pane for the highlighted row (via `getCommandById`), ⏎ copies the selected command to clipboard (TASK-017) and exits, esc/Ctrl-C quits. Restore terminal state on exit.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] Arrow keys move selection and the preview pane updates to the highlighted command's output
- [ ] Enter copies the highlighted command via clipboard util and exits cleanly; esc exits without copying
- [ ] Terminal raw mode is always restored on exit, including on Ctrl-C / error (no broken terminal)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-017, TASK-018
**Priority:** P2

---

### TASK-025: Wire picker into `bsc search`

Modify `src/commands/search.ts`: when stdout is a TTY and `--no-pick` is absent, route results into the picker (TASK-024); otherwise keep the plain list. Add the `--no-pick` flag.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] Interactive TTY run opens the picker; `--no-pick` or a piped/non-TTY run prints the plain list
- [ ] An empty result set does not open an empty picker (prints "no matches" instead)
- [ ] Picker selection result (copied command) is reported to the user after exit

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-022, TASK-024
**Priority:** P2

---

### TASK-026: CLI entry & command registration

Create `src/cli.ts`: `#!/usr/bin/env node` commander program named `bsc`, register `init`, `rec`, `search`, `show`, `pause`, `resume`, `status`; global try/catch that prints clean errors and sets exit codes; `--version`/`--help`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] `bsc --help` lists all subcommands; `bsc --version` prints the package version
- [ ] An unknown subcommand exits non-zero with a helpful message
- [ ] Thrown errors from any command produce a single clean stderr line + non-zero exit (no raw stack dump by default)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-019, TASK-020, TASK-021, TASK-022, TASK-023
**Priority:** P2

---

### TASK-027: CI workflow

Create `.github/workflows/ci.yml`: matrix over `{macos-latest, ubuntu-latest} × node {20, 22}`; steps: checkout, setup-node, `npm ci`, `npm run build`, `npm run lint`, `npm test`. Cache npm.

**Type:** infra
**Effort:** S

**Acceptance Criteria:**
- [ ] Workflow YAML is valid and triggers on push + PR
- [ ] Matrix covers macOS and Linux on node 20 and 22
- [ ] Native deps (`node-pty`, `better-sqlite3`) build in CI (or the job fails loudly rather than skipping)

**Agent:** general-purpose

**Depends on:** TASK-001, TASK-002
**Priority:** P3

---

### TASK-028: README

Create `README.md`: pitch, ASCII architecture diagram, quickstart (`npm i -g`, `bsc init zsh`, `bsc rec`, `bsc search`), a prominent **Privacy** section (local-only, redaction, exclude/pause), and a short **"How this differs from atuin"** note — key point: Backscroll records command **output**, so "the one that worked" is answerable.

**Type:** docs
**Effort:** M

**Acceptance Criteria:**
- [ ] Quickstart commands match the actual implemented CLI surface (init/rec/search/show/pause)
- [ ] Privacy section states "100% local, no network" and documents redaction + exclude + pause
- [ ] The atuin comparison explicitly names output-capture as the differentiator

**Agent:** general-purpose

**Depends on:** TASK-026
**Priority:** P3

---

### TASK-029: Redaction tests

Create `test/redaction.test.ts`: cover positive masking (AWS/GitHub/JWT/PEM/`KEY=value`), negative cases (no over-redaction of benign text), and config-driven extra patterns + disable toggle.

**Type:** test
**Effort:** S

**Acceptance Criteria:**
- [ ] All documented secret shapes are masked; benign strings are untouched
- [ ] An extra config pattern masks a custom token
- [ ] `redactionEnabled:false` returns input verbatim

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-009
**Priority:** P2

---

### TASK-030: Capture tests (OSC 133 + segmenter)

Create `test/osc133.test.ts` and `test/segmenter.test.ts`: feed scripted byte streams (including chunk-split markers and a marker-less fallback stream) and assert correct events/blocks.

**Type:** test
**Effort:** M

**Acceptance Criteria:**
- [ ] Two-command marker stream → two correct `OutputBlock`s
- [ ] A marker split across two feeds parses correctly
- [ ] A marker-less stream produces output via heuristic fallback (no crash, no total loss)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-011, TASK-012
**Priority:** P2

---

### TASK-031: Store / search / FTS tests

Create `test/store.test.ts`: against an in-memory db, assert insert→FTS search round-trips, and each filter (`cwd`, `successOnly`, `since`/`until`, `limit`) behaves correctly.

**Type:** test
**Effort:** M

**Acceptance Criteria:**
- [ ] Insert then search by an output term returns the row
- [ ] `successOnly` excludes non-zero exits; `cwd` prefix filter and `limit` cap work
- [ ] `since`/`until` window excludes out-of-range rows

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-022
**Priority:** P2

---

### TASK-032: Recording-gate tests (privacy control)

Create `test/recording-gate.test.ts`: cover the pause/exclude privacy controls — pause marker honored, exclude-command and exclude-dir patterns reject, and empty exclude lists allow everything.

**Type:** test
**Effort:** S

**Acceptance Criteria:**
- [ ] With the pause marker present, `isPaused()` is true; absent, false
- [ ] A command matching `excludeCommands` and a cwd under `excludeDirs` are both rejected by `shouldRecord`
- [ ] Empty exclude lists allow all commands (default-permissive)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-014
**Priority:** P2

---

### TASK-033: Persist pipeline (gate → redact → insert)

Create `src/capture/persist.ts` and `test/persist.test.ts`. `persist.ts` exports a function that takes an `OutputBlock` + config and: (1) checks `isPaused()` and `shouldRecord()` (TASK-014) — dropping the record if either rejects; (2) runs `redact()` (TASK-009) on command **and** output; (3) calls `insertCommand` (TASK-008). This isolates the storage/privacy decision from PTY mechanics so the **redaction-before-write guarantee is unit-testable** without spawning a shell.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] A normal block is redacted (command + output) and inserted exactly once
- [ ] When paused or when `shouldRecord` rejects, nothing is inserted (verified against a fake/in-memory store)
- [ ] Redaction runs before `insertCommand`, so a block containing a secret never reaches the store unmasked (asserted on the captured insert args)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-008, TASK-009, TASK-014
**Priority:** P1

---

## Failure Modes

| Risk | Affected Tasks | Mitigation |
|------|---------------|------------|
| OSC 133 markers split across PTY read chunks → dropped/garbled segmentation | TASK-011, TASK-012, TASK-015 | Buffer partial sequences in the parser across `feed()` calls; explicit boundary test (TASK-030). |
| Prompt themes (p10k, transient/right-prompt) defeat heuristic fallback | TASK-012 | Markers are primary (deterministic); heuristic is only the safety net and is allowed to be degraded, never fatal. |
| Native deps (`node-pty`, `better-sqlite3`) fail to build on macOS/Linux/CI | TASK-001, TASK-015, TASK-027 | Pin known-good versions; CI matrix builds them on both OSes so breakage is loud, not silent. |
| **Secrets leak into storage before redaction** | TASK-009, TASK-033 | Redaction runs in the persist pipeline *before* `insertCommand`, default-on; unit-tested against captured insert args (TASK-033); DB dir is `0700` and gitignored. |
| **Unbounded output** (`yes`, `cat bigfile`, `tail -f`) OOMs the recorder / bloats the DB | TASK-012, TASK-015 | Per-command `maxOutputBytes` cap (default 1 MB) truncates with a marker and stops buffering (explicit AC, TASK-012). |
| **Synchronous SQLite write + redaction regex on the PTY thread janks the interactive shell** | TASK-009, TASK-015, TASK-033 | `better-sqlite3` is synchronous; the output cap bounds redaction/write cost, persist runs only at `commandEnd` (not per chunk), and WAL keeps writes fast. Full async write queue deferred to v1. |
| PTY teardown leaves the user's terminal in raw mode | TASK-015, TASK-024 | Always restore termios in `finally`/exit handlers, including SIGINT and error paths (explicit AC). |
| FTS index drifts from `commands`/`output` rows | TASK-008 | Single transaction writes all three; store-managed (not multi-table triggers); round-trip test (TASK-031). |
| `search.ts` edited by two tasks → merge conflict | TASK-022, TASK-025 | TASK-025 depends on TASK-022 (sequential on the shared file); no parallel writes. |
| Over-redaction destroys useful history (false positives) | TASK-009 | Negative test cases for benign text; conservative key-name matching; documented `«redacted:KIND»` so users see what happened. |

## Test Coverage Map

| New Codepath | Covering Task | Test Type |
|--------------|--------------|-----------|
| Secret masking on write path | TASK-029 | unit |
| Pause/exclude privacy gate | TASK-032 | unit |
| Persist pipeline: redaction-before-write + drop-when-paused/excluded | TASK-033 | unit |
| OSC 133 marker parsing (incl. split chunks) | TASK-030 | unit |
| Stream → per-command segmentation + fallback | TASK-030 | unit |
| Output cap / truncation marker | TASK-030 | unit |
| Insert + FTS search round-trip | TASK-031 | integration |
| Search filters (cwd/success/since/until/limit) | TASK-031 | integration |
| Schema load / migrate idempotency | TASK-007 (AC) | integration |
| ANSI stripping | TASK-010 (AC) | unit |
| Config defaults / malformed-file tolerance | TASK-006 (AC) | unit |
| zsh snippet emits markers | TASK-013 (AC) | manual/integration |
| `bsc rec` end-to-end capture | TASK-020 (AC) | manual/e2e |
| CLI help/version/unknown-command | TASK-026 (AC) | unit |

## Task Dependencies

```json
{
  "TASK-001": [],
  "TASK-002": [],
  "TASK-003": [],
  "TASK-004": [],
  "TASK-005": ["TASK-003"],
  "TASK-006": ["TASK-003", "TASK-005"],
  "TASK-007": ["TASK-004", "TASK-005"],
  "TASK-008": ["TASK-003", "TASK-007"],
  "TASK-009": ["TASK-003"],
  "TASK-010": [],
  "TASK-011": [],
  "TASK-012": ["TASK-003", "TASK-010", "TASK-011"],
  "TASK-013": ["TASK-003"],
  "TASK-014": ["TASK-005", "TASK-006"],
  "TASK-015": ["TASK-012", "TASK-013", "TASK-033"],
  "TASK-016": [],
  "TASK-017": [],
  "TASK-018": ["TASK-003", "TASK-016"],
  "TASK-019": ["TASK-013"],
  "TASK-020": ["TASK-008", "TASK-015"],
  "TASK-021": ["TASK-005", "TASK-014"],
  "TASK-022": ["TASK-008", "TASK-016", "TASK-018"],
  "TASK-023": ["TASK-008", "TASK-018"],
  "TASK-024": ["TASK-008", "TASK-017", "TASK-018"],
  "TASK-025": ["TASK-022", "TASK-024"],
  "TASK-026": ["TASK-019", "TASK-020", "TASK-021", "TASK-022", "TASK-023"],
  "TASK-027": ["TASK-001", "TASK-002"],
  "TASK-028": ["TASK-026"],
  "TASK-029": ["TASK-009"],
  "TASK-030": ["TASK-011", "TASK-012"],
  "TASK-031": ["TASK-008", "TASK-022"],
  "TASK-032": ["TASK-014"],
  "TASK-033": ["TASK-008", "TASK-009", "TASK-014"]
}
```
