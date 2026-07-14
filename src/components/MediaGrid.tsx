// Media listing grid. Shows thumbnails via thumb://; click to open detail.
// thumbVersion forces a reload (cache bust) after a thumbnail-completion event.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ImageIcon } from "lucide-react";
import type { FileRow } from "@/ipc/types";
import { FavoriteButton } from "@/components/FavoriteButton";
import { RatingButton } from "@/components/RatingButton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { TagChips } from "@/components/TagChips";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { fileHref } from "@/lib/fileHref";
import { useI18n } from "@/i18n/I18nProvider";
import { useGridKeyboardNav, useScrollToRow } from "@/hooks/useGridKeyboardNav";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";

const GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-4";
const MIN_COL = 180; // lower bound of minmax(180px,1fr)
const GAP = 12; // gap-3 = 0.75rem
const SIDE_PAD = 16; // px-4
const ROW_ESTIMATE = 220; // initial row-height estimate (corrected by measurement)

interface Props {
  items: FileRow[];
  /** Base URL for thumbnail/media requests (from app_status). */
  mediaBase: string;
  /** Active workspace ID for thumbnail URL paths (from app_status). */
  workspaceId: string;
  /** Global index offset of items[0] within the full filtered result set. */
  listOffset?: number;
  loading: boolean;
  /** workspaceId:id→update counter. Incrementing on thumb:done reloads the corresponding thumbnail. */
  thumbVersion: Record<string, number>;
  /** Handler for tag clicks (reflected into the search query). */
  onTagClick?: (name: string) => void;
  /** Whether a next page exists (for infinite scroll). */
  hasNextPage?: boolean;
  /** Fetch the next page once the end is approached. */
  fetchNextPage?: () => void;
  /** Flag indicating a next-page fetch is in progress (prevents duplicate fetches). */
  isFetchingNextPage?: boolean;
  /** Whether earlier pages exist before what is loaded. */
  hasPreviousPage?: boolean;
  /** Fetch the previous page once the start is approached. */
  fetchPreviousPage?: () => void;
  /** Flag indicating a previous-page fetch is in progress. */
  isFetchingPreviousPage?: boolean;
  /** Whether keyboard focus navigation is active (list is foreground). */
  navActive?: boolean;
}

