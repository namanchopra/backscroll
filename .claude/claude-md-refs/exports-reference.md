# Exports Reference

Backscroll is a single-package TypeScript Node.js CLI (`bsc`). Source under `src/`, compiled to `dist/`. A separate Next.js marketing site lives in `website/` (documented at the end).

## CLI commands (`src/commands/`, registered in `src/cli.ts`)

| Command | File | Purpose |
|---------|------|---------|
| `init <shell>` | `commands/init.ts` | Print the zsh integration snippet (`--auto-record` for always-on output capture). zsh only. |
| `rec` | `commands/rec.ts` | Launch a PTY-wrapped recording shell (captures commands + output). Creates/ends a session. |
| `search [query]` | `commands/search.ts` | FTS search over commands + output; flags `--cwd --success --since --until --limit --no-pick`. Opens picker on a TTY. |
| `show <id>` | `commands/show.ts` | Print a past command's full stored output + metadata header. |
| `import` | `commands/import.ts` | Backfill `~/.zsh_history` / `~/.bash_history` (`--zsh --bash --file`). Exports `importHistory()` (reusable) + `importCommand()`. |
| `ui` | `commands/ui.ts` | Start the loopback web server + open the SPA (`--no-open --port`). Prints queued re-run on exit. |
| `pause` / `resume` / `status` | `commands/pause.ts` | Toggle the pause marker; `status` shows paused state + data dir + db path. |
| `capture-hook` (hidden) | `commands/capture-hook.ts` | Called by the zsh `precmd` hook to write a metadata-only (`source='hook'`) row. Never disrupts the shell. |

## Core modules

| Module | Key exports | Purpose |
|--------|-------------|---------|
| `cli.ts` | `main()` (bin entry) | Commander program, subcommand registration, error boundary, `closeDb()` in finally. |
| `version.ts` | `bscVersion()` | Resolve package version from `package.json` at runtime. |
| `types.ts` | (see Domain Types) | Shared domain types — no runtime code. |
| `paths.ts` | `dataDir`, `dbPath`, `configPath`, `pauseMarkerPath`, `ensureDataDir` | Resolve the `0700` data dir (`$BACKSCROLL_DIR` → `$XDG_DATA_HOME` → `~/.local/share/backscroll`). |
| `config.ts` | `DEFAULT_CONFIG`, `loadConfig`, `mergeConfig`, `saveConfig` | Load/merge/save `config.json`; tolerant of missing/malformed files. |

## Storage (`src/db/`)

| Item | Purpose |
|------|---------|
| `database.ts` → `openDatabase(file?)`, `getDb()`, `closeDb()` | Open better-sqlite3, apply `schema.sql` (idempotent), set WAL + foreign_keys. `:memory:` for tests. |
| `schema.sql` | Tables `sessions`, `commands`, `output` + contentless FTS5 `search_fts(command, output)`. |
| `store.ts` → `Store` class | Only module that talks SQL. Methods below. |

### `Store` methods

