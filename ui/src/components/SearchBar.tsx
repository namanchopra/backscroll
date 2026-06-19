import { useEffect, useRef, useState } from 'react';
import type { SearchQuery } from '../api-types';

/**
 * Props for {@link SearchBar}.
 */
export interface SearchBarProps {
  /**
   * Called with the current search query after the debounce window settles.
   * Empty fields are omitted from the emitted object (e.g. an empty text input
   * yields `undefined` rather than `''`), so an all-empty bar emits `{}` to
   * browse everything.
   */
  onChange: (query: SearchQuery) => void;
}

/** Debounce interval, in milliseconds, for coalescing input bursts. */
const DEBOUNCE_MS = 150;

/**
 * Trim a raw input value, returning `undefined` when it is blank so that the
 * field is omitted from the emitted {@link SearchQuery}.
 */
function normalize(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build a {@link SearchQuery} from the current control state, omitting any
 * field that is empty or false. `exactOptionalPropertyTypes` requires that we
 * only assign defined values to optional fields, so each field is conditionally
 * attached.
 */
function buildQuery(state: {
  q: string;
  cwd: string;
  since: string;
  until: string;
  successOnly: boolean;
}): SearchQuery {
  const query: SearchQuery = {};
  const q = normalize(state.q);
  if (q !== undefined) query.q = q;
  const cwd = normalize(state.cwd);
  if (cwd !== undefined) query.cwd = cwd;
  const since = normalize(state.since);
  if (since !== undefined) query.since = since;
  const until = normalize(state.until);
  if (until !== undefined) query.until = until;
  if (state.successOnly) query.success = true;
  return query;
}

/**
 * Top search bar for the BackScroll SPA.
 *
 * Renders a single wrapping row of controls — a free-text query, a
 * success-only toggle, a working-directory filter, and `since`/`until` time
 * bounds. Changes are debounced to at most one {@link SearchBarProps.onChange}
 * call per ~150ms burst, so typing does not fire one query per keystroke.
 *
 * Empty queries are allowed (browse-all); blank fields are omitted from the
 * emitted {@link SearchQuery}. Pressing Escape in the query input clears it.
 */
export default function SearchBar({ onChange }: SearchBarProps): JSX.Element {
  const [q, setQ] = useState('');
  const [cwd, setCwd] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [successOnly, setSuccessOnly] = useState(false);

  // Keep the latest callback in a ref so the debounce effect can call it
  // without re-subscribing (and re-timing) whenever the parent re-renders
  // with a new function identity.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      onChangeRef.current(buildQuery({ q, cwd, since, until, successOnly }));
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [q, cwd, since, until, successOnly]);

  const inputBase =
    'rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-sm ' +
    'text-slate-200 placeholder:text-slate-500 outline-none transition-colors ' +
    'focus:border-slate-500 focus:ring-2 focus:ring-slate-500';

  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-900 px-3 py-2 font-mono text-slate-200">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setQ('');
          }
        }}
        placeholder="search commands and output…"
        aria-label="Search commands and output"
        className={`${inputBase} min-w-[12rem] flex-1`}
      />

      <button
        type="button"
        role="switch"
        aria-checked={successOnly}
        aria-label="Show successful commands only"
        onClick={() => setSuccessOnly((v) => !v)}
        className={
          'rounded border px-2 py-1 text-sm outline-none transition-colors ' +
          'focus:ring-2 focus:ring-slate-500 ' +
          (successOnly
            ? 'border-emerald-600 bg-emerald-700/40 text-emerald-200'
            : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200')
        }
      >
        ✓ success only
      </button>

      <input
        type="text"
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="cwd"
        aria-label="Working directory filter"
        className={`${inputBase} w-40`}
      />

      <input
        type="text"
        value={since}
        onChange={(e) => setSince(e.target.value)}
        placeholder="3w / 2d / ISO"
        aria-label="Since"
        className={`${inputBase} w-28`}
      />

      <input
        type="text"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        placeholder="3w / 2d / ISO"
        aria-label="Until"
        className={`${inputBase} w-28`}
      />
    </div>
  );
}
