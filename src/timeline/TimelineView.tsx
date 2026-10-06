// The timeline: the list ordered by a date, newest first, cut into a section
// per day under a header that stays at the top while its files are shown,
// with a rail of every month down the side.
//
// The rows are laid out from the day counts alone (see layout.ts), so the
// whole height is there before any file is read and the rail can move the
// list to any month. The files come from the same windowed files_search every
// other view reads: rows the window does not cover are drawn as placeholders,
// and the window is moved to wherever the view is (see anchor.ts).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MediaCard, useCardGridMetrics } from "@/components/MediaGrid";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivateFile } from "@/audio/useActivateFile";
import {
  useGridKeyboardNav,
  useScrollToRow,
  type GridNavDirection,
} from "@/hooks/useGridKeyboardNav";
import { usePublishFocusedFile } from "@/hooks/useFocusedFile";
import type { FolderViewEntry } from "@/hooks/useFolderEntries";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow, SearchQuery } from "@/ipc/types";
import {
  FILES_SEARCH_PAGE_SIZE,
  type FilesSearchPageParam,
} from "@/lib/filesSearch";
import type { TimelineAxis } from "@shared/ipc/timeline";
import { anchorFor } from "./anchor";
import {
  buildLayout,
  rowAt,
  rowOfIndex,
  sectionOfIndex,
  sectionOfRow,
  stepIndex,
  UNDATED,
  type TimelineSection,
} from "./layout";
import { dayLabel, railKeyOf, sectionKeyOf } from "./dates";
import { TimelineAxisToggle } from "./TimelineAxisToggle";
import {
  TimelineScrubber,
  type RailDay,
  type RailMonth,
} from "./TimelineScrubber";
import { useTimelineCounts } from "./useTimelineCounts";

/** Height of a section header row (h-10). The rail's offsets are built from
 *  this and the row estimate, so they are on the virtualizer's scale. */
const HEADER_H = 40;
/** Space under a row of cards (pb-3), which a placeholder row keeps too. */
const ROW_GAP = 12;

interface Props {
  /** Workspace (or collection) the list is of, as files_search keys it. */
  scope: string;
  /** The filter; its sort is not read (the axis orders the list). */
  query: SearchQuery;
  axis: TimelineAxis;
  onAxisChange: (axis: TimelineAxis) => void;
  ready: boolean;
  /** The window of the list that is loaded, and where in the list it starts. */
  items: FileRow[];
  listOffset: number;
  /** The window's first page has not arrived. */
  loading: boolean;
  mediaBase: string;
  thumbVersion: Record<string, number>;
  onTagClick?: (name: string) => void;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  hasPreviousPage?: boolean;
  fetchPreviousPage?: () => void;
  isFetchingPreviousPage?: boolean;
  /** Reads the list again from a cursor: the view has left the window. */
  onAnchor: (anchor: FilesSearchPageParam) => void;
  navActive?: boolean;
  watchLater?: boolean;
}

