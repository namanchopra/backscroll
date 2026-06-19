#!/usr/bin/env node
/**
 * Backscroll CLI entry. [TASK-026]
 *
 * Registers subcommands and wraps execution in a single error boundary so a
 * thrown error becomes one clean stderr line + non-zero exit, not a stack dump.
 */
import { Command } from 'commander';
import pc from 'picocolors';
import { bscVersion } from './version';
import { initCommand } from './commands/init';
import { recCommand } from './commands/rec';
import { searchCommand, SearchOptions } from './commands/search';
import { showCommand } from './commands/show';
import { pauseCommand, resumeCommand, statusCommand } from './commands/pause';
import { captureHookCommand, CaptureHookOptions } from './commands/capture-hook';
import { importCommand, ImportOptions } from './commands/import';
import { uiCommand, UiOptions } from './commands/ui';
import { closeDb } from './db/database';

function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${pc.red('bsc:')} ${message}\n`);
  // Set the code and return so the .finally() below still closes the DB
  // (which checkpoints the WAL); process.exit() here would skip it.
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('bsc')
    .description('Backscroll — a searchable time machine for your terminal (commands + output).')
    .version(bscVersion(), '-v, --version');

  program
    .command('init')
    .argument('<shell>', 'shell to generate integration for (zsh)')
    .option('--auto-record', 'auto-wrap every interactive shell in a recording session (captures output everywhere)')
    .description('print shell integration to add to your rc file')
    .action((shell: string, opts: { autoRecord?: boolean }) => {
      process.exitCode = initCommand(shell, Boolean(opts.autoRecord));
    });

  program
    .command('rec')
    .description('launch a recording shell (captures commands + output)')
    .action(async () => {
      process.exitCode = await recCommand();
    });

  program
    .command('search')
    .argument('[query]', 'full-text query over commands and output')
    .option('--cwd <path>', 'only commands run under this directory')
    .option('--success', 'only commands that exited 0')
    .option('--since <when>', 'only commands since (e.g. 3w, 2d, 45m, or ISO date)')
    .option('--until <when>', 'only commands until (e.g. 1w or ISO date)')
    .option('--limit <n>', 'maximum results (default 50)')
    .option('--no-pick', 'print a plain list instead of the interactive picker')
    .description('search recorded commands and their output')
    .action(async (query: string | undefined, opts: SearchOptions) => {
      process.exitCode = await searchCommand(query, opts);
    });

  program
    .command('show')
    .argument('<id>', 'command id (from search results)')
    .description('print the full output of a past command')
    .action((id: string) => {
      process.exitCode = showCommand(id);
    });

  program
    .command('import')
    .description('backfill existing shell history (~/.zsh_history, ~/.bash_history)')
    .option('--zsh', 'import zsh history only')
    .option('--bash', 'import bash history only')
    .option('--file <path>', 'import a specific history file')
    .action((opts: ImportOptions) => {
      process.exitCode = importCommand(opts);
    });

  program
    .command('ui')
    .description('open the web UI to browse history in your browser (local-only)')
    .option('--no-open', 'do not open a browser automatically')
    .option('--port <n>', 'port to listen on (default: an OS-assigned port)')
    .action(async (opts: UiOptions) => {
      process.exitCode = await uiCommand(opts);
    });

  program.command('pause').description('pause recording').action(() => {
    process.exitCode = pauseCommand();
  });
  program.command('resume').description('resume recording').action(() => {
    process.exitCode = resumeCommand();
  });
  program.command('status').description('show recording status and data location').action(() => {
    process.exitCode = statusCommand();
  });

  // Hidden — invoked by the zsh integration's precmd hook.
  program
    .command('capture-hook', { hidden: true })
    .option('--cmd-b64 <b64>')
    .option('--cwd-b64 <b64>')
    .option('--branch-b64 <b64>')
    .option('--exit <code>')
    .option('--dur <ms>')
    .action((opts: CaptureHookOptions) => {
      process.exitCode = captureHookCommand(opts);
    });

  await program.parseAsync(process.argv);
}

main()
  .catch(fail)
  .finally(() => {
    try {
      closeDb();
    } catch {
      /* nothing to close */
    }
  });
