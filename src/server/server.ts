/**
 * Loopback HTTP server for the Backscroll web UI. [TASK-005]
 *
 * Wires the transport-neutral API handlers (./api) and the static file server
 * (./static) onto a Node `http.Server` bound to 127.0.0.1 only. Every /api/*
 * request is gated behind a per-process bearer token; everything else is served
 * as a static asset (with SPA fallback).
 *
 * Security posture:
 *  - The socket binds to the loopback interface (127.0.0.1) exclusively, never
 *    0.0.0.0, so the API is unreachable from other hosts on the network.
 *  - A random 24-byte token is minted per server instance and required on every
 *    API call (Authorization: Bearer <t> or ?token=<t>). The comparison is
 *    constant-time to avoid leaking the token via timing.
 *  - This server NEVER spawns a process. The /api/rerun endpoint only records
 *    *intent* into an in-memory queue; there is no child_process import here.
 *
 * Uses only Node built-ins (http, crypto, url) — no third-party dependencies.
 */
import http from 'http';
import crypto from 'crypto';

import { Store } from '../db/store';
import {
  ApiReply,
  handleSearch,
  handleCommand,
  handleStats,
  handleRerunIntent,
} from './api';
import { serveStatic } from './static';

/** A live, listening server instance plus the handles needed to use and stop it. */
export interface RunningServer {
  /** Loopback URL including the auth token as a query param, ready to open. */
  url: string;
  /** The actual bound TCP port (resolved even when 0/ephemeral was requested). */
  port: number;
  /** The per-instance bearer token required on every /api/* request. */
  token: string;
  /** In-memory queue of recorded re-run intents (command text). Never executed. */
  rerun: string[];
  /** Stop listening and resolve once the underlying server has fully closed. */
  close(): Promise<void>;
}

/** Options for {@link startServer}. */
export interface StartServerOptions {
  store: Store;
  staticDir: string;
  /** Port to bind; omit or 0 for an OS-assigned ephemeral port. */
  port?: number;
}

/** Maximum bytes we will buffer from a request body before rejecting it. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Constant-time string compare. Returns false on any length mismatch (without
 * leaking which side differs) and otherwise defers to crypto.timingSafeEqual.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Extract the presented token from a Bearer header or `?token=` query param. */
function extractToken(req: http.IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && match[1] !== undefined) return match[1];
  }
  return url.searchParams.get('token');
}

/** Serialise an {@link ApiReply} with JSON content-type and hardening headers. */
function writeJson(res: http.ServerResponse, reply: ApiReply): void {
  res.statusCode = reply.status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.end(JSON.stringify(reply.json));
}

/** Read the full request body as a UTF-8 string, bounded by MAX_BODY_BYTES. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Route and serve a single authenticated /api/* request. The token has already
 * been verified by the caller. Any handler throw becomes a 500 JSON reply.
 */
async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  store: Store,
  rerunQueue: string[],
): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/search') {
      writeJson(res, handleSearch(store, url.searchParams, Date.now()));
      return;
    }

    const commandMatch = /^\/api\/commands\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && commandMatch && commandMatch[1] !== undefined) {
      writeJson(res, handleCommand(store, decodeURIComponent(commandMatch[1])));
      return;
    }

    if (method === 'GET' && pathname === '/api/stats') {
      writeJson(res, handleStats(store));
      return;
    }

    if (method === 'POST' && pathname === '/api/rerun') {
      const raw = await readBody(req);
      let id: unknown;
      try {
        const parsed: unknown = raw.length > 0 ? JSON.parse(raw) : {};
        id = (parsed as { id?: unknown }).id;
      } catch {
        writeJson(res, { status: 400, json: { error: 'invalid JSON body' } });
        return;
      }
      writeJson(res, handleRerunIntent(store, String(id), rerunQueue));
      return;
    }

    writeJson(res, { status: 404, json: { error: 'not found' } });
  } catch {
    // Never surface an internal error or stack trace to the client.
    writeJson(res, { status: 500, json: { error: 'internal server error' } });
  }
}

/**
 * Start a loopback HTTP server backing the web UI.
 *
 * Binds 127.0.0.1 only, mints a random bearer token, and resolves once the
 * socket is listening. API routes require the token; all other paths are served
 * as static assets from `staticDir`.
 */
export function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const { store, staticDir } = opts;
  const token = crypto.randomBytes(24).toString('hex');
  const rerunQueue: string[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname.startsWith('/api/')) {
      const presented = extractToken(req, url);
      if (presented === null || !safeEqual(presented, token)) {
        writeJson(res, { status: 401, json: { error: 'unauthorized' } });
        return;
      }
      void handleApi(req, res, url, store, rerunQueue);
      return;
    }

    serveStatic(req, res, staticDir);
  });

  return new Promise<RunningServer>((resolve, reject) => {
    server.once('error', reject);

    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject);

      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('bsc: failed to determine bound server port'));
        return;
      }

      const port = address.port;
      const url = `http://127.0.0.1:${port}/?token=${token}`;

      resolve({
        url,
        port,
        token,
        rerun: rerunQueue,
        close(): Promise<void> {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}
