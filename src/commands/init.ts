/**
 * `bsc init <shell>` — print the shell integration snippet. [TASK-019]
 *
 * Output is pure shell (no colour) so `eval "$(bsc init zsh)"` works.
 */
import { zshSnippet, SUPPORTED_SHELLS } from '../shell/integration';

export function initCommand(shell: string): number {
  if (shell !== 'zsh') {
    process.stderr.write(
      `bsc: only zsh is supported in v0 (got "${shell}"). Supported shells: ${SUPPORTED_SHELLS.join(', ')}\n`
    );
    return 1;
  }
  process.stdout.write(`${zshSnippet()}\n`);
  return 0;
}
