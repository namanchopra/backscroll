/**
 * `bsc ui` — serve the built web UI on a loopback HTTP server. [TASK-006]
 *
 * Resolves the compiled SPA (dist-ui/), starts the token-gated loopback server
 * from ../server/server, optionally opens the default browser at the URL, then
 * blocks until SIGINT/SIGTERM. On stop it flushes any re-run intent the UI
 * queued to STDOUT so `eval "$(bsc ui)"` can execute the chosen command — all
 * human-facing chrome (the banner, the URL) goes to STDERR to keep stdout clean.
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import pc from 'picocolors';
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { startServer } from '../server/server';

export interface UiOptions {
  open?: boolean;
  port?: string;
}

/**
 * Launch the platform's default browser at `url` without blocking or failing
 * the command. The child is fully detached with stdio ignored; any error
 * (missing opener binary, spawn failure) is swallowed — opening the browser is
 * a convenience, never a hard requirement.
 */
function openBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the (ignored) window title so
      // a quoted URL is not mistaken for it.
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* opener missing or failed to launch — ignore */
    });
    child.unref();
  } catch {
    /* never fail the command because the browser could not be opened */
  }
}

export async function uiCommand(opts: UiOptions): Promise<number> {
  const staticDir = path.join(__dirname, '..', '..', 'dist-ui');
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
    process.stderr.write(
      'bsc: web UI not built — run `npm run build` (or `npm run build:ui`) first\n'
    );
    return 1;
  }

  let port: number | undefined;
  if (opts.port !== undefined) {
    if (!/^\d+$/.test(opts.port)) {
      throw new Error(`invalid --port "${opts.port}"`);
    }
    port = Number(opts.port);
  }

  const store = new Store(getDb());
  const server = await startServer({ store, staticDir, port });

  process.stderr.write(
    pc.green('● ') + `Backscroll UI → ${server.url}  (Ctrl-C to stop)\n`
  );

  if (opts.open !== false) {
    openBrowser(server.url);
  }

  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });

  await server.close();

  if (server.rerun.length > 0) {
    const last = server.rerun[server.rerun.length - 1];
    if (last !== undefined) {
      process.stdout.write(last + '\n');
    }
  }

  return 0;
}
