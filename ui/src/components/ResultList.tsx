import { useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { ApiResult } from '../api-types';
import { relativeTime, statusClass, statusGlyph } from '../util/format';

/** Fixed row height (px) used for virtualization estimates. */
const ROW_HEIGHT = 44;

/**
 * How close (in row count) the last rendered item must come to the end of the
 * list before {@link ResultListProps.onLoadMore} fires.
 */
const LOAD_MORE_THRESHOLD = 8;

/** Extra rows rendered above/below the visible window to smooth fast scrolls. */
const OVERSCAN = 10;

export interface ResultListProps {
  /** Search hits to render, in display order. */
  results: ApiResult[];
  /** Currently selected row id, or `null` when nothing is selected. */
  selectedId: number | null;
  /** Reference time (epoch ms) used to format relative timestamps. */
  now: number;
  /** Called with a row id when that row becomes the selection. */
  onSelect: (id: number) => void;
  /** Called when the viewport nears the end of the list. */
  onLoadMore: () => void;
}

/**
 * Virtualized, keyboard-navigable list of command search results.
 *
 * Only the visible window of rows is mounted, so rendering tens of thousands of
 * results keeps a bounded number of DOM nodes. Clicking or arrowing to a row
 * drives `onSelect`; scrolling near the tail drives `onLoadMore` (at most once
 * per boundary).
 */
function ResultList({
  results,
  selectedId,
  now,
  onSelect,
  onLoadMore,
}: ResultListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => results[index]?.id ?? index,
  });

  // Track the list length at which we last asked for more, so a single
  // boundary crossing fires onLoadMore exactly once. When new results arrive
  // (length changes) the guard naturally re-arms for the next boundary.
  const loadMoreRequestedAt = useRef<number>(-1);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.length
    ? virtualItems[virtualItems.length - 1]!.index
    : -1;

  useEffect(() => {
    if (results.length === 0) {
      return;
    }
    const nearEnd =
      lastVisibleIndex >= results.length - 1 - LOAD_MORE_THRESHOLD;
    if (nearEnd && loadMoreRequestedAt.current !== results.length) {
      loadMoreRequestedAt.current = results.length;
      onLoadMore();
    }
  }, [lastVisibleIndex, results.length, onLoadMore]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (results.length === 0) {
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();

        const currentIndex = results.findIndex((r) => r.id === selectedId);
        const delta = event.key === 'ArrowDown' ? 1 : -1;

        let nextIndex: number;
        if (currentIndex === -1) {
          // No current selection: enter from the appropriate end.
          nextIndex = event.key === 'ArrowDown' ? 0 : results.length - 1;
        } else {
          nextIndex = currentIndex + delta;
          if (nextIndex < 0 || nextIndex >= results.length) {
            return; // Already at a boundary; do nothing.
          }
        }

        const next = results[nextIndex];
        if (next) {
          virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
          onSelect(next.id);
        }
        return;
      }

      // Enter is intentionally a no-op: selection already drives the detail
      // pane, so there is nothing further to confirm.
      if (event.key === 'Enter') {
        event.preventDefault();
      }
    },
    [results, selectedId, onSelect, virtualizer],
  );

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Search results"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full overflow-auto bg-slate-950 font-mono text-sm text-slate-300 outline-none focus-visible:ring-1 focus-visible:ring-sky-500/60"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const result = results[virtualItem.index];
          if (!result) {
            return null;
          }

          const isSelected = result.id === selectedId;

          return (
            <div
              key={virtualItem.key}
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(result.id)}
              className={[
                'absolute left-0 top-0 flex w-full cursor-pointer items-center gap-3 border-l-2 px-3',
                'whitespace-nowrap',
                isSelected
                  ? 'border-sky-400 bg-slate-800/80'
                  : 'border-transparent hover:bg-slate-900/70',
              ].join(' ')}
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <span
                aria-hidden="true"
                className={[
                  'w-4 shrink-0 text-center font-semibold',
                  statusClass(result.exitCode),
                ].join(' ')}
              >
                {statusGlyph(result.exitCode)}
              </span>

              <span className="w-20 shrink-0 truncate text-right text-slate-500">
                {relativeTime(result.startedAt, now)}
              </span>

              <span className="max-w-[14rem] shrink-0 truncate text-slate-500">
                {result.cwd ?? '~'}
              </span>

              <span className="min-w-0 flex-1 truncate text-slate-200">
                {result.command}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ResultList;
