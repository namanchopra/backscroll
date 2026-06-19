import { useEffect, useState } from 'react';
import type { ApiCommandDetail } from '../api-types';
import { getCommand, rerun, UnauthorizedError } from '../api';
import { duration, relativeTime, statusClass, statusGlyph } from '../util/format';

/**
 * Props for {@link DetailPane}.
 */
export interface DetailPaneProps {
  /**
   * Id of the command to show full detail for, or `null` when nothing is
   * selected (the pane then renders a muted placeholder).
   */
  id: number | null;
  /**
   * Current epoch-millisecond clock, injected from the parent so relative
   * timestamps stay deterministic and update on a single shared tick.
   */
  now: number;
}

/** Loading/error/data state for the active detail fetch. */
type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; detail: ApiCommandDetail };

/** How long the transient Copy / Re-run confirmations stay visible. */
const NOTE_MS = 2000;

/** Confirmation note shown after a successful re-run request. */
const RERUN_NOTE = 'Queued — quit `bsc ui` (the command prints to your shell)';

/**
 * Translate a thrown value from the API client into a user-facing message,
 * giving {@link UnauthorizedError} a dedicated, actionable string.
 */
function errorMessage(err: unknown): string {
  if (err instanceof UnauthorizedError) {
    return 'Unauthorized — the access token is missing or has expired. Re-open the link from `bsc ui`.';
  }
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }
  return 'Something went wrong while loading this command.';
}

/**
 * Right-hand detail pane for the BackScroll SPA. [TASK-014]
 *
 * Given a selected command {@link DetailPaneProps.id}, fetches its full record
 * — including captured output — and renders a metadata header followed by the
 * output in a scrollable region. Loading, error, and empty states are all
 * surfaced inline within the pane.
 *
 * Two actions live in the header: **Copy** writes the command text to the
 * clipboard, and **Re-run** asks the server to queue the command for the host
 * shell. Re-run never executes anything in the browser; it only calls the API
 * and then explains where the output will appear.
 *
 * Fetches are guarded against races: if {@link DetailPaneProps.id} changes
 * while a request is in flight, the stale response is discarded.
 */
export default function DetailPane({ id, now }: DetailPaneProps): JSX.Element {
  const [state, setState] = useState<FetchState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [rerunNote, setRerunNote] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);

  // Fetch the selected command. A `cancelled` flag scoped to each effect run
  // discards responses for an id that is no longer selected, so rapid
  // selection changes can never paint stale data.
  useEffect(() => {
    if (id === null) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    getCommand(id)
      .then((detail) => {
        if (!cancelled) {
          setState({ kind: 'data', detail });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: errorMessage(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Reset transient action feedback whenever the selection changes.
  useEffect(() => {
    setCopied(false);
    setRerunNote(null);
    setRerunError(null);
  }, [id]);

  // Auto-dismiss the "Copied" badge.
  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), NOTE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [copied]);

  const detail = state.kind === 'data' ? state.detail : null;

  async function handleCopy(): Promise<void> {
    if (detail === null) return;
    try {
      await navigator.clipboard.writeText(detail.command);
      setCopied(true);
    } catch {
      setCopied(false);
      setRerunError('Could not access the clipboard.');
    }
  }

  async function handleRerun(): Promise<void> {
    if (id === null || rerunBusy) return;
    setRerunBusy(true);
    setRerunError(null);
    setRerunNote(null);
    try {
      // Fire-and-confirm: the server queues the command for the host shell.
      // Nothing is executed in the browser.
      await rerun(id);
      setRerunNote(RERUN_NOTE);
    } catch (err: unknown) {
      setRerunError(errorMessage(err));
    } finally {
      setRerunBusy(false);
    }
  }

  const paneClass =
    'flex h-full min-h-0 flex-col bg-slate-900 font-mono text-sm text-slate-200';

  if (id === null) {
    return (
      <div className={`${paneClass} items-center justify-center`}>
        <p className="text-slate-500">Select a command</p>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className={`${paneClass} items-center justify-center`}>
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={`${paneClass} items-center justify-center px-4`}>
        <p className="max-w-prose text-center text-rose-400">{state.message}</p>
      </div>
    );
  }

  if (detail === null) {
    // `idle` with a non-null id is a momentary state before the effect runs;
    // render nothing visible rather than flashing a placeholder.
    return <div className={paneClass} />;
  }

  const buttonBase =
    'rounded border px-2 py-1 text-xs outline-none transition-colors ' +
    'border-slate-700 bg-slate-800 text-slate-300 ' +
    'hover:text-slate-100 hover:border-slate-500 ' +
    'focus:ring-2 focus:ring-slate-500 ' +
    'disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className={paneClass}>
      <header className="flex-none border-b border-slate-700 px-4 py-3">
        <div className="flex items-start gap-3">
          <code className="flex-1 whitespace-pre-wrap break-words font-bold text-slate-100">
            {detail.command}
          </code>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              className={buttonBase}
              aria-label="Copy command to clipboard"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRerun();
              }}
              disabled={rerunBusy}
              className={buttonBase}
              aria-label="Re-run this command"
            >
              {rerunBusy ? 'Re-running…' : 'Re-run'}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span className={statusClass(detail.exitCode)}>
            {statusGlyph(detail.exitCode)} exit {detail.exitCode ?? '—'}
          </span>
          <span title={detail.cwd ?? undefined}>{detail.cwd ?? '—'}</span>
          <span>{detail.gitBranch ?? '—'}</span>
          <span>{relativeTime(detail.startedAt, now)}</span>
          <span>{duration(detail.durationMs)}</span>
          <span className="text-slate-500">{detail.source}</span>
        </div>

        {rerunNote !== null && (
          <p
            role="status"
            className="mt-2 rounded border border-sky-800 bg-sky-950/50 px-2 py-1 text-xs text-sky-200"
          >
            {rerunNote}
          </p>
        )}
        {rerunError !== null && (
          <p role="alert" className="mt-2 text-xs text-rose-400">
            {rerunError}
          </p>
        )}
      </header>

      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-slate-200">
        {detail.output !== null && detail.output.length > 0 ? (
          detail.output
        ) : (
          <span className="text-slate-500">(no output captured)</span>
        )}
      </pre>
    </div>
  );
}
