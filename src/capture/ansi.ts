/* eslint-disable no-control-regex -- matching ESC/BEL control bytes is the whole point here */
/**
 * ANSI escape-sequence stripping. [TASK-010]
 *
 * Stored and searchable output is plain text — we drop colour/cursor control
 * sequences AND OSC strings (e.g. the OSC 7 "current directory" and OSC 0/2
 * title reports many shells emit, which would otherwise leak `file://host/...`
 * noise into captured output).
 */

// OSC: ESC ] ... terminated by BEL (\x07) or ST (ESC \). Non-greedy.
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// CSI: ESC [ params intermediates final-byte (covers SGR colour, cursor moves).
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Other two-byte escapes (ESC + a single command byte) and stray ESC/CSI bytes.
const ESC_SEQ = /\x1b[@-Z\\-_]/g;
const STRAY = /[\x1b\x9b]/g;

/** Remove ANSI/OSC escape sequences from a string. */
export function stripAnsi(input: string): string {
  return input
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(ESC_SEQ, '')
    .replace(STRAY, '');
}
