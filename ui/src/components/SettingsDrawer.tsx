import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiConfig, ApiStatus, ImportResult } from '../api-types';
import {
  getConfig,
  getStatus,
  runImport,
  saveConfig,
  setPaused,
  UnauthorizedError,
} from '../api';

/**
 * Props for {@link SettingsDrawer}.
 */
export interface SettingsDrawerProps {
  /** Whether the drawer is mounted/visible. When false it renders nothing. */
  open: boolean;
  /** Close the drawer (backdrop click, Esc, or the close button). */
  onClose: () => void;
  /**
   * Called after any action that may have changed recording state, so the
   * parent can refresh the top-bar REC dot (e.g. after a pause toggle).
   */
  onStatusChange?: (status: ApiStatus) => void;
  /**
   * Reported when any API call here fails with {@link UnauthorizedError}, so the
   * parent can swap to its shared unauthorized screen.
   */
  onAuthError?: () => void;
}

/** How long the transient "Saved" / copy confirmations stay visible. */
const NOTE_MS = 2000;

/** The one-line shell snippet the user runs to start capturing. */
const INIT_SNIPPET = 'eval "$(bsc init zsh --auto-record)"';

/**
 * Translate a thrown value from the API client into a user-facing message,
 * giving {@link UnauthorizedError} a dedicated, actionable string.
 */
function errorMessage(err: unknown): string {
  if (err instanceof UnauthorizedError) {
    return 'Unauthorized — re-open the link from `bsc ui`.';
  }
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }
  return 'Something went wrong.';
}

/** Format an integer with thousands separators. */
function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Join a string array into a one-value-per-line editor body. */
function linesFromList(list: string[]): string {
  return list.join('\n');
}

/** Split a multi-line editor body into a trimmed, blank-stripped string list. */
function listFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/* ---------- inline, CSP-safe icons ---------- */

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}

function ImportIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function SaveIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M9 4v5h6" />
      <path d="M8 14h8v6H8z" />
    </svg>
  );
}

/**
 * Settings slide-over for the BackScroll SPA.
 *
 * A right-side panel (with backdrop) exposing every control the CLI offers
 * except starting capture itself, which must happen in the user's shell:
 *
 *   - Recording: live status pill + pause/resume (optimistic, then refetch),
 *     plus read-only data dir, db path, version and total command count.
 *   - Start capturing: the one thing the UI cannot do — a copyable shell
 *     snippet, framed as guidance rather than a dead end.
 *   - Import history: zsh/bash flags → /api/import, then the result counts.
 *   - Settings: a form bound to /api/config (redaction toggle, output cap, and
 *     three one-value-per-line list editors) saved back via POST /api/config.
 *
 * Esc and the backdrop both close the drawer; on open, focus moves to the close
 * button so keyboard users land inside the panel. No process is ever spawned —
 * pause touches a marker, import reads history files, config writes JSON.
 */