export const TimelineView = memo(function TimelineView({
  scope,
  query,
  axis,
  onAxisChange,
  ready,
  items,
  listOffset,
  loading,
  mediaBase,
  thumbVersion,
  onTagClick,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  hasPreviousPage,
  fetchPreviousPage,
  isFetchingPreviousPage,
  onAnchor,
  navActive = false,
  watchLater = false,
}: Props) {
  const { t, lang } = useI18n();
  const watchLaterMembership = useWatchLater();
  const counts = useTimelineCounts({ scope, query, axis, enabled: ready });

  // The scroll element mounts after the counts arrive; captured in state so
  // the metrics measure it then (see MediaGrid).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollEl(node);
  }, []);
  const { cols, rowEstimate, measureRow } = useCardGridMetrics(scrollEl);

  // Where the view is, read off the scroll element itself: the section at the
  // top and the window under the view both follow it.
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = () => setScrollTop(scrollEl.scrollTop);
    onScroll();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  const layout = useMemo(
    () => buildLayout(counts.data, cols),
    [counts.data, cols],
  );
  const headerRows = useMemo(
    () => new Set(layout.sections.map((s) => s.headerRow)),
    [layout],
  );

  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (row) => (headerRows.has(row) ? HEADER_H : rowEstimate),
    overscan: 4,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Sizes are cached per row; drop them when a row's height or kind changes.
  useEffect(() => {
    virtualizer.measure();
    // The virtualizer reference is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowEstimate, headerRows]);

  // Keyboard focus is an index into the whole list, so it can sit on a file
  // the window has not reached: the move scrolls there and the file follows.
  const navLayout = useMemo(
    () => ({
      step: (index: number, direction: GridNavDirection) =>
        stepIndex(layout, index, direction),
      rowOf: (index: number) => rowOfIndex(layout, index),
    }),
    [layout],
  );
  const { activate } = useActivateFile();
  const fileAt = useCallback(
    (index: number): FileRow | undefined => items[index - listOffset],
    [items, listOffset],
  );
  const onOpen = useCallback(
    (index: number) => {
      const file = fileAt(index);
      if (file) activate(file);
    },
    [fileAt, activate],
  );
  const onInspect = useCallback(
    (index: number) => {
      const file = fileAt(index);
      if (file) activate(file, { autoplay: false });
    },
    [fileAt, activate],
  );
  const scrollToRow = useScrollToRow(virtualizer);
  const { focusedIndex, setFocusedIndex } = useGridKeyboardNav({
    itemCount: layout.total,
    columns: cols,
    active: navActive,
    onOpen,
    onInspect,
    scrollToRow,
    layout: navLayout,
  });
  const focusedWatchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({ active: navActive, buttonRef: focusedWatchLaterRef });
  // The command menu acts on the focused file.
  const focusedFile = fileAt(focusedIndex);
  const focusedEntries = useMemo<FolderViewEntry[]>(
    () =>
      focusedFile ? [{ kind: "file", file: focusedFile, fileIndex: 0 }] : [],
    [focusedFile],
  );
  usePublishFocusedFile(focusedEntries, 0);

  // Another list (scope, filter or axis) starts from its top.
  const listKey = `${scope}|${axis}|${JSON.stringify(query)}`;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    setFocusedIndex(-1);
    // Reset only when the list changes. The virtualizer reference is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // The row under the top edge. A row ending on the edge is above it: the
  // ends are sums of estimates, which can come out a hair past the integer
  // offset a jump scrolled to.
  const topRow =
    virtualRows.find((vr) => vr.end > scrollTop + 1) ?? virtualRows[0];

  // The files on screen, as a range of the whole list: `topIndex` is the
  // first at the top edge itself, the other two take in the rows kept mounted
  // around the viewport, which read a little ahead.
  let topIndex = -1;
  let visibleFirst = -1;
  let visibleLast = -1;
  for (const vr of virtualRows) {
    const row = rowAt(layout, vr.index);
    if (row?.kind !== "cards") continue;
    if (visibleFirst < 0) visibleFirst = row.first;
    if (topIndex < 0 && topRow && vr.index >= topRow.index)
      topIndex = row.first;
    visibleLast = row.first + row.length - 1;
  }
  if (topIndex < 0) topIndex = visibleFirst;

  // Keep the window under the view. Next to the window a page is added at the
  // edge the view nears; away from it (a jump on the rail, a drag of the
  // scrollbar) the list is read again from where the view is — from the row
  // at the top edge, so a jump lands at a section's head, which the main
  // process seeks to. That second move is made only when the view itself
  // moved (the detail view steps through the list and slides the window on
  // its own, and must not be pulled back to a list left where it was), and
  // once it has come to rest: a drag of the scrollbar passes a page every
  // frame, and a read of each would queue up behind one another.
  const scrolling = virtualizer.isScrolling;
  const viewMark = `${scrollTop}|${cols}|${layout.total}|${listKey}`;
  const lastViewMark = useRef("");
  useEffect(() => {
    const moved = lastViewMark.current !== viewMark;
    if (visibleFirst < 0) return;
    const loadedEnd = listOffset + items.length;
    const near =
      items.length > 0 &&
      visibleFirst < loadedEnd + FILES_SEARCH_PAGE_SIZE &&
      visibleLast >= listOffset - FILES_SEARCH_PAGE_SIZE;
    if (!near) {
      // A move is spent only once acted on: one made while the list is still
      // being read (or still scrolling) waits for the next run.
      if (scrolling || (loading && items.length === 0)) return;
      lastViewMark.current = viewMark;
      if (moved) onAnchor(anchorFor(layout, topIndex));
      return;
    }
    lastViewMark.current = viewMark;
    // One page at a time: react-query cancels a fetch in flight when the
    // other direction is asked for, and the two would cancel each other
    // for as long as both edges are in view.
    if (isFetchingNextPage || isFetchingPreviousPage) return;
    const margin = cols * 2;
    if (visibleLast >= loadedEnd - margin && hasNextPage) fetchNextPage?.();
    else if (topIndex < listOffset + margin && hasPreviousPage)
      fetchPreviousPage?.();
  }, [
    viewMark,
    scrolling,
    topIndex,
    visibleFirst,
    visibleLast,
    listOffset,
    items.length,
    loading,
    layout,
    cols,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
    onAnchor,
  ]);

  // The counts and the list are two reads: a scan between them can leave a
  // file under another day's header. Seeing one, the counts are read again;
  // if the two still disagree with fresh counts, the list's own offset is the
  // stale one (a refetch keeps the offset the window was opened at, while
  // files were added before it), and the list is read again from where the
  // view is. Each is done once per window, so a list that cannot agree does
  // not spin.
  const { refetch: refetchCounts, isFetching } = counts;
  const recounted = useRef("");
  const realigned = useRef("");
  useEffect(() => {
    const first = items[0];
    if (!first || isFetching) return;
    const section = sectionOfIndex(layout, listOffset);
    if (section && section.key === sectionKeyOf(first, axis)) return;
    const mark = `${listOffset}|${first.workspaceId}:${first.id}`;
    if (recounted.current !== mark) {
      recounted.current = mark;
      void refetchCounts();
    } else if (realigned.current !== mark && topIndex >= 0) {
      realigned.current = mark;
      onAnchor(anchorFor(layout, topIndex));
    }
  }, [
    items,
    listOffset,
    layout,
    axis,
    isFetching,
    refetchCounts,
    topIndex,
    onAnchor,
  ]);

  // The section at the top of the view: its header stays there, and the rail
  // marks its month.
  const current: TimelineSection | null = topRow
    ? sectionOfRow(layout, topRow.index)
    : (layout.sections[0] ?? null);

  // A jump lands on a section's header. The rows are placed by estimate, and
  // the estimate can still move a little after the jump (the fonts settling,
  // the rows of the new window measured), which would leave the header a few
  // rows off: so the jump is kept and made again as the rows settle, until
  // the header is where it was sent, or the user scrolls elsewhere.
  const jump = useRef<{ row: number; sentTo: number } | null>(null);
  const alignJump = useCallback(() => {
    const el = scrollRef.current;
    const target = jump.current;
    if (!el || !target) return;
    const offset = virtualizer.getOffsetForIndex(target.row, "start")?.[0];
    if (offset == null) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const to = Math.min(offset, max);
    target.sentTo = to;
    if (Math.abs(el.scrollTop - to) < 1) return;
    virtualizer.scrollToOffset(to);
  }, [virtualizer]);
  // The sections as the rail draws them: a month each (the days of one are
  // gathered under it, at the first's offset), from the same estimates the
  // rows are placed by; the days themselves, for the rail's ticks; and, for
  // a key the rail hands back, the header row of the month's first day.
  const { railMonths, railDays, railHeads } = useMemo(() => {
    const railMonths: RailMonth[] = [];
    const railDays: RailDay[] = [];
    const railHeads = new Map<string, number>();
    let top = 0;
    for (const s of layout.sections) {
      const key = railKeyOf(s.key);
      const last = railMonths[railMonths.length - 1];
      if (last && last.key === key) last.count += s.count;
      else {
        railMonths.push({ key, count: s.count, top });
        railHeads.set(key, s.headerRow);
      }
      if (s.key !== UNDATED) railDays.push({ key: s.key, count: s.count, top });
      top += HEADER_H + s.rows * rowEstimate;
    }
    return { railMonths, railDays, railHeads };
  }, [layout, rowEstimate]);

  // A key from the rail names a month: the list goes to its first day.
  const onJump = useCallback(
    (key: string) => {
      const row = railHeads.get(key);
      if (row == null) return;
      jump.current = { row, sentTo: -1 };
      alignJump();
    },
    [railHeads, alignJump],
  );
  useEffect(alignJump, [alignJump, rowEstimate, items, layout]);
  // The rail dragged: the list goes where the pointer is, and a jump under
  // way is given up.
  const onScrollTo = useCallback(
    (offset: number) => {
      jump.current = null;
      virtualizer.scrollToOffset(offset);
    },
    [virtualizer],
  );
  const totalSize = virtualizer.getTotalSize();
  const viewHeight = scrollEl?.clientHeight ?? 0;
  useEffect(() => {
    // A scroll the jump did not ask for ends it.
    const target = jump.current;
    if (target && target.sentTo >= 0 && Math.abs(scrollTop - target.sentTo) > 1)
      jump.current = null;
  }, [scrollTop]);
  useEffect(() => {
    jump.current = null;
  }, [listKey]);

  const sectionLabel = (section: TimelineSection) =>
    section.key === UNDATED
      ? t("timeline.undated")
      : dayLabel(section.key, lang);

  if (counts.isError && !counts.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {t("timeline.error")}
      </div>
    );
  }

  if (!counts.data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-4">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video" />
        ))}
      </div>
    );
  }

  if (layout.total === 0) {
    return <MediaEmptyState watchLater={watchLater} />;
  }

  return (
    <div className="flex h-full min-h-0" data-slot="timeline">
      <div className="relative min-w-0 flex-1">
        <ScrollArea className="page-scroll h-full" viewportRef={setScrollRef}>
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualRows.map((vr) => {
              const row = rowAt(layout, vr.index);
              if (!row) return null;
              if (row.kind === "header") {
                return (
                  <div
                    key={vr.key}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${vr.start}px)` }}
                  >
                    <SectionHeader
                      label={sectionLabel(row.section)}
                      count={t("timeline.count", { count: row.section.count })}
                    />
                  </div>
                );
              }
              const cells = Array.from(
                { length: row.length },
                (_, i) => row.first + i,
              );
              // Only a row holding a card is measured: a row of placeholders
              // has no thumbnail to read the height from.
              const loaded = cells.some((i) => fileAt(i));
              return (
                <div
                  key={vr.key}
                  ref={loaded ? measureRow : undefined}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vr.start}px)` }}
                >
                  <div
                    className="grid gap-3 px-4 pb-3"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    }}
                  >
                    {cells.map((index) => {
                      const file = fileAt(index);
                      if (!file)
                        return (
                          <Skeleton
                            key={`pending:${index}`}
                            data-testid="timeline-pending"
                            style={{ height: rowEstimate - ROW_GAP }}
                          />
                        );
                      const focused = index === focusedIndex;
                      return (
                        <MediaCard
                          key={`${file.workspaceId}:${file.id}`}
                          file={file}
                          index={index - listOffset}
                          version={
                            thumbVersion[`${file.workspaceId}:${file.id}`] ?? 0
                          }
                          mediaBase={mediaBase}
                          onTagClick={onTagClick}
                          focused={focused}
                          watchLater={watchLaterMembership}
                          watchLaterRef={
                            focused ? focusedWatchLaterRef : undefined
                          }
                          fileDraggable
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        {/* The header of the section at the top, over the rows scrolling
            under it. Rows are placed by transform, where `position: sticky`
            has nothing to hold on to, so it is drawn once here instead. */}
        {current && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <SectionHeader
              label={sectionLabel(current)}
              count={t("timeline.count", { count: current.count })}
              pinned
            >
              <TimelineAxisToggle
                axis={axis}
                onChange={onAxisChange}
                className="pointer-events-auto"
              />
            </SectionHeader>
          </div>
        )}
      </div>
      <TimelineScrubber
        months={railMonths}
        days={railDays}
        totalSize={totalSize}
        viewHeight={viewHeight}
        scrollTop={scrollTop}
        current={current ? railKeyOf(current.key) : null}
        onScrollTo={onScrollTo}
        onJump={onJump}
      />
    </div>
  );
});

function SectionHeader({
  label,
  count,
  pinned = false,
  children,
}: {
  label: string;
  count: string;
  /** The copy held at the top of the view, over the list. */
  pinned?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot={pinned ? "timeline-pinned-header" : "timeline-header"}
      className="flex h-10 items-center gap-2 bg-bg px-4"
      style={{ height: HEADER_H }}
    >
      <h2 className="text-sm font-medium text-fg">{label}</h2>
      <span className="text-xs text-muted">{count}</span>
      {children && (
        <div className="ml-auto mr-3 flex items-center gap-2">{children}</div>
      )}
    </div>
  );
}
