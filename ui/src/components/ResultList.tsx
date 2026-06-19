import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { ApiResult, CommandSource } from '../api-types';
import { timeGroup } from '../util/format';

/** Estimated height (px) of a timeline command row, for virtualization. */
const ROW_HEIGHT = 46;
/** Estimated height (px) of a time-group header. */
const HEADER_HEIGHT = 33;

/**
 * How close (in flattened-item count) the last rendered item must come to the
 * end of the list before {@link ResultListProps.onLoadMore} fires.
 */
const LOAD_MORE_THRESHOLD = 8;

/** Extra rows rendered above/below the visible window to smooth fast scrolls. */
const OVERSCAN = 12;

export interface ResultListProps {
  /** Search hits to render, in display order (newest first). */
  results: ApiResult[];
  /** Currently selected row id, or `null` when nothing is selected. */
  selectedId: number | null;
  /** Reference time (epoch ms) used to bucket results into time groups. */
  now: number;
  /** Called with a row id when that row becomes the selection. */
  onSelect: (id: number) => void;
  /** Called when the viewport nears the end of the list. */
  onLoadMore: () => void;
}

/** A non-interactive time-group header in the flattened virtual list. */
interface HeaderItem {
  kind: 'header';
  label: string;
}

/** A selectable command row in the flattened virtual list. */
interface RowItem {
  kind: 'row';
  result: ApiResult;
}

/** Discriminated union of everything the virtualizer renders. */
type VirtualRow = HeaderItem | RowItem;

/** Map a command source to its badge class (`pty` / `hook` / `history`). */
function badgeClass(source: CommandSource): string {
  return `badge ${source}`;
}

/** Map an exit code to the timeline node modifier class. */
function nodeClass(exitCode: number | null): string {
  if (exitCode === null) return 'node unknown';
  return exitCode === 0 ? 'node' : 'node bad';
}

/**
 * Flatten the flat result array into a mixed sequence of group headers and
 * command rows, inserting a header whenever the time bucket changes. Because
 * results arrive newest-first and `timeGroup` buckets monotonically, a simple
 * "did the label change?" check yields correctly ordered, non-repeating groups.
 */
function flatten(results: ApiResult[], now: number): VirtualRow[] {
  const items: VirtualRow[] = [];
  let lastLabel: string | null = null;
  for (const result of results) {
    const label = timeGroup(result.startedAt, now);
    if (label !== lastLabel) {
      items.push({ kind: 'header', label });
      lastLabel = label;
    }
    items.push({ kind: 'row', result });
  }
  return items;
}

/**
 * Compact relative-age label for the row's right edge (e.g. `2m`, `8h`, `3w`).
 * Mirrors the design's terse `.when` column rather than the verbose
 * "N ago" phrasing used elsewhere.
 */
function shortAge(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const week = 604_800_000;
  const month = 2_592_000_000;
  const year = 31_536_000_000;
  if (diff < min) return 'now';
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < week) return `${Math.floor(diff / day)}d`;
  if (diff < month) return `${Math.floor(diff / week)}w`;
  if (diff < year) return `${Math.floor(diff / month)}mo`;
  return `${Math.floor(diff / year)}y`;
}

/**
 * Virtualized, keyboard-navigable timeline of command search results.
 *
 * Results are flattened into a mixed array of time-group headers and command
 * rows; only the visible window is mounted, so rendering tens of thousands of
 * results keeps a bounded number of DOM nodes. Clicking or arrowing to a row
 * drives `onSelect` (headers are skipped during keyboard navigation); scrolling
 * near the tail drives `onLoadMore` (at most once per boundary).
 */
function ResultList({
  results,
  selectedId,
  now,
  onSelect,
  onLoadMore,
}: ResultListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => flatten(results, now), [results, now]);

  // Index of each selectable row within the flattened `items` array, in order;
  // used to translate ↑/↓ into row-to-row jumps that skip header items.
  const rowIndices = useMemo(() => {
    const out: number[] = [];
    items.forEach((item, index) => {
      if (item.kind === 'row') out.push(index);
    });
    return out;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      items[index]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => {
      const item = items[index];
      if (item?.kind === 'row') return `row-${item.result.id}`;
      return `header-${index}`;
    },
  });

  // Track the result length at which we last asked for more, so a single
  // boundary crossing fires onLoadMore exactly once. When new results arrive
  // (length changes) the guard naturally re-arms for the next boundary.
  const loadMoreRequestedAt = useRef<number>(-1);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.length
    ? virtualItems[virtualItems.length - 1]!.index
    : -1;

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    const nearEnd = lastVisibleIndex >= items.length - 1 - LOAD_MORE_THRESHOLD;
    if (nearEnd && loadMoreRequestedAt.current !== results.length) {
      loadMoreRequestedAt.current = results.length;
      onLoadMore();
    }
  }, [lastVisibleIndex, items.length, results.length, onLoadMore]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (rowIndices.length === 0) {
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();

        // Position within the row-only sequence so we step row→row, never onto
        // a header.
        const currentRowPos = rowIndices.findIndex(
          (itemIndex) =>
            (items[itemIndex] as RowItem).result.id === selectedId,
        );
        const delta = event.key === 'ArrowDown' ? 1 : -1;

        let nextRowPos: number;
        if (currentRowPos === -1) {
          nextRowPos = event.key === 'ArrowDown' ? 0 : rowIndices.length - 1;
        } else {
          nextRowPos = currentRowPos + delta;
          if (nextRowPos < 0 || nextRowPos >= rowIndices.length) {
            return; // Already at a boundary; do nothing.
          }
        }

        const nextItemIndex = rowIndices[nextRowPos]!;
        const nextItem = items[nextItemIndex] as RowItem;
        virtualizer.scrollToIndex(nextItemIndex, { align: 'auto' });
        onSelect(nextItem.result.id);
        return;
      }

      // Enter is intentionally a no-op: selection already drives the detail
      // pane, so there is nothing further to confirm.
      if (event.key === 'Enter') {
        event.preventDefault();
      }
    },
    [items, rowIndices, selectedId, onSelect, virtualizer],
  );

  return (
    <nav
      ref={scrollRef}
      className="list"
      aria-label="Command history"
      role="listbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className="rail"
        style={{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (!item) {
            return null;
          }

          const baseStyle: React.CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualItem.start}px)`,
          };

          if (item.kind === 'header') {
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="group"
                style={baseStyle}
              >
                {item.label}
              </div>
            );
          }

          const { result } = item;
          const isSelected = result.id === selectedId;

          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              role="option"
              aria-selected={isSelected}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => onSelect(result.id)}
              className={isSelected ? 'row sel' : 'row'}
              style={baseStyle}
            >
              <span className={nodeClass(result.exitCode)} aria-hidden="true" />
              <div className="cmd">
                <div className="line">{result.command}</div>
                <div className="meta">
                  <span className="cwd">{result.cwd ?? '~'}</span>
                  <span className={badgeClass(result.source)}>
                    {result.source}
                  </span>
                </div>
              </div>
              <span className="when">{shortAge(result.startedAt, now)}</span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default ResultList;