export default function SettingsDrawer({
  open,
  onClose,
  onStatusChange,
  onAuthError,
}: SettingsDrawerProps): React.JSX.Element | null {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  const [copied, setCopied] = useState(false);

  const [importZsh, setImportZsh] = useState(true);
  const [importBash, setImportBash] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [redaction, setRedaction] = useState(false);
  const [maxBytes, setMaxBytes] = useState('');
  const [excludeCommands, setExcludeCommands] = useState('');
  const [excludeDirs, setExcludeDirs] = useState('');
  const [extraPatterns, setExtraPatterns] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const closeRef = useRef<HTMLButtonElement>(null);

  // Surface an UnauthorizedError to the parent; report everything else inline.
  const reportError = useCallback(
    (err: unknown, setLocal: (m: string) => void): void => {
      if (err instanceof UnauthorizedError) {
        onAuthError?.();
        return;
      }
      setLocal(errorMessage(err));
    },
    [onAuthError],
  );

  // Hydrate the config form fields from a freshly-loaded ApiConfig.
  const applyConfig = useCallback((cfg: ApiConfig): void => {
    setConfig(cfg);
    setRedaction(cfg.redactionEnabled);
    setMaxBytes(String(cfg.maxOutputBytes));
    setExcludeCommands(linesFromList(cfg.excludeCommands));
    setExcludeDirs(linesFromList(cfg.excludeDirs));
    setExtraPatterns(linesFromList(cfg.redactionExtraPatterns));
  }, []);

  // Load status + config whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setStatusError(null);
    getStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        onStatusChange?.(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(err, setStatusError);
      });

    setConfigError(null);
    getConfig()
      .then((cfg) => {
        if (!cancelled) applyConfig(cfg);
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(err, setConfigError);
      });

    return () => {
      cancelled = true;
    };
  }, [open, applyConfig, reportError, onStatusChange]);

  // Esc closes; move focus into the panel on open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Auto-dismiss the copy + save confirmations.
  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), NOTE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [copied]);

  useEffect(() => {
    if (!saved) return;
    const handle = window.setTimeout(() => setSaved(false), NOTE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [saved]);

  async function handlePauseToggle(): Promise<void> {
    if (status === null || pauseBusy) return;
    const next = !status.paused;
    setPauseBusy(true);
    setStatusError(null);
    // Optimistic flip, then reconcile against the server's confirmed state.
    setStatus({ ...status, paused: next });
    try {
      await setPaused(next);
      const fresh = await getStatus();
      setStatus(fresh);
      onStatusChange?.(fresh);
    } catch (err: unknown) {
      // Roll back the optimistic flip on failure.
      setStatus((prev) => (prev === null ? prev : { ...prev, paused: !next }));
      reportError(err, setStatusError);
    } finally {
      setPauseBusy(false);
    }
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(INIT_SNIPPET);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function handleImport(): Promise<void> {
    if (importBusy) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const opts: { zsh?: boolean; bash?: boolean } = {};
      if (importZsh) opts.zsh = true;
      if (importBash) opts.bash = true;
      const result = await runImport(opts);
      setImportResult(result);
      // An import may change the total; refresh status so the UI stays honest.
      try {
        const fresh = await getStatus();
        setStatus(fresh);
        onStatusChange?.(fresh);
      } catch {
        // Best-effort refresh; the import itself already succeeded.
      }
    } catch (err: unknown) {
      reportError(err, setImportError);
    } finally {
      setImportBusy(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (config === null || saveBusy) return;

    const trimmed = maxBytes.trim();
    const parsed = Number(trimmed);
    if (
      trimmed.length === 0 ||
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed <= 0
    ) {
      setSaveError('Max output bytes must be a positive whole number.');
      return;
    }

    setSaveBusy(true);
    setSaveError(null);
    setSaved(false);

    const merged: ApiConfig = {
      ...config,
      redactionEnabled: redaction,
      maxOutputBytes: parsed,
      excludeCommands: listFromLines(excludeCommands),
      excludeDirs: listFromLines(excludeDirs),
      redactionExtraPatterns: listFromLines(extraPatterns),
    };

    try {
      const result = await saveConfig(merged);
      applyConfig(result);
      setSaved(true);
    } catch (err: unknown) {
      reportError(err, setSaveError);
    } finally {
      setSaveBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="drawer-root" role="presentation">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header className="drawer-head">
          <h2 className="drawer-title">Settings</h2>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="drawer-body">
          {/* ---------- Recording ---------- */}
          <section className="drawer-section">
            <div className="section-label">Recording</div>
            <div className="drawer-row">
              <span
                className={
                  status !== null && !status.paused
                    ? 'status-pill active'
                    : 'status-pill paused'
                }
              >
                <span className="status-dot" aria-hidden="true" />
                {status === null ? '…' : status.paused ? 'Paused' : 'Active'}
              </span>
              <button
                type="button"
                className="btn"
                disabled={status === null || pauseBusy}
                onClick={() => {
                  void handlePauseToggle();
                }}
                aria-label={
                  status !== null && status.paused
                    ? 'Resume recording'
                    : 'Pause recording'
                }
              >
                {status !== null && status.paused ? <PlayIcon /> : <PauseIcon />}
                {status !== null && status.paused ? 'Resume' : 'Pause'}
              </button>
            </div>

            {statusError !== null && (
              <p role="alert" className="note err">
                {statusError}
              </p>
            )}

            <dl className="kv">
              <dt>Data dir</dt>
              <dd className="mono">{status?.dataDir ?? '…'}</dd>
              <dt>Database</dt>
              <dd className="mono">{status?.dbPath ?? '…'}</dd>
              <dt>Version</dt>
              <dd className="mono">{status?.version ?? '…'}</dd>
              <dt>Commands</dt>
              <dd className="mono">
                {status !== null ? formatCount(status.total) : '…'}
              </dd>
            </dl>
          </section>

          {/* ---------- Start capturing ---------- */}
          <section className="drawer-section">
            <div className="section-label">Start capturing</div>
            <p className="drawer-hint">
              Recording your terminal happens in the shell. Run this once:
            </p>
            <div className="codeblock">
              <code className="mono">{INIT_SNIPPET}</code>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void handleCopy();
                }}
                aria-label="Copy the init command"
              >
                <CopyIcon />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </section>

          {/* ---------- Import history ---------- */}
          <section className="drawer-section">
            <div className="section-label">Import history</div>
            <div className="checkrow">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={importZsh}
                  onChange={(e) => setImportZsh(e.target.checked)}
                />
                zsh
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={importBash}
                  onChange={(e) => setImportBash(e.target.checked)}
                />
                bash
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={importBusy || (!importZsh && !importBash)}
                onClick={() => {
                  void handleImport();
                }}
                aria-label="Import shell history"
              >
                <ImportIcon />
                {importBusy ? 'Importing…' : 'Import'}
              </button>
            </div>

            {importResult !== null && (
              <p role="status" className="note info">
                Imported {formatCount(importResult.imported)} ·{' '}
                {formatCount(importResult.skipped)} already present ·{' '}
                {formatCount(importResult.excluded)} excluded
              </p>
            )}
            {importError !== null && (
              <p role="alert" className="note err">
                {importError}
              </p>
            )}
          </section>

          {/* ---------- Settings ---------- */}
          <section className="drawer-section">
            <div className="section-label">Configuration</div>

            {configError !== null && (
              <p role="alert" className="note err">
                {configError}
              </p>
            )}

            <div className="drawer-row">
              <label htmlFor="cfg-redaction" className="field-label">
                Redaction
              </label>
              <button
                id="cfg-redaction"
                type="button"
                role="switch"
                aria-checked={redaction}
                aria-label="Toggle redaction of sensitive output"
                disabled={config === null}
                onClick={() => setRedaction((v) => !v)}
                className={redaction ? 'toggle on' : 'toggle'}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
            </div>

            <div className="field">
              <label htmlFor="cfg-maxbytes" className="field-label">
                Max output bytes
              </label>
              <input
                id="cfg-maxbytes"
                type="number"
                min={1}
                step={1}
                value={maxBytes}
                disabled={config === null}
                onChange={(e) => setMaxBytes(e.target.value)}
                className="text-input mono"
              />
            </div>

            <div className="field">
              <label htmlFor="cfg-exclude-cmds" className="field-label">
                Exclude commands <span className="field-hint">one per line</span>
              </label>
              <textarea
                id="cfg-exclude-cmds"
                value={excludeCommands}
                disabled={config === null}
                onChange={(e) => setExcludeCommands(e.target.value)}
                rows={3}
                className="text-area mono"
                spellCheck={false}
              />
            </div>

            <div className="field">
              <label htmlFor="cfg-exclude-dirs" className="field-label">
                Exclude directories <span className="field-hint">one per line</span>
              </label>
              <textarea
                id="cfg-exclude-dirs"
                value={excludeDirs}
                disabled={config === null}
                onChange={(e) => setExcludeDirs(e.target.value)}
                rows={3}
                className="text-area mono"
                spellCheck={false}
              />
            </div>

            <div className="field">
              <label htmlFor="cfg-patterns" className="field-label">
                Extra redaction patterns{' '}
                <span className="field-hint">one per line</span>
              </label>
              <textarea
                id="cfg-patterns"
                value={extraPatterns}
                disabled={config === null}
                onChange={(e) => setExtraPatterns(e.target.value)}
                rows={3}
                className="text-area mono"
                spellCheck={false}
              />
            </div>

            <div className="drawer-row">
              <button
                type="button"
                className="btn primary"
                disabled={config === null || saveBusy}
                onClick={() => {
                  void handleSave();
                }}
                aria-label="Save configuration"
              >
                <SaveIcon />
                {saveBusy ? 'Saving…' : 'Save'}
              </button>
              {saved && (
                <span role="status" className="saved-note">
                  Saved
                </span>
              )}
            </div>

            {saveError !== null && (
              <p role="alert" className="note err">
                {saveError}
              </p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
