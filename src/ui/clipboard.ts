/**
 * Clipboard copy. [TASK-017]
 *
 * Text is passed via stdin (never interpolated into a shell) so newlines and
 * quotes survive intact. Falls back across the common Linux tools and reports
 * a handled failure when none are present.
 */
import { spawnSync } from 'child_process';

interface ClipboardTool {
  cmd: string;
  args: string[];
}

function candidates(): ClipboardTool[] {
  if (process.platform === 'darwin') {
    return [{ cmd: 'pbcopy', args: [] }];
  }
  if (process.platform === 'win32') {
    return [{ cmd: 'clip', args: [] }];
  }
  // Linux / other unix: Wayland first, then X11 tools.
  return [
    { cmd: 'wl-copy', args: [] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

export interface CopyResult {
  ok: boolean;
  tool?: string;
  error?: string;
}

/** Copy `text` to the system clipboard. Never throws. */
export function copyToClipboard(text: string): CopyResult {
  const tools = candidates();
  for (const tool of tools) {
    const r = spawnSync(tool.cmd, tool.args, { input: text });
    if (!r.error && r.status === 0) {
      return { ok: true, tool: tool.cmd };
    }
  }
  return {
    ok: false,
    error: `No clipboard tool found (tried: ${tools.map((t) => t.cmd).join(', ')})`,
  };
}
