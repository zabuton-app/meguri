// Media listing as a vertical list (alternative to MediaGrid). Each row shows a
// small thumbnail plus title, metadata (resolution/duration/size) and tags.
// thumbVersion forces a reload (cache bust) after a thumbnail-completion event.
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import { formatDuration, formatSize } from "@/lib/format";
import { fileHref } from "@/lib/fileHref";
import { fileNameOf } from "@/lib/relPath";
import { useI18n } from "@/i18n/I18nProvider";
import { useGridKeyboardNav, useScrollToRow } from "@/hooks/useGridKeyboardNav";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";

const ROW_ESTIMATE = 124; // initial row-height estimate (corrected by measurement)

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

// Memoized: Home re-renders on every thumbVersion flush and its other props are
// referentially stable, so the list only re-renders when the data actually changes.
export const MediaList = memo(function MediaList({
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);

  // Rows all share one fixed height (fixed-width thumbnail + fixed-height text
  // block), so instead of measuring every visible row with measureElement (one
  // ResizeObserver + forced reflow per row), measure a single mounted row once
  // and feed it to estimateSize.
  const [rowH, setRowH] = useState(0);
  const measured = useRef(false);
  const measureRow = useCallback((node: HTMLDivElement | null) => {
    if (!node || measured.current) return;
    measured.current = true;
    const h = node.getBoundingClientRect().height;
    setRowH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
  }, []);
  const rowEstimate = rowH || ROW_ESTIMATE;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowEstimate,
    overscan: 8,
    paddingStart: listOffset * rowEstimate,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // estimateSize results are cached per index; drop the cache when the measured
  // row height changes so all row offsets are recomputed with the new size.
  useEffect(() => {
    virtualizer.measure();
    // The virtualizer reference is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowEstimate]);

  // Keyboard focus navigation (vertical; columns=1). Open the focused row on Enter.
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
    columns: 1,
    active: navActive,
    onOpen,
    scrollToRow,
  });

  // Reset the scroll position to the top on workspace switch.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    setFocusedIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // Fetch the next page when a row near the end becomes visible.
  useInfiniteScrollTrigger({
    virtualRows,
    totalRows: items.length,
    threshold: 4,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  });

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-3 rounded-md border border-border bg-surface p-2"
          >
            <Skeleton className="aspect-video w-48 shrink-0 rounded" />
            <div className="flex flex-1 flex-col gap-2 py-1">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
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
            ref={measureRow}
            className="absolute left-0 top-0 w-full px-4 pb-2"
            style={{ transform: `translateY(${vr.start}px)` }}
          >
            <MediaRow
              file={items[vr.index]}
              version={
                thumbVersion[
                  `${items[vr.index].workspaceId}:${items[vr.index].id}`
                ] ?? 0
              }
              mediaBase={mediaBase}
              onTagClick={onTagClick}
              focused={vr.index === focusedIndex}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
});

// Memoize so only rows whose version changed re-render (onTagClick is stabilized in the parent).
const MediaRow = memo(function MediaRow({
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
  // The row is split into two click regions so the click target controls
  // whether the detail view auto-plays. Thumbnail click → auto-play (default);
  // metadata click → opens detail paused (`?autoplay=0`).
  return (
    <div
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group flex gap-3 rounded-md border border-border bg-surface p-2 transition-colors hover:border-primary",
        focused && "border-primary ring-2 ring-primary",
      )}
    >
      <Link
        to={fileHref(file.id, file.workspaceId)}
        className="group/thumb relative block aspect-video w-48 shrink-0 overflow-hidden rounded bg-overlay text-muted"
      >
        <MediaThumbnail file={file} mediaBase={mediaBase} version={version} />
        {file.kind === "video" && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-bg/70 px-1 text-[10px] text-fg">
            {formatDuration(file.duration)}
          </span>
        )}
      </Link>

      <Link
        to={fileHref(file.id, file.workspaceId, { autoplay: false })}
        className="flex min-w-0 flex-1 flex-col gap-1 py-0.5"
      >
        <div className="flex items-center gap-2">
          <div
            className="min-w-0 flex-1 truncate text-sm text-fg"
            title={file.relPath}
          >
            {fileNameOf(file.relPath)}
          </div>
          <RatingButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            rating={file.rating}
            size={14}
          />
          <FavoriteButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            favorite={file.favorite}
            size={16}
            className="shrink-0"
          />
        </div>
        <div className="truncate text-xs text-muted">{metaLine(file)}</div>
        <div className="no-scrollbar flex h-6 items-center gap-1 overflow-x-auto overflow-y-hidden">
          <TagChips tags={file.tags} onTagClick={onTagClick} />
        </div>
      </Link>
    </div>
  );
});

/** Builds the resolution/duration/size metadata line (omitting missing items). */
function metaLine(file: FileRow): string {
  const dims =
    file.width && file.height ? `${file.width}×${file.height}` : null;
  const dur =
    file.kind === "video" && file.duration
      ? formatDuration(file.duration)
      : null;
  const size = formatSize(file.size);
  return [dims, dur, size].filter(Boolean).join(" · ") || "—";
}
