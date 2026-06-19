# Architecture

Backscroll records every shell command **and its output** into a local SQLite/FTS5 store and makes it searchable (CLI, TUI picker, and a local web UI). 100% local, privacy-first.

## Module dependency graph

```
                          src/cli.ts  (commander entry)
                                │
        ┌───────────────┬───────┼────────┬──────────────┬─────────────┐
        ▼               ▼       ▼        ▼              ▼             ▼
   commands/init    commands/rec  commands/search  commands/ui   commands/import   commands/{pause,show,capture-hook}
        │               │            │              │              │
        ▼               ▼            ▼              ▼              ▼
   shell/integration  capture/pty-recorder      server/server   history/parse
        (zsh snippet)      │                         │              │
                           ▼                         ▼              ▼
                    capture/segmenter ──uses──▶ server/api ──▶  redaction/redact
                    capture/osc133              server/static        │
                    capture/ansi                     │               ▼
                           │                          ▼          db/store ──reads──▶ db/schema.sql
                           ▼                    ui/* (CLI TUI)        │
                    capture/persist ──gate+redact──────────────▶ db/database (better-sqlite3, WAL, FTS5)
                    capture/recording-gate                            ▲
                                                                      │
                  config.ts · paths.ts · types.ts · util/time.ts · version.ts  (shared foundation)
```

Everything funnels writes through `db/store.ts` (the only SQL module). `types.ts` has no runtime deps.

## Capture data lifecycle (the headline path)

```
$SHELL under node-pty (rec) ──PTY bytes──▶ Segmenter.feed
   (zsh integration emits OSC 133 + base64 cmd/cwd/branch/exit/dur)
        │                                        │
        │ passthrough to terminal                ▼
        ▼                                  Osc133Parser  (split markers vs output, buffer partial)
   user's screen                                 │  C…D envelope
                                                 ▼
                                          OutputBlock (ANSI-stripped, byte-capped)
                                                 ▼
                                          persistBlock:  isPaused? shouldRecord? → redact(cmd)+redact(out)
                                                 ▼
                                          Store.insertCommand  → commands + output + search_fts  (1 txn)
```

Metadata-only path (`bsc init zsh` without `--auto-record`): `precmd` hook → `bsc capture-hook` → redact → `insertCommand` (`source='hook'`, no output). Import path: `importHistory` → parse files → redact → insert (`source='history'`).

## Web UI request lifecycle

```
bsc ui ──▶ startServer (127.0.0.1:0, random token)
   │              │
   │ opens browser to http://127.0.0.1:<port>/?token=…
   ▼              ▼
 SPA (dist-ui) ── GET /?… ──▶ serveStatic (CSP, SPA fallback)
   │
   └─ fetch /api/* (Authorization: Bearer <token>)
                     │  token gate (constant-time) — 401 if missing/wrong
                     ▼
                  api.ts handler ──▶ Store (read) / setPaused / importHistory / saveConfig / rerun queue
```
On `bsc ui` exit, if the rerun queue is non-empty the chosen command is printed to **stdout** (so `eval "$(bsc ui)"` runs it in the user's shell). The server itself never executes anything.

## Commands & routes

### CLI
| Command | Async | Writes? |
|---------|-------|---------|
| `init <shell> [--auto-record]` | no | no |
| `rec` | yes | sessions + commands(pty) |
| `search [q] [--cwd --success --since --until --limit --no-pick]` | yes | no (read) |
| `show <id>` | no | no |
| `import [--zsh --bash --file]` | no | commands(history) |
| `ui [--no-open --port]` | yes | via API (pause/import/config) |
| `pause` / `resume` / `status` | no | pause marker |
| `capture-hook` (hidden) | no | commands(hook) |

### Web API (all under the `/api/*` token gate, loopback only)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| GET | `/api/search` | handleSearch | token |
| GET | `/api/commands/:id` | handleCommand | token |
| GET | `/api/stats` | handleStats | token |
| POST | `/api/rerun` | handleRerunIntent (queues, no exec) | token |
| GET | `/api/status` | handleStatus | token |
| POST | `/api/pause` | handlePause | token |
| POST | `/api/import` | handleImport | token |
| GET/POST | `/api/config` | handleGetConfig / handleSetConfig | token |
| GET | `/*` | serveStatic (SPA) | none (static, CSP-locked) |

## State machines

### Recording state (global, via pause-marker file)
```
active ⇄ paused        (bsc pause / resume, or /api/pause)
```
| State | Marker file present? | Effect |
|-------|----------------------|--------|
| active | no | `persistBlock`/`capture-hook` record normally |
| paused | yes (`pauseMarkerPath()`) | commands run but nothing is stored |

### Session lifecycle (`rec`)
```
open (ended_at = NULL) ──exit shell──▶ closed (ended_at set)
```
`recCommand` wraps `runRecorder` in try/finally so `endSession` always runs (even if the recorder fails to start).

### Command source
```
pty      — recorded via `bsc rec` / auto-record (HAS output)
hook     — metadata-only from the precmd hook (no output)
history  — imported from shell history files (no output)
```

### Output cap (per command)
```
normal ──(bytes > maxOutputBytes)──▶ truncated (+ "…[truncated, output exceeded N bytes]")
```

## Key subsystems

- **Capture** (`src/capture/`) — node-pty wrapper, OSC-133 tokenizer, stream segmenter (byte-cap + fallback), recording gate, persist pipeline. The riskiest/most central subsystem.
- **Storage & search** (`src/db/`) — better-sqlite3 (WAL, `foreign_keys=ON`), 3 tables + contentless FTS5 maintained transactionally by the store; porter-stemmed full-text + cwd/success/time filters + pagination.
- **Redaction** (`src/redaction/redact.ts`) — secret masking on the write path, default-on, conservative (no bare-hash matching).
- **Web server** (`src/server/`) — Node `http`, loopback bind, one-time token, strict CSP static serving, JSON API; zero `child_process`.
- **Shell integration** (`src/shell/integration.ts`) — generated zsh `preexec`/`precmd` emitting OSC 133; `--auto-record` wraps interactive shells in `bsc rec`.
- **CLI UX** (`src/ui/`, `src/commands/`) — commander wiring, picocolors formatting, raw-mode fuzzy picker, clipboard.

## Privacy & security architecture

- **Local only** — no network egress anywhere in the CLI; data dir is `0700`; DB gitignored (`*.sqlite*`).
- **Redaction before write** — enforced in `persistBlock` and the hook/import paths.
- **Web UI** — `127.0.0.1` only, one-time `crypto` token on every `/api/*`, strict CSP (`default-src 'self'`), `Referrer-Policy: no-referrer`, and **no server-side command execution** (re-run is shell-side via the printed command).

## Data locations

| Path | Contents |
|------|----------|
| `$BACKSCROLL_DIR` / `$XDG_DATA_HOME/backscroll` / `~/.local/share/backscroll` | data dir (`0700`) |
| `<dataDir>/backscroll.sqlite` | the store (sessions/commands/output/FTS) |
| `<dataDir>/config.json` | user config |
| `<dataDir>/paused` | presence = recording paused |

## Build outputs

| Output | From | Shipped to npm? |
|--------|------|-----------------|
| `dist/` | `tsc` + `schema.sql` copy | yes |
| `dist-ui/` | `vite build` (the `bsc ui` SPA, source in `ui/`) | yes |
| `website/.next` | Next.js (marketing site) | no (Vercel only) |
