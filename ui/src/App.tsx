import { useEffect, useRef, useState } from 'react';

import type { ApiResult, ApiStats, SearchQuery } from './api-types';
import { getStats, search, UnauthorizedError } from './api';
import SearchBar from './components/SearchBar';
import ResultList from './components/ResultList';
import DetailPane from './components/DetailPane';

/** How many results to fetch per page (initial load and each "load more"). */
const PAGE = 100;

/**
 * Root component for the BackScroll SPA. [TASK-015]
 *
 * Wires the three feature components into a two-pane layout:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Backscroll                       N commands   │  ← header
 *   ├──────────────────────────────────────────────┤
 *   │ <SearchBar />                                 │  ← filters
 *   ├───────────────────┬──────────────────────────┤
 *   │ <ResultList />     │ <DetailPane />           │  ← body
 *   │  (≈40%, scrolls)   │  (fills rest, scrolls)   │
 *   └───────────────────┴──────────────────────────┘
 *
 * Filter changes reset the result window to offset 0 and clear the selection;
 * scrolling near the tail of the list pages in the next {@link PAGE} results.
 * Any {@link UnauthorizedError} from the API swaps the whole app for an
 * actionable message rather than leaving a blank screen.
 */
export default function App(): JSX.Element {
  const [filters, setFilters] = useState<SearchQuery>({});
  const [results, setResults] = useState<ApiResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [authError, setAuthError] = useState(false);
  const [loading, setLoading] = useState(false);

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
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 px-6 font-mono text-slate-200">
        <p className="max-w-prose text-center text-sm leading-relaxed text-slate-300">
          Unauthorized — open the URL printed by{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">
            bsc ui
          </code>{' '}
          (it includes the access token).
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-mono text-slate-200">
      <header className="flex flex-none items-baseline justify-between border-b border-slate-700 bg-slate-900 px-4 py-3">
        <h1 className="text-base font-bold text-slate-100">Backscroll</h1>
        <span className="text-xs text-slate-500">
          {stats !== null ? `${stats.total} commands` : '…'}
        </span>
      </header>

      <div className="flex-none border-b border-slate-700">
        <SearchBar onChange={setFilters} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-2/5 min-w-0 flex-none border-r border-slate-700">
          <ResultList
            results={results}
            selectedId={selectedId}
            now={now}
            onSelect={setSelectedId}
            onLoadMore={handleLoadMore}
          />
        </div>
        <div className="min-w-0 flex-1">
          <DetailPane id={selectedId} now={now} />
        </div>
      </div>
    </div>
  );
}
