import type { ReactNode } from "react";

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight every (case-insensitive) occurrence of `term` within `text`,
 * wrapping matches in a `.hl` span. React-node port of the mockup's `hl()`
 * helper — no dangerouslySetInnerHTML, so it's XSS-safe by construction.
 */
export function highlight(text: string, term: string): ReactNode {
  const trimmed = term.trim();
  if (!trimmed) return text;

  let regex: RegExp;
  try {
    regex = new RegExp(`(${escapeRegExp(trimmed)})`, "ig");
  } catch {
    return text;
  }

  const needle = trimmed.toLowerCase();
  // Splitting on a single capture group alternates delimiters with matches;
  // a part is a match iff it equals the term case-insensitively.
  const parts = text.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === needle && part.length > 0 ? (
      <span className="hl" key={i}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
