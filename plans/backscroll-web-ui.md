# Plan: Backscroll Web UI (`bsc ui`)

> Generated: 2026-06-19
> Branch: `feat/web-ui`
> Mode: EXPANSION

## Overview

`bsc ui` launches a **loopback-only** HTTP server (127.0.0.1, OS-assigned port, one-time token) that serves a React + Vite + Tailwind single-page app for browsing recorded command history. The SPA gives a rich viewing experience the CLI can't: a virtualized list of 10k+ commands, search-as-you-type, success/cwd/time filters, and a scrollable output pane — all read-only against the existing SQLite/FTS5 store. Scope: **view + search + copy + re-run**. Re-run executes **nothing server-side** — it queues the chosen command and `bsc ui` prints it on exit for `eval "$(bsc ui)"` in the user's own shell.

## Scope Challenge

Confirmed with the user (Phase 0): **local web UI** (over TUI / enhanced-picker), **EXPANSION** mode, scope **view+search+copy+re-run**.

**Privacy/security posture (this is the make-or-break of a web UI on a "no network, ever" tool):**
- **Loopback only** — bind `127.0.0.1` explicitly (never `0.0.0.0`). No LAN exposure.
- **One-time token** — random token generated per launch, required on every `/api/*` request; the browser gets it via the opened URL. Stops other local users/processes from reading history.
- **No egress** — strict CSP (`default-src 'self'`); the SPA cannot make external requests. No fonts/CDNs/telemetry.
- **No server-side exec** — the server has no code path that spawns a process. Re-run only records intent; the CLI prints it on exit. This keeps the loopback server from being an RCE surface.
- **Already-redacted data** — the API serves only what's in the store, which was redacted at write time. No raw/un-redacted path exists.
- **Runtime deps unchanged** — server uses Node `http`/`crypto` (no Express). React/Vite/Tailwind are **devDependencies**; the build emits static assets shipped in the package. Production runtime deps stay: better-sqlite3, commander, node-pty, picocolors.

**Ruled out:** TUI (less rich for reading large output), enhanced-picker (not an "app"), server-side re-run (RCE risk), any external asset (breaks no-egress).

## Architecture

```
  bsc ui  [TASK-006/007]
   │ start server, print URL+token, open browser, await exit → print queued re-run
   ▼
 ┌──────────────────────────────────────────────────────────┐
 │ HTTP server  src/server/server.ts  [TASK-005]             │
 │  bind 127.0.0.1 · port 0 (OS) · one-time token · routing  │
 │  rerun queue (NO exec)                                    │
 │   ├── /api/*  ── token gate ──▶ api.ts [TASK-004]         │
 │   │                              search · command · stats │
 │   │                              · rerun-intent           │
 │   └── /*      ──▶ static.ts [TASK-003]  (CSP, dist-ui)    │
 └───────────────┬───────────────────────────┬──────────────┘
                 │ reuse                       │ serves
                 ▼                             ▼
   Store  src/db/store.ts                dist-ui/  (Vite build [TASK-008])
   search(+offset)/count/getStats         ▲
   [TASK-002] · types.ts SearchFilters     │ build
                                           ui/  (React SPA)
   ┌───────────────────────────────────────┴──────────────────────┐
   │ main.tsx[009] → App.tsx[015]                                  │
   │   SearchBar[012] · ResultList(virtualized)[013] · DetailPane  │
   │   [014] (output + copy + re-run)  · util/format[011]          │
   │   api.ts client + api-types mirror [010]  (token from URL)    │
   │   contract DTOs src/server/contract.ts [TASK-001]             │
   └───────────────────────────────────────────────────────────────┘
  tests: api[017] · server-security[018] · store-pagination[019]
  packaging: .gitignore[016] · README[020]
```

## Existing Code Leverage

| Sub-problem | Existing Code | Action |
|-------------|---------------|--------|
| Query history (search, by-id, recent) | `src/db/store.ts` | Extend (add offset, count, stats) |
| Filter shapes | `src/types.ts` (`SearchFilters`, `SearchResult`, `CommandRecord`) | Extend (`offset?`) + reuse |
| Open DB | `src/db/database.ts` (`getDb`) | Reuse as-is |
| Parse `--since/--until` | `src/util/time.ts` (`parseTimeSpec`) | Reuse server-side for query params |
| Redaction | `src/redaction/*` (applied at write) | Reuse implicitly — API serves redacted data |
| CLI registration | `src/cli.ts` | Extend (register `ui`) |
| Terminal picker | `src/ui/picker.ts` | Not reused (web renders its own) |
| HTTP framework | (none — use Node `http`) | Build new, no dep |
| Frontend | (none) | Build new (React/Vite/Tailwind devDeps) |

