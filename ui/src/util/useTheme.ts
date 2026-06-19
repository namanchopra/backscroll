import { useCallback, useEffect, useState } from 'react';

/** The two supported color schemes for the app shell. */
export type Theme = 'light' | 'dark';

/** localStorage key under which the user's explicit theme choice persists. */
const STORAGE_KEY = 'backscroll-theme';

/**
 * Resolve the initial theme: an explicit, previously persisted choice wins;
 * otherwise fall back to the OS preference (light only when the user has set a
 * light system theme), defaulting to dark — matching the recorder's console
 * aesthetic — when nothing else is known.
 */
function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode); fall through to media.
  }

  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }
  } catch {
    // matchMedia unsupported; fall through to the dark default.
  }

  return 'dark';
}

/**
 * Theme state for the BackScroll shell.
 *
 * Returns the current {@link Theme} plus a stable toggle that flips it. The
 * choice is persisted to `localStorage` so it survives reloads; the value is
 * meant to be applied as a `data-theme` attribute on the `.app` root, where the
 * CSS variables in index.css resolve the rest.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persisting is best-effort; ignore quota/availability errors.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle };
}
