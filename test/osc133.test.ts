/**
 * Tests for the OSC 133 marker tokenizer. [TASK-030]
 *
 * Verifies that full C/D markers decode correctly, that markers split across
 * feed() boundaries are reassembled, and that output / non-133 sequences /
 * malformed markers are handled without throwing or producing spurious tokens.
 */
import {
  Osc133Parser,
  Osc133Token,
  MarkerToken,
} from '../src/capture/osc133';

const ESC = '\x1b';
const BEL = '\x07';

/** Encode a string as base64, matching the shell-integration wire format. */
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Type guard narrowing a token to a MarkerToken of a given kind. */
function isMarker(
  t: Osc133Token | undefined,
  kind: MarkerToken['kind'],
): t is MarkerToken {
  return t !== undefined && t.type === 'marker' && t.kind === kind;
}

/** Collect only marker tokens from a token list. */
function markers(tokens: Osc133Token[]): MarkerToken[] {
  return tokens.filter((t): t is MarkerToken => t.type === 'marker');
}

describe('Osc133Parser', () => {
  it('decodes a full C marker then a D marker', () => {
    const p = new Osc133Parser();

    const cTokens = p.feed(
      `${ESC}]133;C;cmd=${b64('ls -la')};cwd=${b64('/tmp')};branch=${b64(
        'main',
      )}${BEL}`,
    );
    const dTokens = p.feed(`${ESC}]133;D;0;dur=12${BEL}`);

    const cMarker = cTokens[0];
    expect(isMarker(cMarker, 'C')).toBe(true);
    if (!isMarker(cMarker, 'C')) throw new Error('expected C marker');
    expect(cMarker.command).toBe('ls -la');
    expect(cMarker.cwd).toBe('/tmp');
    expect(cMarker.branch).toBe('main');

    const dMarker = dTokens[0];
    expect(isMarker(dMarker, 'D')).toBe(true);
    if (!isMarker(dMarker, 'D')) throw new Error('expected D marker');
    expect(dMarker.exitCode).toBe(0);
    expect(dMarker.durationMs).toBe(12);
  });

  it('reassembles a C marker split across two feed() calls', () => {
    const p = new Osc133Parser();

    const full = `${ESC}]133;C;cmd=${b64('git status')};cwd=${b64(
      '/repo',
    )};branch=${b64('dev')}${BEL}`;
    const splitAt = 6;
    const firstHalf = full.slice(0, splitAt);
    const secondHalf = full.slice(splitAt);

    // First half is an incomplete marker — no marker token should appear yet.
    const firstTokens = p.feed(firstHalf);
    expect(markers(firstTokens)).toHaveLength(0);

    // Second half completes the marker.
    const secondTokens = p.feed(secondHalf);
    const completed = markers(secondTokens);
    expect(completed).toHaveLength(1);

    const cMarker = secondTokens.find((t) => t.type === 'marker');
    expect(isMarker(cMarker, 'C')).toBe(true);
    if (!isMarker(cMarker, 'C')) throw new Error('expected C marker');
    expect(cMarker.command).toBe('git status');
    expect(cMarker.cwd).toBe('/repo');
    expect(cMarker.branch).toBe('dev');
  });

  it('emits plain output and ignores non-133 OSC and malformed markers', () => {
    const p = new Osc133Parser();

    // Plain text becomes an output token.
    const helloTokens = p.feed('hello ');
    expect(helloTokens).toHaveLength(1);
    const first = helloTokens[0];
    expect(first?.type).toBe('output');
    if (first?.type === 'output') {
      expect(first.text).toBe('hello ');
    }

    // A non-133 OSC (window title) plus plain text must not throw and must not
    // produce a 133 marker token.
    let titleTokens: Osc133Token[] = [];
    expect(() => {
      titleTokens = p.feed(`${ESC}]0;window title${BEL}world`);
    }).not.toThrow();
    expect(markers(titleTokens)).toHaveLength(0);

    // A malformed 133 C marker must not throw.
    let malformedTokens: Osc133Token[] = [];
    expect(() => {
      malformedTokens = p.feed(`${ESC}]133;C;garbage${BEL}`);
    }).not.toThrow();
    // It is still recognised as a C-kind marker, just without decoded fields.
    const malformed = malformedTokens.find((t) => t.type === 'marker');
    if (malformed && malformed.type === 'marker') {
      expect(malformed.kind).toBe('C');
    }
  });
});
