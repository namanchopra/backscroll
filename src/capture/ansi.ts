/**
 * ANSI escape-sequence stripping. [TASK-010]
 *
 * Stored and searchable output is plain text — we drop colour/cursor/OSC
 * control sequences before persisting. The pattern is the well-known
 * `ansi-regex` (sindresorhus) covering CSI/SGR plus OSC strings.
 */

const ANSI_PATTERN = [
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
].join('|');

/** Remove ANSI escape sequences (colour, cursor, OSC) from a string. */
export function stripAnsi(input: string): string {
  return input.replace(new RegExp(ANSI_PATTERN, 'g'), '');
}
