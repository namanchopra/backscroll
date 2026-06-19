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

/** Selectable relative time windows, mapped onto the `since` query field. */
interface RangePreset {
  readonly id: string;
  readonly label: string;
  /** Value passed as `since` (the backend parses `7d`/`30d`/… relative spans). */
  readonly since: string;
}

const RANGE_PRESETS: readonly RangePreset[] = [
  { id: '7d', label: 'Last 7 days', since: '7d' },
  { id: '30d', label: 'Last 30 days', since: '30d' },
  { id: '90d', label: 'Last 90 days', since: '90d' },
];

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
  successOnly: boolean;
}): SearchQuery {
  const query: SearchQuery = {};
  const q = normalize(state.q);
  if (q !== undefined) query.q = q;
  const cwd = normalize(state.cwd);
  if (cwd !== undefined) query.cwd = cwd;
  const since = normalize(state.since);
  if (since !== undefined) query.since = since;
  if (state.successOnly) query.success = true;
  return query;
}

/** Inline magnifier glyph (CSP-safe — no icon library). */
function SearchIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

/**
 * Command-palette style search bar for the BackScroll SPA.
 *
 * A free-text query (mono, magnifier-prefixed) plus a row of filter chips: a
 * `Success`-only toggle, an editable working-directory chip, and a mutually
 * exclusive set of relative time-window chips (mapped onto `since`). Changes
 * are debounced to at most one {@link SearchBarProps.onChange} call per ~150ms
 * burst, so typing does not fire one query per keystroke.
 *
 * Empty queries are allowed (browse-all); blank fields are omitted from the
 * emitted {@link SearchQuery}. Pressing Escape in the query input clears it.
 */
export default function SearchBar({ onChange }: SearchBarProps): React.JSX.Element {
  const [q, setQ] = useState('');
  const [cwd, setCwd] = useState('');
  const [since, setSince] = useState('');
  const [successOnly, setSuccessOnly] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep the latest callback in a ref so the debounce effect can call it
  // without re-subscribing (and re-timing) whenever the parent re-renders
  // with a new function identity.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      onChangeRef.current(buildQuery({ q, cwd, since, successOnly }));
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [q, cwd, since, successOnly]);

  // Global "/" focuses search; handled here so it works regardless of which
  // pane currently holds focus (but never hijacks typing in another field).
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <label className="search">
        <SearchIcon />
        <input
          ref={searchInputRef}
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
        />
      </label>

      <div className="chips">
        <button
          type="button"
          role="switch"
          aria-checked={successOnly}
          aria-label="Show successful commands only"
          onClick={() => setSuccessOnly((v) => !v)}
          className={successOnly ? 'chip on' : 'chip'}
        >
          <span className="dot" aria-hidden="true" />
          Success
        </button>

        <label
          className={normalize(cwd) !== undefined ? 'chip on' : 'chip'}
          aria-label="Working directory filter"
        >
          <input
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="~/cwd"
            aria-label="Working directory filter"
            className="chip-input mono"
          />
        </label>

        {RANGE_PRESETS.map((preset) => {
          const active = since === preset.since;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSince(active ? '' : preset.since)}
              className={active ? 'chip on' : 'chip'}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
