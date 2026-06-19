import { useEffect, useRef, useState } from 'react';

import type { ApiResult, ApiStats, ApiStatus, SearchQuery } from './api-types';
import { getStats, getStatus, search, UnauthorizedError } from './api';
import { useTheme } from './util/useTheme';
import SearchBar from './components/SearchBar';
import ResultList from './components/ResultList';
import DetailPane from './components/DetailPane';
import SettingsDrawer from './components/SettingsDrawer';

/** How many results to fetch per page (initial load and each "load more"). */
const PAGE = 100;

/** Format an integer with thousands separators for the status/count chrome. */
function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Human span between the first and last recorded command, for the status bar
 * (e.g. "16 months", "3 weeks"). Returns null when the corpus is empty.
 */
function recordedSpan(stats: ApiStats | null): string | null {
  if (stats === null || stats.firstAt === null || stats.lastAt === null) {
    return null;
  }
  const ms = Math.max(0, stats.lastAt - stats.firstAt);
  const day = 86_400_000;
  const week = 604_800_000;
  const month = 2_592_000_000;
  const year = 31_536_000_000;
  if (ms < day) return 'under a day';
  if (ms < week) {
    const days = Math.max(1, Math.round(ms / day));
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (ms < month) {
    const weeks = Math.round(ms / week);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (ms < year) {
    const months = Math.round(ms / month);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  const years = (ms / year).toFixed(1).replace(/\.0$/, '');
  return `${years} year${years === '1' ? '' : 's'}`;
}

/** Gear glyph for the settings button (inline, CSP-safe). */
function GearIcon(): React.JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Sun / moon glyph for the theme toggle (inline, CSP-safe). */
function ThemeIcons(): React.JSX.Element {
  return (
    <>
      <svg className="t-light" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
      </svg>
      <svg className="t-dark" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 13.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 9.5z" />
      </svg>
    </>
  );
}

/**
 * Root component for the BackScroll SPA. [TASK-015]
 *
 * Wires the three feature components into the command-console layout:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ● backscroll  ⌕ search  chips      N of M  ☀ │  ← topbar
 *   ├───────────────────┬──────────────────────────┤
 *   │ <ResultList />     │ <DetailPane />           │  ← main
 *   │  (384px, scrolls)  │  (fills rest, scrolls)   │
 *   ├───────────────────┴──────────────────────────┤
 *   │ N recorded · spanning …      ↑↓ ⏎ / esc      │  ← statusbar
 *   └──────────────────────────────────────────────┘
 *
 * Filter changes reset the result window to offset 0 and clear the selection;
 * scrolling near the tail of the list pages in the next {@link PAGE} results.
 * Any {@link UnauthorizedError} from the API swaps the whole app for an
 * actionable message rather than leaving a blank screen.
 */
export default function App(): React.JSX.Element {
  const [filters, setFilters] = useState<SearchQuery>({});
  const [results, setResults] = useState<ApiResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<ApiStatus | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [loading, setLoading] = useState(false);

  const { theme, toggle } = useTheme();

  // A single shared clock so every relative timestamp renders consistently and
  // deterministically across both panes for the lifetime of the session.
  const [now] = useState(() => Date.now());

  // Bumped on every filter-driven reset. A request tags itself with the value
  // current at dispatch time; when its response lands we discard it unless the
  // tag still matches, so a slow early query can never clobber a newer one.
  const requestSeq = useRef(0);

  // Mirror the live result count for loadMore, which reads it from a stable
  // callback identity (ResultList holds onto the first reference it sees).
  const resultsLengthRef = useRef(0);
  resultsLengthRef.current = results.length;
  const totalRef = useRef(0);
  totalRef.current = total;
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const filtersRef = useRef<SearchQuery>(filters);
  filtersRef.current = filters;

  // Fetch aggregate stats once on mount.
  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((s) => {
        if (!cancelled) {
          setStats(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && err instanceof UnauthorizedError) {
          setAuthError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch recording status once on mount so the REC dot reflects real state.
  // The drawer reports back any later changes (e.g. after a pause toggle).
  useEffect(() => {
    let cancelled = false;
    getStatus()
      .then((s) => {
        if (!cancelled) {
          setRecordingStatus(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && err instanceof UnauthorizedError) {
          setAuthError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset to the first page whenever the filters change. The sequence guard
  // discards stale responses if filters change again before this one resolves.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setSelectedId(null);

    search({ ...filters, limit: PAGE, offset: 0 })
      .then((res) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setResults(res.results);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setLoading(false);
        if (err instanceof UnauthorizedError) {
          setAuthError(true);
        }
      });
  }, [filters]);

  // Append the next page when the list nears its end. Reads live values from
  // refs so the callback identity stays stable for ResultList's load guard.
  const loadMore = useRef<() => void>(() => {});
  loadMore.current = () => {
    if (loadingRef.current || resultsLengthRef.current >= totalRef.current) {
      return;
    }

    const seq = requestSeq.current;
    const offset = resultsLengthRef.current;
    setLoading(true);

    search({ ...filtersRef.current, limit: PAGE, offset })
      .then((res) => {
        // Only append if no filter reset happened while this page was loading.
        if (requestSeq.current !== seq) {
          return;
        }
        setResults((prev) => [...prev, ...res.results]);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestSeq.current !== seq) {
          return;
        }
        setLoading(false);
        if (err instanceof UnauthorizedError) {
          setAuthError(true);
        }
      });
  };

  // Stable wrapper handed to ResultList — never changes identity.
  const handleLoadMore = useRef(() => loadMore.current()).current;

  if (authError) {
    return (
      <div className="app" data-theme={theme}>
        <div className="fullmsg">
          <p>
            Unauthorized — open the URL printed by <code>bsc ui</code> (it
            includes the access token).
          </p>
        </div>
      </div>
    );
  }

  const span = recordedSpan(stats);
  const paused = recordingStatus?.paused === true;
  const recLabel =
    recordingStatus === null
      ? 'recording status unknown'
      : paused
        ? 'recording paused'
        : 'recording active';

  return (
    <div className="app" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <span
            className={paused ? 'rec-dot paused' : 'rec-dot'}
            role="img"
            aria-label={recLabel}
            title={recLabel}
          />
          <b>backscroll</b>
          <span className="v mono">v0.1</span>
        </div>

        <SearchBar onChange={setFilters} />

        <span className="spacer" />
        <div className="count">
          <b>{formatCount(total)}</b>
          {stats !== null ? ` of ${formatCount(stats.total)}` : ''}
        </div>

        <button
          type="button"
          className="theme-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
        >
          <GearIcon />
        </button>

        <button
          type="button"
          className="theme-toggle"
          onClick={toggle}
          aria-label="Toggle light and dark"
          aria-pressed={theme === 'light'}
        >
          <ThemeIcons />
        </button>
      </header>

      <div className="main">
        <ResultList
          results={results}
          selectedId={selectedId}
          now={now}
          onSelect={setSelectedId}
          onLoadMore={handleLoadMore}
        />
        <DetailPane id={selectedId} now={now} />
      </div>

      <footer className="statusbar">
        <span>
          <b>{stats !== null ? formatCount(stats.total) : '…'}</b> commands
          recorded
          {span !== null ? (
            <>
              {' '}
              · spanning <b>{span}</b>
            </>
          ) : null}
        </span>
        <span className="grow" />
        <span className="hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span className="hint">
          <kbd>⏎</kbd> copy
        </span>
        <span className="hint">
          <kbd>/</kbd> search
        </span>
        <span className="hint">
          <kbd>esc</kbd> clear
        </span>
      </footer>

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onStatusChange={setRecordingStatus}
        onAuthError={() => setAuthError(true)}
      />
    </div>
  );
}