| Method | Purpose |
|--------|---------|
| `createSession(meta)` / `endSession(id, endedAt)` | Open/close a `rec` session row. |
| `insertCommand(input)` | Insert `commands` + `output` + `search_fts` in ONE transaction (FTS can't drift). |
| `search(filters)` | FTS `MATCH` (or recent-order when query empty) + cwd/success/since/until + limit/offset → `SearchResult[]`. |
| `countCommands(filters)` | Same WHERE as `search`, ignoring limit/offset (pagination totals). |
| `getStats()` | `{ total, bySource, firstAt, lastAt }`. |
| `getCommandById(id)` / `getRecentCommands(limit)` | Fetch full record(s) incl. output. |
| `existingHistoryKeys()` | `Set<"<started_at> <command>">` of `source='history'` rows — makes `import` idempotent. |

## Capture pipeline (`src/capture/`)

| Module | Key exports | Purpose |
|--------|-------------|---------|
| `ansi.ts` | `stripAnsi(s)` | Strip ANSI/OSC escape sequences from stored output. |
| `osc133.ts` | `Osc133Parser` (`feed`, `flush`), `Osc133Token` | Tokenize the PTY stream into output text vs. OSC 133 markers; buffers split markers across chunks. |
| `segmenter.ts` | `Segmenter` (`feed`→`OutputBlock[]`, `end`) | Slice stream into per-command blocks; UTF-8-byte output cap + whitespace-trim; heuristic fallback when no markers. |
| `recording-gate.ts` | `isPaused`, `setPaused`, `shouldRecord` | Privacy gate: pause marker + exclude command/dir patterns (glob/prefix). |
| `persist.ts` | `persistBlock(block, config, deps, sessionId)` | gate → redact (command + output) → `insertCommand`. Returns id or null (dropped). Injectable deps for tests. |
| `pty-recorder.ts` | `runRecorder(deps)` | node-pty spawn of `$SHELL` w/ temp ZDOTDIR; tees output to segmenter; restores termios on all exits. |

## Redaction (`src/redaction/redact.ts`)

| Export | Purpose |
|--------|---------|
| `redact(text, config)` | Mask secrets on the write path (KEY=value, AWS/GitHub/Slack/Google/JWT/PEM/bearer/URL-creds). `«redacted:KIND»`. Returns verbatim if `redactionEnabled:false`. Does NOT mask bare hashes (avoids over-redaction). |
| `builtinRuleKinds` | Ordered list of built-in rule kinds (for tests). |

## Shell integration (`src/shell/integration.ts`)

| Export | Purpose |
|--------|---------|
| `zshSnippet({forRec?, autoRecord?})` | Generate the zsh `preexec`/`precmd` snippet (emits OSC 133 + base64 payload; `--auto-record` prepends the shell-wrap guard). |
| `SUPPORTED_SHELLS` | `['zsh']`. |

## Web server (`src/server/`)

| Module | Key exports | Purpose |
|--------|-------------|---------|
| `contract.ts` | (see DTOs) | API request/response shapes (mirrored in `ui/src/api-types.ts`). |
| `api.ts` | `ApiReply`, handlers below | HTTP-agnostic handlers `(store, params) → {status, json}`. Imports NO `child_process`. |
| `server.ts` | `startServer(opts)`, `RunningServer` | Node `http` server bound to `127.0.0.1:0`, one-time `crypto` token gate on `/api/*`, routing, rerun queue. Never spawns a process. |
| `static.ts` | `serveStatic(req, res, rootDir)` | Serve the built SPA with strict CSP, `nosniff`, `no-referrer`, traversal-safe, SPA fallback. |

### API handlers (`api.ts`) → routes (`server.ts`)

| Handler | Route | Purpose |
|---------|-------|---------|
| `handleSearch` | `GET /api/search` | Parse query params (incl. since/until via `parseTimeSpec`), `search` + `countCommands`. 400 on bad time. |
| `handleCommand` | `GET /api/commands/:id` | Full command detail or 404. |
| `handleStats` | `GET /api/stats` | `ApiStats`. |
| `handleRerunIntent` | `POST /api/rerun` | Push command to the rerun queue (NEVER executes). |
| `handleStatus` | `GET /api/status` | paused, dataDir, dbPath, version, total. |
| `handlePause` | `POST /api/pause` | `setPaused(bool)`. |
| `handleImport` | `POST /api/import` | Run `importHistory` (no shell exec). |
| `handleGetConfig` / `handleSetConfig` | `GET`/`POST /api/config` | Read/validate-and-save config. |

## UI helpers (`src/ui/`) & utils

| Module | Key exports | Purpose |
|--------|-------------|---------|
| `ui/format.ts` | `formatResults`, `formatCommandHeader` | picocolors result rendering + match highlighting (CLI). |
| `ui/picker.ts` | `runPicker(results, store, opts)` | Raw-mode TUI fuzzy picker → clipboard. |
| `ui/clipboard.ts` | `copyToClipboard(text)` | pbcopy/wl-copy/xclip/xsel; never throws. |
| `util/time.ts` | `parseTimeSpec(input, now)`, `humanizeRelative`, `humanizeDuration` | Relative/ISO parse (rejects bare numbers); humanize. |
| `history/parse.ts` | `parseZshHistory`, `parseBashHistory` | Parse history files → `HistoryEntry[]` (timestamp + command). |

## Domain types (`src/types.ts`)

| Type | Purpose |
|------|---------|
| `CommandSource` | `'pty' \| 'hook' \| 'history'`. |
| `SessionRecord` | A `rec` session. |
| `CommandRecord` | A stored command (full, incl. output). |
| `CommandInput` | Insert payload. |
| `OutputBlock` | Segmenter output (command + captured output + truncated flag). |
| `SearchFilters` | `query, cwd?, successOnly?, since?, until?, limit?, offset?`. |
| `SearchResult` | A search hit (+ snippet, rank). |
| `BackscrollConfig` | `redactionEnabled, redactionExtraPatterns, excludeCommands, excludeDirs, maxOutputBytes`. |
| `RedactionMatch` | A redaction hit (kind/start/end). |

## API DTOs (`src/server/contract.ts`, mirrored in `ui/src/api-types.ts`)

`ApiResult`, `ApiSearchResponse`, `ApiCommandDetail`, `ApiStats`, `RerunRequest`, `RerunResponse`, `ApiStatus`, `ApiConfig`, `ImportResult`, `PauseRequest`, `ImportRequest`.

## Import patterns

```ts
import { Store } from './db/store';
import { getDb } from './db/database';
import { CommandInput, SearchFilters } from './types';
import { redact } from './redaction/redact';
import { Segmenter } from './capture/segmenter';
import { persistBlock } from './capture/persist';
import { startServer } from './server/server';
import { parseTimeSpec } from './util/time';
```

## `website/` (Next.js 16 marketing site — separate package)

Standalone Next.js App Router app (`website/src/app/`, `website/src/components/{effects,sections,common}`). Not part of the npm package (`files` whitelist = `dist`, `dist-ui`, `scripts/postinstall.js`). Deployed to Vercel with Root Directory = `website`. See `website/README.md`.
