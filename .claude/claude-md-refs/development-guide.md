# Development Guide

How to implement common changes in Backscroll. All examples follow real patterns in `src/`.

## Invariants (do not violate)

1. **Redaction before storage.** Every command/output reaches `Store.insertCommand` only via `persistBlock` (PTY) or after `redact()` (hook/import). Never insert raw user output.
2. **No server-side shell execution.** `src/server/*` must never import `child_process`/spawn/exec. Re-run only *queues* a command string; the CLI prints it on exit. There is a test asserting this (`test/server.test.ts`, `test/api-control.test.ts`).
3. **Loopback + token.** The web server binds `127.0.0.1` only and gates `/api/*` behind a one-time token. Don't add a route outside the gate or bind `0.0.0.0`.
4. **FTS in one transaction.** `commands` + `output` + `search_fts` are written together in `insertCommand`'s transaction. Don't write them separately.
5. **CSP-safe SPA.** `ui/` (the `bsc ui` SPA) and `dist-ui` must make no external requests — system fonts + inline SVG only. (`website/` is exempt — it has no CSP.)

## Build, test, run

```sh
npm install            # also runs scripts/postinstall.js (chmods node-pty spawn-helper)
npm run build          # tsc -> dist/ + copy schema.sql + vite build -> dist-ui/
npm run typecheck      # tsc --noEmit (backend);  npx tsc -p ui/tsconfig.json --noEmit (SPA)
npm run lint           # eslint .
npm test               # jest (test/*.test.ts)
node dist/cli.js <cmd> # run a command without linking
```

## Adding a new CLI command

### 1. Create `src/commands/<name>.ts`
```ts
import { getDb } from '../db/database';
import { Store } from '../db/store';
export function fooCommand(opts: { bar?: string }): number {
  const store = new Store(getDb());
  // ...do work...
  return 0; // exit code
}
```
- Sync commands return `number`; async (e.g. `rec`, `ui`) return `Promise<number>`.
- Read the DB via `getDb()` (singleton) + `new Store(db)`. Never open SQLite directly.
- Print results to **stdout**, status/banners to **stderr** (so piping stays clean).

### 2. Register in `src/cli.ts`
```ts
import { fooCommand } from './commands/foo';
program
  .command('foo')
  .argument('[bar]', 'description')
  .option('--baz', 'description')
  .description('what it does')
  .action((bar, opts) => { process.exitCode = fooCommand({ ...opts, bar }); });
```
- Set `process.exitCode` (don't call `process.exit` — the `.finally(closeDb)` must run).
- Errors thrown in an action are caught by `main().catch(fail)` → one clean stderr line + exit 1.

### 3. Test it (`test/foo.test.ts`) — see Testing below.

## Adding a web API endpoint

### 1. Add the DTO to `src/server/contract.ts` AND mirror it in `ui/src/api-types.ts` (kept in sync by hand).

### 2. Add a handler in `src/server/api.ts`
```ts
export function handleFoo(store: Store, params: URLSearchParams): ApiReply {
  // validate → call Store/services → return
  return { status: 200, json: { /* DTO */ } };
}
```
- Return `ApiReply { status: number; json: unknown }`. 400 for bad input, 404 for missing.
- For time params use `parseTimeSpec(value, Date.now())` inside try → 400 on throw.
- **Never** import `child_process`.

### 3. Route it in `src/server/server.ts` (under the existing `/api/*` token gate)
```ts
if (pathname === '/api/foo') return sendJson(res, handleFoo(store, url.searchParams));
```
POST routes read the JSON body via the existing `readJsonBody` helper.

### 4. Add the client call in `ui/src/api.ts` (reuse the `request()` helper + token) and wire UI.

### 5. Test in `test/api.test.ts` / `test/api-control.test.ts` against an in-memory store.

## Adding a redaction rule

In `src/redaction/redact.ts`, append to `BASE_RULES` (order matters — specific shapes before the generic `assignment` rule):
```ts
{ kind: 'my-token', re: /\bmytok_[A-Za-z0-9]{20,}\b/g, render: () => mask('my-token') },
```
- Keep it conservative — do NOT match bare hex/base64 (git SHAs are legit output).
- Add a positive + negative case to `test/redaction.test.ts`.

## Response / output formats

| Surface | Format |
|---------|--------|
| CLI commands | exit code (0 ok, non-zero error); human output via `picocolors` (`src/ui/format.ts`), respects `NO_COLOR`/non-TTY. |
| Web API | JSON `ApiReply.json`; `Content-Type: application/json` + `nosniff` + CSP. Errors: `{ error: string }` with 4xx/5xx. |
| Search results | `SearchResult` (id, command, cwd, gitBranch, exitCode, startedAt, durationMs, source, snippet, rank). |

## The recording pipeline (reference)

`bsc rec` → `runRecorder` spawns `$SHELL` under node-pty (temp `ZDOTDIR` sources the user rc + `zshSnippet({forRec})`, sets `BACKSCROLL_REC=1`). PTY data is tee'd to stdout AND fed to `Segmenter`, which uses `Osc133Parser` to split on `C…D` markers into `OutputBlock`s. Each block → `persistBlock` → `isPaused`/`shouldRecord` gate → `redact` → `Store.insertCommand`. Output is ANSI-stripped and capped at `maxOutputBytes` (UTF-8 bytes, trimmed to a whitespace boundary so a half-token isn't stored).

To change segmentation, edit `osc133.ts` (marker parsing) + `segmenter.ts` (block assembly). To change the emitted markers, edit `shell/integration.ts` (and keep `osc133.ts` in sync).

## Testing

- Jest + ts-jest, files in `test/*.test.ts`. Run one: `npx jest test/foo.test.ts`.
- **DB tests:** `const db = openDatabase(':memory:'); const store = new Store(db);` in `beforeEach`, `db.close()` in `afterEach`. (`openDatabase` reads `src/db/schema.sql` relative to `__dirname`, which works under ts-jest.)
- **Filesystem (paths/gate/config) tests:** set `process.env.BACKSCROLL_DIR = fs.mkdtempSync(...)` in `beforeEach`; clean up in `afterEach`. `paths.ts` reads the env live, so this isolates from the real data dir.
- **Persist/privacy tests:** inject fakes — `persistBlock(block, config, { insertCommand: capture, isPaused: () => false, shouldRecord: () => true }, sessionId)`.
- **Time tests:** inject `now` (no hidden `Date.now()` in `time.ts`).

## Release (publish to npm)

```sh
# version is in package.json (npm name: backscroll-cli; bin: bsc)
npm publish        # prepublishOnly runs `npm run build` -> ships dist + dist-ui
```
- 2FA: `npm publish --otp=<code>`. `publishConfig.access = public`.
- The published tarball ships `dist`, `dist-ui`, `scripts/postinstall.js`, README, LICENSE (per `files`). Consumers run `postinstall` (chmods node-pty spawn-helper) but do NOT build.

## Marketing site (`website/`)

Standalone Next.js 16 + Tailwind v4. `cd website && npm install && npm run dev` (local) / `npm run build`. Deploy: Vercel, Root Directory = `website`. Do NOT add `outputFileTracingRoot` to `website/next.config.ts` — it breaks the Vercel build (`ENOENT .next/package.json`).
