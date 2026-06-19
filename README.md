# Backscroll (`bsc`)

> A time machine for your terminal — records every command **and its output** into a local, searchable store.

Scroll back through everything you've ever run — **including the OUTPUT**, so you can find the one that actually worked.

---

## What it is / why

Your shell history remembers the *command*. It forgets the *result*.

So three weeks later, when you're staring at a half-dozen near-identical `docker run` invocations in your history, you have no way to tell which one actually came up clean and which one died with a port conflict. The thing that proved it worked — the output — was scrolled away and lost the moment your terminal buffer rolled over.

Backscroll records both. Every command you run inside a recording shell is captured **with its output**, redacted, and stored in a local SQLite database with a full-text index over the command text *and* what it printed. Then you can ask the question you actually care about:

> *"What was that command 3 weeks ago that actually worked?"*

...and answer it by searching what it printed — `bsc search "listening on :8080"` — not by guessing from the command alone.

It's 100% local. Nothing ever leaves your machine.

---

## Architecture

Backscroll captures in **two cleanly separated layers**.

```
  ┌──────────────────────────────────────────────────────────────┐
  │                          bsc (CLI)                             │
  │   init · rec · search · show · pause · resume · status         │
  └──────────────────────────────────────────────────────────────┘

  LAYER 2 — OUTPUT (per-session, via `bsc rec`)
  ─────────────────────────────────────────────────────────────────
      bsc rec
        │ spawns your $SHELL under a PTY
        ▼
   ┌──────────────┐   raw bytes (tee'd)   ┌──────────────────────┐
   │  node-pty    │ ────────────────────▶ │      segmenter        │
   │  subshell    │                       │  • OSC 133 markers    │
   └──────────────┘                       │    (A/C/D envelope)   │
        ▲                                 │  • ANSI strip         │
        │ auto-sources the same           │  • output cap         │
        │ zsh integration (OSC 133)       │    (maxOutputBytes)   │
        │                                 └───────────┬───────────┘
        │                                   per-command OutputBlock
        │                                             ▼
  LAYER 1 — METADATA (always-on, via the zsh hook)   │
  ─────────────────────────────────────────────────  │
   eval "$(bsc init zsh)"  → precmd/preexec hooks     │
        │  emit OSC 133 + call `bsc capture-hook`     │
        │  (lightweight metadata-only rows)           │
        └──────────────────────┬──────────────────────┘
                               ▼
                  ┌──────────────────────────────┐
                  │      persist pipeline         │
                  │  recording-gate (pause /      │
                  │  exclude)  →  redaction       │
                  │  (BEFORE write)  →  store      │
                  └───────────────┬──────────────┘
                                  ▼
                  ┌──────────────────────────────┐
                  │        SQLite + FTS5          │
                  │  sessions · commands · output │
                  │  search_fts(command, output)  │
                  └──────────────────────────────┘
```

**Layer 1 — Metadata (always-on, lightweight): shell hooks.** `eval "$(bsc init zsh)"` in your `~/.zshrc` wires zsh's `preexec`/`precmd` hooks. They emit [OSC 133](https://gitlab.freedesktop.org/Per_Bothner/specifications/-/blob/master/proposals/semantic-prompts.md) shell-integration sequences and call a hidden `bsc capture-hook` to record lightweight metadata — command text, cwd, git branch, exit code, duration — even outside a recording session. This is the atuin-equivalent layer.

**Layer 2 — Output (per session): the PTY wrapper.** `bsc rec` spawns your `$SHELL` under a pseudo-terminal via `node-pty`, with the same zsh integration auto-sourced so segmentation works without you having run `init`. Every byte of the terminal stream is tee'd to a **segmenter** that uses the injected OSC 133 markers (`A` prompt-start, `C` command-start with a base64 cmd/cwd/branch payload, `D` command-end with exit code + duration) to slice the stream into per-command blocks. Each block is ANSI-stripped and capped at `maxOutputBytes`, then handed to the **persist pipeline**: the recording-gate (pause + exclude checks) and redaction run **before** anything is written, then the store commits `commands` + `output` + the FTS index in a single transaction. Hooks can't see output; the PTY can — that's what makes "the one that worked" answerable.

---

## Quickstart

Backscroll isn't published to npm yet, so install it by building from source. Requires **Node.js 20+** (native deps `node-pty` and `better-sqlite3` build on install).

```sh
git clone https://github.com/your-org/backscroll.git
cd backscroll
npm install
npm run build
npm link        # puts `bsc` on your PATH
```

Wire up the always-on metadata hooks by adding this to your `~/.zshrc`:

```sh
eval "$(bsc init zsh)"
```

Open a new shell so the hooks load, then start a recording session and run a few commands:

```sh
bsc rec                                  # launches a recording subshell
# ... run some commands, e.g. `docker run --rm -p 8080:80 nginx:alpine` ...
exit                                     # leave the subshell to stop recording
```

Now search across everything you recorded — commands **and** their output:

```sh
bsc search "docker run" --cwd ~/work --success --since 3w
```

On a TTY this opens an interactive fuzzy picker (↑↓ to move, type to filter, ⏎ copies the selected command to your clipboard, esc to quit). Pick a result and inspect its full stored output by id:

```sh
bsc show 1421
```

> `bsc rec` only works under **zsh** in v0. The integration the picker, hooks, and segmenter rely on is currently zsh-only.

---

## Commands

