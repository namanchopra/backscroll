import { useEffect, useState } from 'react';
import type { ApiCommandDetail } from '../api-types';
import { getCommand, rerun, UnauthorizedError } from '../api';
import { duration, relativeTime } from '../util/format';

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

/** How long the transient Copy confirmation stays visible. */
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

/* ---------- inline, CSP-safe icons ---------- */

function CopyIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function RerunIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CrossIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z" />
    </svg>
  );
}

function BranchIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 4-6 2-6 5.5" />
    </svg>
  );
}

function ClockIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Right-hand detail pane for the BackScroll SPA. [TASK-014]
 *
 * Given a selected command {@link DetailPaneProps.id}, fetches its full record
 * — including captured output — and renders a prompt header with metadata pills
 * followed by the captured output inside a faux-terminal window. Loading,
 * error, and empty states are surfaced inline within the pane.
 *
 * Two actions live in the header: **Copy** writes the command text to the
 * clipboard, and **Re-run** asks the server to queue the command for the host
 * shell. Re-run never executes anything in the browser; it only calls the API
 * and then explains where the output will appear.
 *
 * Fetches are guarded against races: if {@link DetailPaneProps.id} changes
 * while a request is in flight, the stale response is discarded.
 */
export default function DetailPane({ id, now }: DetailPaneProps): React.JSX.Element {
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

  if (id === null) {
    return (
      <section className="detail" aria-label="Command detail">
        <div className="detail-empty">Select a command</div>
      </section>
    );
  }

  if (state.kind === 'loading') {
    return (
      <section className="detail" aria-label="Command detail">
        <div className="detail-empty">Loading…</div>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="detail" aria-label="Command detail">
        <div className="detail-empty" role="alert">
          {state.message}
        </div>
      </section>
    );
  }

  if (detail === null) {
    // `idle` with a non-null id is a momentary state before the effect runs;
    // render nothing visible rather than flashing a placeholder.
    return <section className="detail" aria-label="Command detail" />;
  }

  const exitOk = detail.exitCode === 0;
  const exitKnown = detail.exitCode !== null;
  const exitLabel = detail.exitCode ?? '—';
  const hasOutput = detail.output !== null && detail.output.length > 0;

  return (
    <section className="detail" aria-label="Command detail">
      <div className="head-top">
        <div className="prompt mono">
          <span className="sigil" aria-hidden="true">
            ❯
          </span>
          {detail.command}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void handleCopy();
            }}
            aria-label="Copy command to clipboard"
          >
            <CopyIcon />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={rerunBusy}
            onClick={() => {
              void handleRerun();
            }}
            aria-label="Re-run this command"
          >
            <RerunIcon />
            {rerunBusy ? 'Re-running…' : 'Re-run'}
          </button>
        </div>
      </div>

      <div className="pills">
        <span
          className={exitOk ? 'pill ok' : exitKnown ? 'pill bad' : 'pill'}
        >
          {exitKnown ? exitOk ? <CheckIcon /> : <CrossIcon /> : null}
          exit <b>{exitLabel}</b>
        </span>
        <span className="pill">
          <FolderIcon />
          <b>{detail.cwd ?? '~'}</b>
        </span>
        {detail.gitBranch !== null && (
          <span className="pill">
            <BranchIcon />
            <b>{detail.gitBranch}</b>
          </span>
        )}
        <span className="pill">
          <ClockIcon />
          {relativeTime(detail.startedAt, now)}
        </span>
        <span className="pill">
          <b>{duration(detail.durationMs)}</b>
        </span>
        <span className="pill">
          <span className={`badge ${detail.source}`}>{detail.source}</span>
        </span>
      </div>

      {rerunNote !== null && (
        <p role="status" className="note info">
          {rerunNote}
        </p>
      )}
      {rerunError !== null && (
        <p role="alert" className="note err">
          {rerunError}
        </p>
      )}

      <div className="section-label">Captured output</div>
      <div className="term">
        <div className="term-bar">
          <span className="lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="term-title">
            stdout · stderr — exit{' '}
            <span className={exitOk ? 'ok' : exitKnown ? 'bad' : ''}>
              {exitLabel}
            </span>
          </span>
        </div>
        <pre className="term-body">
          {hasOutput ? (
            detail.output
          ) : (
            <span className="dim">(no output captured)</span>
          )}
        </pre>
      </div>
    </section>
  );
}
