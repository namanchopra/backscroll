/**
 * Secret redaction. [TASK-009]
 *
 * Runs on the write path BEFORE anything reaches storage (see persist.ts).
 * Two layers: (1) known token shapes (AWS/GitHub/Slack/Google/JWT/PEM/bearer/
 * URL credentials), and (2) secret-named assignments (KEY=value, --token=...).
 *
 * Deliberately conservative: we do NOT mask bare long hex/base64 blobs, because
 * git SHAs and content hashes are common, legitimate terminal output and
 * masking them would destroy useful history. Users can add patterns via config.
 */
import { BackscrollConfig } from '../types';

type Rule = {
  kind: string;
  re: RegExp;
  render: (...args: string[]) => string;
};

const mask = (kind: string): string => `«redacted:${kind}»`;

// Key names that mark a value as sensitive (substring match, case-insensitive).
const SECRET_KEY = '(?:key|secret|token|password|passwd|pass|credential|auth|apikey|access_key)';

const BASE_RULES: Rule[] = [
  // PEM private key blocks (multi-line) — must run first.
  {
    kind: 'private-key',
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
    render: () => mask('private-key'),
  },
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  {
    kind: 'github-token',
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    render: () => mask('github-token'),
  },
  // Slack tokens
  {
    kind: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    render: () => mask('slack-token'),
  },
  // AWS access key id
  {
    kind: 'aws-access-key',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    render: () => mask('aws-access-key'),
  },
  // Google API key
  {
    kind: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    render: () => mask('google-api-key'),
  },
  // JSON Web Tokens
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    render: () => mask('jwt'),
  },
  // Bearer tokens — keep the keyword, mask the value.
  {
    kind: 'bearer',
    re: /\b([Bb]earer\s+)[A-Za-z0-9._~+/=-]{8,}/g,
    render: (_m: string, prefix: string) => `${prefix}${mask('bearer')}`,
  },
  // URL credentials: proto://user:password@host  -> mask the password.
  {
    kind: 'url-credentials',
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+):([^@/\s]+)@/gi,
    render: (_m: string, head: string) => `${head}:${mask('url-credentials')}@`,
  },
  // Secret-named assignments: KEY=value / --token=value / key: value
  // Keep the key + operator, mask only the value (quoted or bare).
  {
    kind: 'assignment',
    // Value branch: quoted strings, or a bare run that stops at whitespace and
    // common delimiters so we mask only the secret, not trailing punctuation or
    // a following key=value pair.
    re: new RegExp(
      `([\\w.-]*${SECRET_KEY}[\\w.-]*)(\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;)\\]}>"']+)`,
      'gi'
    ),
    render: (_m: string, key: string, op: string) => `${key}${op}${mask('assignment')}`,
  },
];

function extraRules(config: BackscrollConfig): Rule[] {
  const rules: Rule[] = [];
  for (const src of config.redactionExtraPatterns) {
    try {
      const re = new RegExp(src, 'g');
      rules.push({ kind: 'custom', re, render: () => mask('custom') });
    } catch {
      // Invalid user regex — warn once and skip rather than crash recording.
      process.stderr.write(`bsc: ignoring invalid redaction pattern: ${src}\n`);
    }
  }
  return rules;
}

/**
 * Redact secrets from `text`. Returns the text verbatim when redaction is
 * disabled in config. Never throws.
 */
export function redact(text: string, config: BackscrollConfig): string {
  if (!config.redactionEnabled) return text;
  if (!text) return text;

  let out = text;
  for (const rule of [...BASE_RULES, ...extraRules(config)]) {
    out = out.replace(rule.re, rule.render as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

/** Exposed for tests: the built-in rule kinds, in application order. */
export const builtinRuleKinds: string[] = BASE_RULES.map((r) => r.kind);