export function MediaGrid({
  items,
  mediaBase,
  workspaceId: wsId,
  listOffset = 0,
  loading,
  thumbVersion,
  onTagClick,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  hasPreviousPage,
  fetchPreviousPage,
  isFetchingPreviousPage,
  navActive = false,
}: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  // Scroll parent. Virtualization DOM-renders only the visible rows relative to this element.
  // Because the scroll element mounts later when transitioning from loading to data,
  // a normal ref + initial effect measures nothing and gets stuck at cols=1 (single column).
  // Capture the moment the element is attached into state via a callback ref, and measure each time.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollEl(node);
  }, []);
  const [cols, setCols] = useState(1);

  // Compute the column count from the container width (equivalent to auto-fill minmax(180px,1fr)).
  useEffect(() => {
    if (!scrollEl) return;
    const compute = () => {
      const innerW = scrollEl.clientWidth - SIDE_PAD * 2;
      setCols(Math.max(1, Math.floor((innerW + GAP) / (MIN_COL + GAP))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  // Group items into rows by column count.
  const rows = useMemo(() => {
    const r: FileRow[][] = [];
    for (let i = 0; i < items.length; i += cols)
      r.push(items.slice(i, i + cols));
    return r;
  }, [items, cols]);
  const leadingRows = Math.floor(listOffset / cols);

  // TanStack Virtual returns functions React Compiler can't memoize; the skipped
  // memoization is expected and harmless here (the virtualizer drives its own state).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 4,
    paddingStart: leadingRows * ROW_ESTIMATE,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Keyboard focus navigation (2D, by column count). Open the focused card on Enter.
  const scrollToRow = useScrollToRow(virtualizer);
  // Keyboard Enter opens the detail with auto-play (same intent as a thumbnail click).
  const onOpen = useCallback(
    (index: number) => {
      const f = items[index];
      if (f) void navigate(fileHref(f.id, f.workspaceId));
    },
    [items, navigate],
  );
  const { focusedIndex, setFocusedIndex } = useGridKeyboardNav({
    itemCount: items.length,
    columns: cols,
    active: navActive,
    onOpen,
    scrollToRow,
  });

  // Reset the scroll position to the top on workspace switch (so the previous
  // workspace's position doesn't linger). Also reset the virtualizer's internal offset to 0.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    setFocusedIndex(-1);
    // Reset only when wsId changes. The virtualizer reference is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // Fetch the next page when a row near the end becomes visible (replaces the old IntersectionObserver sentinel).
  useInfiniteScrollTrigger({
    virtualRows,
    totalRows: rows.length,
    threshold: 2,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  });

  if (loading) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-md border border-border bg-surface"
          >
            <Skeleton className="aspect-video rounded-none" />
            <div className="flex flex-col gap-1.5 px-2 py-1.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <ImageIcon className="size-10 opacity-50" />
        <p>{t("grid.empty")}</p>
        <p className="text-xs">{t("grid.emptyHint")}</p>
      </div>
    );
  }

  // Keep the custom scrollbar (shadcn ScrollArea) while using its Viewport as the
  // virtualization scroll element. .page-scroll converts the Viewport child's
  // display:table to block so absolutely positioned rows track the width correctly.
  return (
    <ScrollArea
      className="page-scroll h-full"
      viewportClassName="pt-4"
      viewportRef={setScrollRef}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualRows.map((vr) => (
          <div
            key={vr.key}
            data-index={vr.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${vr.start}px)` }}
          >
            <div
              className="grid gap-3 px-4 pb-3"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {rows[vr.index].map((f, localIndex) => (
                <MediaCard
                  key={`${f.workspaceId}:${f.id}`}
                  file={f}
                  version={thumbVersion[`${f.workspaceId}:${f.id}`] ?? 0}
                  mediaBase={mediaBase}
                  onTagClick={onTagClick}
                  focused={vr.index * cols + localIndex === focusedIndex}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// The parent (MediaGrid) re-renders on every thumb:done, so memoize this and
// only re-render cards whose version changed (onTagClick is stabilized in the parent).
const MediaCard = memo(function MediaCard({
  file,
  version,
  mediaBase,
  onTagClick,
  focused,
}: {
  file: FileRow;
  version: number;
  mediaBase: string;
  onTagClick?: (name: string) => void;
  focused?: boolean;
}) {
  // The card is split into two click regions so the click target controls
  // whether the detail view auto-plays. Thumbnail click → auto-play (default);
  // metadata click → opens detail paused (`?autoplay=0`).
  return (
    <div
      data-testid="media-card"
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group flex flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-primary",
        focused && "border-primary ring-2 ring-primary",
      )}
    >
      <Link
        to={fileHref(file.id, file.workspaceId)}
        className="group/thumb relative block aspect-video overflow-hidden bg-overlay text-muted"
      >
        <MediaThumbnail file={file} mediaBase={mediaBase} version={version} />
        {file.kind === "video" && (
          <span className="absolute bottom-1 right-1 rounded bg-bg/70 px-1 text-[10px] text-fg">
            {formatDuration(file.duration)}
          </span>
        )}
        {/* Favorite toggle. Always visible when favorited; on hover otherwise. */}
        <FavoriteButton
          fileId={file.id}
          workspaceId={file.workspaceId}
          favorite={file.favorite}
          size={16}
          className={cn(
            "absolute right-1 top-1 rounded bg-bg/70 p-1 backdrop-blur-[1px] transition-opacity",
            file.favorite
              ? "opacity-100"
              : "opacity-0 focus:opacity-100 group-hover:opacity-100",
          )}
        />
      </Link>
      {/* Metadata. Fixed height so the card height doesn't change with tag count. */}
      <Link
        to={fileHref(file.id, file.workspaceId, { autoplay: false })}
        className="flex flex-col gap-1 px-2 py-1.5"
      >
        <div className="truncate text-xs text-fg" title={file.relPath}>
          {file.relPath.split("/").pop()}
        </div>
        <div className="truncate text-[10px] text-muted">{metaLine(file)}</div>
        {/* Editable rating. Stops click propagation so it doesn't open the detail. */}
        <RatingButton
          fileId={file.id}
          workspaceId={file.workspaceId}
          rating={file.rating}
          size={14}
        />
        {/* Tags shown in full via horizontal scroll. Click to reflect into the search query. Fixed height. */}
        <div className="no-scrollbar flex h-6 items-center gap-1 overflow-x-auto overflow-y-hidden">
          <TagChips tags={file.tags} onTagClick={onTagClick} />
        </div>
      </Link>
    </div>
  );
});

/** Builds the resolution/duration metadata line (omitting missing items). */
function metaLine(file: FileRow): string {
  const dims =
    file.width && file.height ? `${file.width}×${file.height}` : null;
  const dur =
    file.kind === "video" && file.duration
      ? formatDuration(file.duration)
      : null;
  return [dims, dur].filter(Boolean).join(" · ") || "—";
}
