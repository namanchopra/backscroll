/**
 * Static file server for the Backscroll web UI. [TASK-003]
 *
 * Serves files from a single root directory over plain Node `http`, with a
 * single-page-app (SPA) fallback so client-side routes resolve to index.html.
 *
 * Security posture:
 *  - The resolved candidate path is verified to stay inside `rootDir`; any
 *    traversal attempt is answered 403 and the filesystem is never touched
 *    outside the root.
 *  - A restrictive Content-Security-Policy and hardening headers are applied to
 *    EVERY response, including error responses.
 *
 * Uses only Node built-ins (http, fs, path) — no third-party dependencies.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';

/** Map of file extension (lowercase, with dot) to Content-Type. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Resolve a file extension to its Content-Type, defaulting to octet-stream. */
function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Apply security headers required on every response. Must be called before
 * writeHead so the headers are flushed with the status line.
 */
function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/** Send a small text response with the given status code and security headers. */
function sendStatus(res: http.ServerResponse, status: number, message: string): void {
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

/**
 * Stream a known-existing file to the client with the correct Content-Type.
 * On a read-stream error after headers may have been sent, the socket is
 * destroyed; before that, a 500 is returned.
 */
function sendFile(res: http.ServerResponse, filePath: string, size: number): void {
  applySecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Content-Length', String(size));

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      sendStatus(res, 500, 'Internal Server Error');
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

/**
 * Serve a static file (or SPA fallback) from `rootDir` based on the request URL.
 *
 * Never throws: any unexpected error results in a 500 response. Security headers
 * are set on every response, including 403/404/500.
 */
export function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rootDir: string,
): void {
  try {
    const root = path.resolve(rootDir);
    const indexPath = path.join(root, 'index.html');

    // Strip query/hash and decode percent-encoding from the request URL.
    const rawUrl = req.url ?? '/';
    const pathPart = rawUrl.split('?')[0]?.split('#')[0] ?? '/';

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      // Malformed percent-encoding — treat as a bad/forbidden request.
      sendStatus(res, 403, 'Forbidden');
      return;
    }

    // A NUL byte in a path is always hostile.
    if (decodedPath.indexOf('\0') !== -1) {
      sendStatus(res, 403, 'Forbidden');
      return;
    }

    // Map '/' (or empty) to index.html.
    let relative = decodedPath;
    if (relative === '' || relative === '/') {
      relative = 'index.html';
    }
    // Drop the leading slash so path.resolve treats it as relative to root.
    relative = relative.replace(/^\/+/, '');

    // Resolve the candidate and confirm it stays within rootDir.
    const candidate = path.resolve(root, relative);
    const withinRoot = candidate === root || candidate.startsWith(root + path.sep);
    if (!withinRoot) {
      sendStatus(res, 403, 'Forbidden');
      return;
    }

    const hasExtension = path.extname(candidate) !== '';

    fs.stat(candidate, (err, stats) => {
      if (!err && stats.isFile()) {
        sendFile(res, candidate, stats.size);
        return;
      }

      // A directory match (e.g. the root itself) falls through to the SPA index.
      if (!err && stats.isDirectory()) {
        serveIndexFallback(res, indexPath);
        return;
      }

      // Missing file. ENOENT/ENOTDIR are expected; anything else is a 500.
      if (err && err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
        sendStatus(res, 500, 'Internal Server Error');
        return;
      }

      if (hasExtension) {
        // A concrete asset that does not exist → 404.
        sendStatus(res, 404, 'Not Found');
        return;
      }

      // Extensionless and missing → SPA fallback to index.html.
      serveIndexFallback(res, indexPath);
    });
  } catch {
    // Defensive: never let an exception escape this function.
    if (!res.headersSent) {
      sendStatus(res, 500, 'Internal Server Error');
    } else {
      res.destroy();
    }
  }
}

/** Serve index.html for SPA routes; 404 if the index is itself missing. */
function serveIndexFallback(res: http.ServerResponse, indexPath: string): void {
  fs.stat(indexPath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, indexPath, stats.size);
      return;
    }
    if (err && err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      sendStatus(res, 500, 'Internal Server Error');
      return;
    }
    sendStatus(res, 404, 'Not Found');
  });
}
