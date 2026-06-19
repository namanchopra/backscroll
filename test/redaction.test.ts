/**
 * Tests for secret redaction. [TASK-029]
 *
 * Verifies that `redact` masks known secret shapes and secret-named
 * assignments, does NOT over-redact benign content (paths, git SHAs, prose),
 * honours user-supplied extra patterns, and is a no-op when disabled.
 */
import { redact, builtinRuleKinds } from '../src/redaction/redact';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config';

const MASK_PREFIX = '«redacted:';

describe('redact — positive masking', () => {
  it('masks an AWS secret-access-key assignment', () => {
    const raw = 'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
    const out = redact(raw, DEFAULT_CONFIG);

    expect(out).toContain(MASK_PREFIX);
    expect(out).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    // key + operator are preserved, only the value is masked
    expect(out).toContain('AWS_SECRET_ACCESS_KEY=');
  });

  it('masks a GitHub personal-access token', () => {
    const token = 'ghp_0123456789abcdefghijABCDEFGHIJ012345';
    const out = redact(`token is ${token}`, DEFAULT_CONFIG);

    expect(out).toContain('«redacted:github-token»');
    expect(out).not.toContain(token);
  });

  it('masks a Bearer JWT (the token body is removed)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    // Use a "Bearer <jwt>" form whose surrounding text is NOT itself a
    // secret-named assignment, so we isolate the bearer/jwt rules.
    const raw = `sent header Bearer ${jwt} to the API`;
    const out = redact(raw, DEFAULT_CONFIG);

    // The JWT body must be gone from the output.
    expect(out).toContain(MASK_PREFIX);
    expect(out).not.toContain(jwt);
    // bearer rule keeps the "Bearer" keyword, masking only the value.
    expect(out).toContain('Bearer');
  });

  it('masks a PEM private-key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\n' +
      'MIIabcDEFghiJKLmnoPQRstuVWXyz0123456789+/abcdEFGH\n' +
      'ijklMNOPqrstUVWXyz9876543210+/==\n' +
      '-----END RSA PRIVATE KEY-----';
    const out = redact(`output below\n${pem}\ndone`, DEFAULT_CONFIG);

    expect(out).toContain('«redacted:private-key»');
    expect(out).not.toContain('MIIabcDEFghiJKLmnoPQRstuVWXyz0123456789');
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
  });
});

describe('redact — negative (no over-redaction)', () => {
  it('leaves a non-secret PATH assignment unchanged', () => {
    const raw = 'PATH=/usr/bin:/bin';
    const out = redact(raw, DEFAULT_CONFIG);

    expect(out).toBe(raw);
    expect(out).not.toContain(MASK_PREFIX);
  });

  it('does not mask a bare 40-char git SHA in prose', () => {
    const raw = 'commit da39a3ee5e6b4b0d3255bfef95601890afd80709 was reverted';
    const out = redact(raw, DEFAULT_CONFIG);

    expect(out).toBe(raw);
    expect(out).not.toContain(MASK_PREFIX);
  });

  it('leaves plain prose unchanged', () => {
    const raw = 'the deploy finished successfully';
    const out = redact(raw, DEFAULT_CONFIG);

    expect(out).toBe(raw);
    expect(out).not.toContain(MASK_PREFIX);
  });
});

describe('redact — user-supplied extra patterns', () => {
  it('masks text matching a custom regex source', () => {
    const config = mergeConfig({ redactionExtraPatterns: ['FOOBAR-\\d+'] });
    const out = redact('FOOBAR-12345', config);

    expect(out).toContain('«redacted:custom»');
    expect(out).not.toContain('FOOBAR-12345');
  });
});

describe('redact — disable toggle', () => {
  it('returns the input verbatim when redaction is disabled', () => {
    const raw = 'AWS_SECRET_ACCESS_KEY=topsecret';
    const out = redact(raw, mergeConfig({ redactionEnabled: false }));

    expect(out).toBe(raw);
    expect(out).not.toContain(MASK_PREFIX);
  });
});

describe('builtinRuleKinds', () => {
  it('is a non-empty array of rule kinds', () => {
    expect(Array.isArray(builtinRuleKinds)).toBe(true);
    expect(builtinRuleKinds.length).toBeGreaterThan(0);
  });
});
