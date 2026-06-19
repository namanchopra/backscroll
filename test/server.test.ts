/**
 * Loopback HTTP server SECURITY integration test. [TASK-018]
 *
 * Drives a real, listening server instance over the loopback interface using
 * Node's global fetch and asserts the security-critical invariants:
 *  - the socket binds to 127.0.0.1 only (never 0.0.0.0);
 *  - every /api/* route is gated behind the per-instance bearer token, accepted
 *    via either `?token=` or `Authorization: Bearer`, and rejected otherwise;
 *  - static responses carry a restrictive Content-Security-Policy;
 *  - POST /api/rerun records *intent* into the in-memory queue and never
 *    executes anything.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { openDatabase, DB } from '../src/db/database';
import { Store } from '../src/db/store';
import { startServer, RunningServer } from '../src/server/server';
import { CommandInput } from '../src/types';

/** The command text we seed so /api/rerun has a target with id 1. */
const SEEDED_COMMAND = 'echo hello-backscroll';

let db: DB;
let staticDir: string;
let server: RunningServer;

beforeAll(async () => {
  // A temp static root with a minimal index.html so the static path can serve.
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-server-test-'));
  fs.writeFileSync(
    path.join(staticDir, 'index.html'),
    '<!doctype html><html><head><title>bsc</title></head><body>ok</body></html>',
    'utf8',
  );

  db = openDatabase(':memory:');
  const store = new Store(db);

  const input: CommandInput = {
    sessionId: null,
    command: SEEDED_COMMAND,
    cwd: '/tmp',
    gitBranch: null,
    exitCode: 0,
    startedAt: Date.now(),
    durationMs: 12,
    source: 'pty',
    output: 'hello-backscroll\n',
  };
  const id = store.insertCommand(input);
  expect(id).toBe(1); // /api/rerun targets id 1

  // startServer resolves only once the socket is listening, so awaiting it is
  // sufficient to guarantee readiness — no extra polling required.
  server = await startServer({ store, staticDir });
});

afterAll(async () => {
  if (server) await server.close();
  if (db) db.close();
  if (staticDir) fs.rmSync(staticDir, { recursive: true, force: true });
});

describe('startServer — loopback bind', () => {
  it('binds 127.0.0.1 (and never 0.0.0.0) and serves the API there', async () => {
    expect(server.url).toContain('127.0.0.1');
    expect(server.url).not.toContain('0.0.0.0');

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/stats?token=${server.token}`,
    );
    expect(res.status).toBe(200);
  });
});

describe('startServer — token gate on /api/*', () => {
  it('rejects with 401 when no token is presented', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/stats`);
    expect(res.status).toBe(401);
  });

  it('accepts the token via the ?token= query param', async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/stats?token=${server.token}`,
    );
    expect(res.status).toBe(200);
  });

  it('accepts the token via the Authorization: Bearer header', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/stats`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects with 401 when a wrong token is presented', async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/stats?token=not-the-real-token`,
    );
    expect(res.status).toBe(401);
  });
});

describe('startServer — CSP on static responses', () => {
  it("includes default-src 'self' in the content-security-policy header", async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/?token=${server.token}`,
    );
    expect(res.status).toBe(200);

    const csp = res.headers.get('content-security-policy');
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
  });
});

describe('startServer — /api/rerun records intent without executing', () => {
  it('queues the command text and returns it without running it', async () => {
    expect(server.rerun).toHaveLength(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/rerun`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ id: 1 }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; command: string };
    expect(body).toEqual({ ok: true, command: SEEDED_COMMAND });

    // The intent queue grew by exactly the seeded command. Because server.ts
    // imports no child_process, the only observable effect is this enqueue —
    // nothing was executed.
    expect(server.rerun).toContain(SEEDED_COMMAND);
    expect(server.rerun).toHaveLength(1);
  });
});