| Command | What it does |
| --- | --- |
| `bsc init zsh` | Print the zsh integration to add to your `~/.zshrc` via `eval "$(bsc init zsh)"`. zsh only in v0. |
| `bsc rec` | Launch a PTY-wrapped recording shell that captures commands + output. Exit the shell to stop. |
| `bsc search [query] [flags]` | Full-text search over commands **and** output. Opens an interactive picker on a TTY; prints a plain list when piped or with `--no-pick`. |
| `bsc show <id>` | Print the full stored (redacted) output of a past command, with a metadata header. |
| `bsc pause` | Pause recording (no commands are stored until you resume). |
| `bsc resume` | Resume recording. |
| `bsc status` | Show paused/active state plus the resolved data dir and DB path. |

### `bsc search` flags

| Flag | Effect |
| --- | --- |
| `--cwd <path>` | Only commands run under this directory (prefix match). |
| `--success` | Only commands that exited `0`. |
| `--since <when>` | Only commands since — relative (`3w`, `2d`, `45m`, `1mo`) or an ISO date. |
| `--until <when>` | Only commands until — relative (e.g. `1w`) or an ISO date. |
| `--limit <n>` | Maximum results (default `50`). |
| `--no-pick` | Print a plain list instead of opening the interactive picker. |

---

## Privacy

Privacy is a first-class feature, not a footnote.

- **100% local. No network. Ever.** Backscroll makes zero network calls. There is no sync, no telemetry, no cloud. Everything lives in one directory on your machine.
- **Redaction runs on the write path, before anything is stored.** Both the command text and its output pass through the redactor *before* they reach SQLite — a secret never lands in the database unmasked. Redaction is **default-on**. It masks:
  - `KEY=value` style secret assignments (keys matching `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*PASSWD*`, `*CREDENTIAL*`, `*PRIVATE*`, plus `--token=…` / `Authorization: …`).
  - Known token shapes: AWS access/secret keys, GitHub (`ghp_`/`gho_`), Slack (`xox…`), Google keys, JWTs (`eyJ…`), PEM `-----BEGIN … PRIVATE KEY-----` blocks, bearer tokens, and URL-embedded credentials.
  - It deliberately does **not** mask bare hex/git SHAs, to avoid over-redacting your actual history.

  Matches are replaced with a visible `«redacted:KIND»` marker so you can see what happened.
- **Exclude commands and directories.** Use `excludeCommands` / `excludeDirs` in your config to drop whole commands or any work under sensitive directories — they're never recorded at all.
- **Pause whenever you want.** `bsc pause` stops all recording (a marker file); `bsc resume` re-enables it. `bsc status` tells you which state you're in.
- **The data directory is owner-only.** It's created with `0700` permissions (no group/other read) and your `.gitignore` already excludes `*.sqlite*` so the database can never be committed.
- **Output is capped per command.** `maxOutputBytes` (default 1 MB) bounds how much output any single command can store, so a runaway `yes` or `tail -f` can't bloat the DB — overflow is truncated with a `…[truncated N bytes]` marker.

### Where data lives

Everything is written under one directory, resolved in this order:

1. `$BACKSCROLL_DIR` (if set)
2. `$XDG_DATA_HOME/backscroll`
3. `~/.local/share/backscroll`

Inside it: `backscroll.sqlite` (the database) and `config.json` (your settings). Run `bsc status` to print the exact resolved paths.

---

## Configuration

Configuration is optional — sensible defaults apply if there's no file. To customize, create `config.json` in your data directory (see [Where data lives](#where-data-lives)). All keys:

```json
{
  "redactionEnabled": true,
  "redactionExtraPatterns": [
    "MY_INTERNAL_TOKEN_[A-Za-z0-9]{20,}"
  ],
  "excludeCommands": [
    "*vault*",
    "kubectl * secret*"
  ],
  "excludeDirs": [
    "~/secrets",
    "*/private/*"
  ],
  "maxOutputBytes": 1000000
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `redactionEnabled` | boolean | `true` | Master switch for secret redaction. Leave on. |
| `redactionExtraPatterns` | string[] | `[]` | Extra regex source strings; matches are masked in addition to the built-ins. |
| `excludeCommands` | string[] | `[]` | Glob/substring patterns; matching commands are never recorded. |
| `excludeDirs` | string[] | `[]` | Glob/substring/prefix patterns; commands run under matching directories are never recorded. |
| `maxOutputBytes` | number | `1000000` | Per-command output cap in bytes. Output beyond this is truncated. |

A missing, empty, or malformed config file never crashes recording — Backscroll warns and falls back to defaults.

---

## How this differs from atuin

[atuin](https://atuin.sh/) is excellent, and Backscroll borrows its always-on metadata-hook idea. The difference is what gets recorded:

- **atuin records your command *history*** — the commands themselves — and can optionally **sync** it to a server across your machines.
- **Backscroll additionally records command *output*** — locally only — so a search can match what a command *printed*, not just what you typed.

That output capture is the whole point. "What was that command 3 weeks ago that actually worked?" isn't answerable from command text alone — half your `docker run` lines look identical. It *is* answerable when you can search the output they produced (`bsc search "Server started on :80" --success`) and read the full result back with `bsc show <id>`.

Backscroll v0 is deliberately **local-only, no sync** — your captured output never leaves your machine.

---

## Status / scope

**v0** targets **macOS and Linux**, **zsh only** (bash and fish are planned for a later release — keeping the fragile marker/hook surface small for now).

**Non-goals for v0** (intentionally out of scope to keep it small):

- No background daemon.
- No sync / no cloud / no network of any kind.
- No web UI or dashboards.

Output is stored ANSI-stripped (raw escape sequences are dropped) in v0.

---

## License

MIT.