## Tasks

### TASK-001: API contract DTOs

Create `src/server/contract.ts` defining the JSON shapes shared by server and SPA: `ApiSearchResponse { results: ApiResult[]; total: number; offset: number; limit: number }`, `ApiResult` (id, command, cwd, gitBranch, exitCode, startedAt, durationMs, source, snippet), `ApiCommandDetail` (full CommandRecord shape incl. output), `ApiStats { total: number; bySource: Record<string,number>; firstAt: number|null; lastAt: number|null }`, `RerunRequest { id: number }`, `RerunResponse { ok: boolean; command: string }`. Pure types.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] All DTOs compile under strict mode; no `any`
- [ ] `ApiSearchResponse` includes `total`, `offset`, `limit` for pagination
- [ ] Types are import-safe (no runtime side effects)

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-002: Store pagination, count, and stats

Modify `src/types.ts` to add `offset?: number` to `SearchFilters`. Modify `src/db/store.ts`: honor `offset` in `search()` (`LIMIT @limit OFFSET @offset`); add `countCommands(filters): number` (same WHERE, `SELECT count(*)`); add `getStats(): { total; bySource; firstAt; lastAt }`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] `search({ query, limit: 10, offset: 10 })` returns the second page (rows 11–20), disjoint from offset 0
- [ ] `countCommands(filters)` equals the number of rows the same filters match ignoring limit/offset
- [ ] `getStats()` on an empty store returns `total: 0`, `firstAt: null`, `lastAt: null` without throwing

**Agent:** nodejs-cli-senior-engineer

**Priority:** P0

---

### TASK-003: Static file server with strict CSP

