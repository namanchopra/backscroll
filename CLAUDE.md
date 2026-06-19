# CLAUDE.md — Backscroll

A "time machine for your terminal": a TypeScript Node.js CLI (`bsc`, npm package `backscroll-cli`) that records every shell command **and its output** into a local SQLite/FTS5 store and makes it searchable via CLI, a raw-mode TUI picker, and a local web UI. 100% local, privacy-first. A separate Next.js marketing site lives in `website/`.

- **Repo:** https://github.com/namanchopra/backscroll · **npm:** `backscroll-cli`
- **Stack:** TypeScript (strict, CommonJS), Node ≥20, better-sqlite3 + FTS5, node-pty, commander, picocolors. zsh + macOS/Linux. SPA = React + Vite + Tailwind (`ui/`). Site = Next.js 16 (`website/`).
- **Tests:** Jest + ts-jest, `test/*.test.ts`.

## Layout

```
src/
  cli.ts              # commander entry — registers all subcommands
  commands/           # init, rec, search, show, import, ui, pause, capture-hook
  capture/            # ansi, osc133, segmenter, recording-gate, persist, pty-recorder
  db/                 # database (better-sqlite3), store (only SQL), schema.sql
  server/             # contract, api, server (loopback+token), static  (the `bsc ui` backend)
  redaction/redact.ts # secret masking on the write path
  shell/integration.ts# generated zsh preexec/precmd snippet (OSC 133)
  ui/                 # format, picker (TUI), clipboard
  config.ts paths.ts types.ts util/time.ts history/parse.ts version.ts
ui/                   # the bsc-ui SPA source (builds to dist-ui/)  — CSP-locked, no external requests
website/              # Next.js marketing site (separate package; Vercel root = website)
test/                 # 15 jest suites
```

## Commands

```sh
npm install     # + postinstall: chmods node-pty spawn-helper
npm run build   # tsc -> dist/ (+schema.sql copy) + vite build -> dist-ui/
npm run typecheck && npm run lint && npm test
node dist/cli.js <cmd>      # init|rec|search|show|import|ui|pause|resume|status
```

## Non-negotiable invariants

1. **Redaction before storage** — all output is `redact()`-ed before `Store.insertCommand` (via `persistBlock` / hook / import). Never insert raw output.
2. **No server-side shell execution** — `src/server/*` imports no `child_process`. Re-run only *queues* a command; the CLI prints it on exit. (Asserted by tests.)
3. **Loopback + token** — the web server binds `127.0.0.1` only; every `/api/*` is token-gated. Never bind `0.0.0.0` or add an ungated route.
4. **FTS in one transaction** — `commands` + `output` + `search_fts` are written together in `insertCommand`.
5. **CSP-safe SPA** — `ui/` and `dist-ui/` make no external requests (system fonts + inline SVG). `website/` is exempt.
6. **DB access only via `getDb()` + `Store`.** Exit codes via `process.exitCode` (never `process.exit` — `closeDb()` runs in `finally`).

## Project Documentation

@.claude/claude-md-refs/architecture.md
@.claude/claude-md-refs/development-guide.md
@.claude/claude-md-refs/exports-reference.md

## Quick Documentation Reference

| Need help with | See |
|----------------|-----|
| Adding a command / API endpoint / redaction rule; build & release | development-guide.md |
| System structure, capture/web lifecycles, routes, state machines, privacy model | architecture.md |
| Finding a module, `Store` method, type, DTO, or CLI command | exports-reference.md |