Create `src/server/static.ts`: `serveStatic(req, res, rootDir)` that resolves a request path to a file under `rootDir` (default to `index.html` for SPA routes), sets correct `Content-Type`, and sets security headers on every response: `Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Must reject path traversal (`..`).

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] A request for `/assets/app.js` returns that file with `Content-Type: text/javascript` and the CSP header
- [ ] An unknown non-API path returns `index.html` (SPA fallback)
- [ ] A traversal attempt (`/../../etc/passwd`) is rejected with 403, never escaping `rootDir`

**Agent:** nodejs-cli-senior-engineer

**Priority:** P1

---

### TASK-004: API request handlers

Create `src/server/api.ts`: handlers that take a `Store` and return contract DTOs as JSON. `handleSearch(params)` → parse `q, cwd, success, since, until, limit, offset` (use `parseTimeSpec` for since/until; clamp limit ≤ 200), call `store.search` + `store.countCommands` → `ApiSearchResponse`. `handleCommand(id)` → `ApiCommandDetail` or 404. `handleStats()` → `ApiStats`. `handleRerunIntent(id, queue)` → look up the command, push to the rerun queue, return `RerunResponse` (does NOT execute).

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] `handleSearch` with `success=true&since=3w` returns only exit-0 rows within the window, plus a correct `total`
- [ ] `handleCommand` returns the full output for a valid id and 404 for a missing id
- [ ] `handleRerunIntent` records the command in the queue and returns it, and never spawns a process
- [ ] An invalid `since` (e.g. bare `3`) yields a 400 with a clear message, not a crash

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-001, TASK-002
**Priority:** P1

---

### TASK-005: Loopback HTTP server (token auth, routing, rerun queue)

Create `src/server/server.ts`: `startServer({ store, staticDir }): { url; port; token; rerun: string[]; close() }`. Use Node `http`, listen on `127.0.0.1` port `0` (OS-assigned), generate a random token via `crypto.randomBytes`. Route `/api/*` through a token gate (token from `Authorization` header or `?token=`; 401 otherwise) to `api.ts`; everything else to `static.ts`. Maintain the in-memory rerun queue passed to `handleRerunIntent`. No process is ever spawned here.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] Server binds `127.0.0.1` only (a connection to the machine's LAN IP is refused)
- [ ] `/api/stats` without the token returns 401; with the correct token returns 200
- [ ] `close()` releases the port (a subsequent `startServer` succeeds)

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-003, TASK-004
**Priority:** P1

---

### TASK-006: `bsc ui` command

Create `src/commands/ui.ts`: open the store (`getDb`), resolve the built SPA dir (`dist-ui` relative to the package), `startServer`, print the tokenized URL to stderr, open the browser (`open`/`xdg-open`/`start` via `child_process`, skippable), and await SIGINT. On exit, if the rerun queue is non-empty, print the most recent queued command to **stdout** (so `eval "$(bsc ui)"` runs it), then `close()`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Running it prints a `http://127.0.0.1:<port>/?token=…` URL to stderr (not stdout)
- [ ] On exit with a queued re-run, the chosen command is printed to stdout (nothing else on stdout)
- [ ] If the SPA build dir is missing, it exits non-zero with a clear "run `npm run build`" message rather than serving 404s

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-005
**Priority:** P1

---

### TASK-007: Register `ui` in the CLI

Modify `src/cli.ts`: register the `ui` command with options `--no-open` (don't launch a browser) and `--port <n>` (override the OS-assigned port). Wire to `uiCommand`.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `bsc --help` lists `ui`
- [ ] `bsc ui --no-open` starts the server without spawning a browser
- [ ] `--port` with a non-numeric value errors cleanly via the existing error boundary

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-006
**Priority:** P2

---

### TASK-008: Frontend build tooling (Vite + Tailwind v4)

Modify `package.json`: add devDependencies (`react`, `react-dom`, `@types/react`, `@types/react-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`@4, `@tailwindcss/vite`, `@tanstack/react-virtual`) and scripts (`dev:ui`, `build:ui`); chain `build:ui` into the main `build` script. Create `ui/vite.config.ts` (`root: 'ui'`, `build.outDir: '../dist-ui'`, `base: './'`, plugins: react + tailwind). No new **runtime** deps.

**Type:** infra
**Effort:** M

**Acceptance Criteria:**
- [ ] `npm install` succeeds and `npx vite build` (via `build:ui`) emits to `dist-ui/`
- [ ] `base: './'` so assets load under the served origin with relative URLs
- [ ] The main `npm run build` runs both the tsc/server build and the SPA build

**Agent:** react-vite-tailwind-engineer

**Priority:** P0

---

### TASK-009: SPA entry (index.html, main, styles)

Create `ui/index.html` (root div, module script), `ui/src/main.tsx` (React root mounting `App`), `ui/src/index.css` (`@import "tailwindcss";` plus a dark base). No external font/CDN links (CSP forbids them).

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `build:ui` produces an `index.html` + hashed JS/CSS in `dist-ui/`
- [ ] No `<link>`/`<script>` to any external origin (self-contained)
- [ ] Mounts without console errors against a stubbed empty API

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-008
**Priority:** P1

---

### TASK-010: Frontend API client + mirrored types

Create `ui/src/api-types.ts` (mirror of `src/server/contract.ts` DTOs — kept in sync manually) and `ui/src/api.ts`: a typed fetch client that reads the token from `location.search`, sends it on every request, and exposes `search(filters)`, `getCommand(id)`, `getStats()`, `rerun(id)`. Surfaces 401/4xx as typed errors.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Every request includes the token from the URL
- [ ] A 401 response surfaces a distinct "unauthorized" error the UI can show
- [ ] Types match `contract.ts` (a field rename there is a compile break here)

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-001, TASK-008
**Priority:** P1

---

### TASK-011: Frontend formatting utilities

Create `ui/src/util/format.ts`: `relativeTime(ms, now)` ("3w ago"), `duration(ms)` ("1.2s"/"1m30s"), `statusClass(exitCode)` (color token). Browser-side, no Node imports.

**Type:** feature
**Effort:** S

**Acceptance Criteria:**
- [ ] `relativeTime` returns "just now" for < 1 min and "Nw ago" for weeks
- [ ] `duration(null)` returns a dash, not "NaN"
- [ ] Pure functions, no `Date.now()` baked in (now is injected)

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-008
**Priority:** P1

---

### TASK-012: SearchBar + filters component

Create `ui/src/components/SearchBar.tsx`: a debounced query input, a success-only toggle, a cwd text filter, and since/until inputs; emits a `SearchFilters`-shaped object upward via callback. Tailwind-styled, keyboard-friendly (Esc clears).

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Typing debounces (≤1 callback per ~150ms burst), not one per keystroke
- [ ] Toggling success-only and editing cwd both propagate to the emitted filters
- [ ] Empty query is allowed (browse-all), not blocked

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-010
**Priority:** P1

---

### TASK-013: Virtualized result list

Create `ui/src/components/ResultList.tsx`: a virtualized list (`@tanstack/react-virtual`) over `ApiResult[]`, showing status glyph, relative time, cwd, and command; selectable rows (keyboard ↑↓ + click); requests the next page (offset) on scroll-near-end. Uses `util/format`.

**Type:** feature
**Effort:** L

**Acceptance Criteria:**
- [ ] Rendering 10,000 results keeps the DOM node count bounded (virtualized, not 10k nodes)
- [ ] Scrolling near the end triggers a next-page (offset) fetch exactly once per boundary
- [ ] Selecting a row (click or ↑↓+Enter) invokes the selection callback with the row id

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-010, TASK-011
**Priority:** P1

---

### TASK-014: Detail pane (output viewer + copy + re-run)

Create `ui/src/components/DetailPane.tsx`: given a selected id, fetch the full command via the API, render a metadata header (cwd, branch, exit, time, duration, source) and a scrollable monospace output area; "Copy command" (navigator.clipboard) and "Re-run" (calls `api.rerun(id)` → shows "queued; quit `bsc ui` to run it"). Uses `util/format`.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Selecting a command loads and shows its full output in a scrollable area
- [ ] "Copy" puts the command on the clipboard; a command with no output shows "(no output captured)"
- [ ] "Re-run" calls the rerun endpoint and shows the queued-confirmation; it does NOT execute in the browser/server

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-010, TASK-011
**Priority:** P1

---

### TASK-015: App shell wiring

Create `ui/src/App.tsx`: two-pane layout (list + detail) with a header showing `getStats()` totals; holds filter + selection state; wires `SearchBar` → results query, `ResultList` → selection, `DetailPane` → detail; handles the unauthorized error with a clear message.

**Type:** feature
**Effort:** M

**Acceptance Criteria:**
- [ ] Editing filters updates the list; selecting a row updates the detail pane
- [ ] The header shows total command count from `/api/stats`
- [ ] An unauthorized (bad/missing token) state renders a clear message instead of a blank screen

**Agent:** react-vite-tailwind-engineer

**Depends on:** TASK-009, TASK-010, TASK-012, TASK-013, TASK-014
**Priority:** P1

---

### TASK-016: Package the SPA build output

Modify `.gitignore` to ignore `dist-ui/` (a build artifact). (The `files` array shipping `dist-ui` in npm is owned by TASK-008's package.json edit.)

**Type:** infra
**Effort:** S

**Acceptance Criteria:**
- [ ] `dist-ui/` is gitignored (not committed)
- [ ] `node_modules`/`dist` ignores remain intact
- [ ] No source under `ui/` is ignored

**Agent:** general-purpose

**Priority:** P3

---

### TASK-017: API handler tests

Create `test/api.test.ts`: against an in-memory store with seeded rows, assert `handleSearch` (filters + pagination `total`/`offset`), `handleCommand` (hit + 404), `handleStats`, and `handleRerunIntent` (queues, returns command, spawns nothing).

**Type:** test
**Effort:** M

**Acceptance Criteria:**
- [ ] Search pagination returns correct `total` and disjoint pages
- [ ] Missing-id command request yields 404
- [ ] Rerun-intent pushes to the queue and the handler imports no `child_process`

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-004
**Priority:** P2

---

### TASK-018: Server security integration test

Create `test/server.test.ts`: start the real server, assert it listens on `127.0.0.1`; `/api/stats` without token → 401, with token → 200; a static response carries the CSP header; and the rerun endpoint records intent without executing (queue grows, no process spawned).

**Type:** test
**Effort:** M

**Acceptance Criteria:**
- [ ] Unauthorized API request returns 401; authorized returns 200
- [ ] The server address family/host is loopback (`127.0.0.1`), never `0.0.0.0`
- [ ] A static response includes `Content-Security-Policy: default-src 'self'`

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-005
**Priority:** P2

---

### TASK-019: Store pagination/stats tests

Create `test/store-pagination.test.ts`: against `:memory:`, seed N rows and assert `search` offset paging is disjoint and ordered, `countCommands` matches filtered totals, and `getStats` reports correct totals/first/last (incl. the empty-store edge case).

**Type:** test
**Effort:** S

**Acceptance Criteria:**
- [ ] Page 1 (offset 0) and page 2 (offset = limit) share no rows
- [ ] `countCommands` with a filter equals the number of matching rows
- [ ] `getStats` on an empty store returns zeros/nulls without throwing

**Agent:** nodejs-cli-senior-engineer

**Depends on:** TASK-002
**Priority:** P2

---

### TASK-020: README — `bsc ui` + its privacy guarantees

Modify `README.md`: document `bsc ui` (quickstart, `--no-open`, the `eval "$(bsc ui)"` re-run idiom) and a prominent note on the loopback-only / one-time-token / no-egress / no-server-exec guarantees, plus that the SPA ships pre-built.

**Type:** docs
**Effort:** S

**Acceptance Criteria:**
- [ ] Documents launching, the token URL, and `--no-open`
- [ ] States the four guarantees: 127.0.0.1-only, token-gated, no external egress (CSP), no server-side execution
- [ ] Explains the `eval "$(bsc ui)"` re-run flow accurately

**Agent:** general-purpose

**Depends on:** TASK-007, TASK-015
**Priority:** P3

---

## Failure Modes

| Risk | Affected Tasks | Mitigation |
|------|---------------|------------|
| Server binds `0.0.0.0` → history exposed on LAN | TASK-005 | Explicit `host: '127.0.0.1'`; integration test asserts loopback (TASK-018) |
| Missing/weak API auth → other local users read history | TASK-005, TASK-004 | Random `crypto` token required on all `/api/*`; 401 otherwise; test (TASK-018) |
| **Server-side command execution → RCE** | TASK-004, TASK-005, TASK-006 | Server NEVER spawns; re-run only queues; CLI prints on exit; test asserts no exec (TASK-017/018) |
| CSP missing → SPA coerced into external requests | TASK-003 | Strict `default-src 'self'` on every response; header test (TASK-018) |
| SPA not shipped → `bsc ui` 404s after global install | TASK-008, TASK-006, TASK-016 | `dist-ui` in package `files[]`; `build` chains `build:ui`; ui command errors if dir missing |
| 10k+ rows blow up the DOM | TASK-013, TASK-002 | Virtualized list + server-side offset pagination |
| 1 MB output janks the browser | TASK-014 | Fetch detail on demand; render in a bounded scroll container |
| Port already in use | TASK-005 | Listen on port `0` (OS-assigned); read the actual port back |
| Token leaks via referer to an external site | TASK-003 | `Referrer-Policy: no-referrer` + CSP blocks external nav |
| FE/contract type drift | TASK-001, TASK-010 | Mirror DTOs; field rename breaks the FE build (caught in `build:ui`) |
| Redaction bypass via API | TASK-004 | API serves only stored (already-redacted) data; no raw path |

## Test Coverage Map

| New Codepath | Covering Task | Test Type |
|--------------|--------------|-----------|
| `store.search` offset paging / `countCommands` / `getStats` | TASK-019 | unit |
| API handlers: search params, pagination, 404, rerun-intent | TASK-017 | integration |
| Loopback bind + token 401/200 + CSP header + rerun no-exec | TASK-018 | integration (security) |
| Static serving + traversal rejection | TASK-018 / TASK-003 (AC) | integration |
| `bsc ui` launch + stderr URL + stdout rerun print | TASK-006 (AC) | manual/e2e |
| SPA builds clean (no external assets) | TASK-009 (AC) / CI `build:ui` | build |
| FE filter→query→list→detail interaction | TASK-015 (AC) | manual |

## Task Dependencies

```json
{
  "TASK-001": [],
  "TASK-002": [],
  "TASK-003": [],
  "TASK-004": ["TASK-001", "TASK-002"],
  "TASK-005": ["TASK-003", "TASK-004"],
  "TASK-006": ["TASK-005"],
  "TASK-007": ["TASK-006"],
  "TASK-008": [],
  "TASK-009": ["TASK-008"],
  "TASK-010": ["TASK-001", "TASK-008"],
  "TASK-011": ["TASK-008"],
  "TASK-012": ["TASK-010"],
  "TASK-013": ["TASK-010", "TASK-011"],
  "TASK-014": ["TASK-010", "TASK-011"],
  "TASK-015": ["TASK-009", "TASK-010", "TASK-012", "TASK-013", "TASK-014"],
  "TASK-016": [],
  "TASK-017": ["TASK-004"],
  "TASK-018": ["TASK-005"],
  "TASK-019": ["TASK-002"],
  "TASK-020": ["TASK-007", "TASK-015"]
}
```
