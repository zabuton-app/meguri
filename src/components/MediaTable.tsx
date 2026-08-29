// Media listing as a data table (alternative to MediaGrid / MediaList).
// Uses CSS-grid div rows (role="table") rather than a real <table>, mirroring
// MediaGrid's proven full-width pattern: an explicit width:100% container with
// absolutely positioned virtualized rows. A real <table display:grid> collapses
// its 1fr columns inside the Radix ScrollArea wrapper, so we avoid it here.
// thumbVersion forces a reload (cache bust) after a thumbnail-completion event.
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MediaReorderProvider,
  type MediaReorder,
} from "@/components/MediaReorder";
import { mediaSortId } from "@/lib/mediaSortId";
import type { FileRow } from "@/ipc/types";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import {
  useWatchLater,
  type WatchLaterMembership,
} from "@/hooks/useWatchLater";
import { RatingButton } from "@/components/RatingButton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { TagChips } from "@/components/TagChips";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDuration, formatSize } from "@/lib/format";
import { fileHref } from "@/lib/fileHref";
import { fileNameOf } from "@/lib/relPath";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { useGridKeyboardNav, useScrollToRow } from "@/hooks/useGridKeyboardNav";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";

const ROW_HEIGHT = 114; // fixed row height (thumbnail 180×101.25 + padding)
// Column layout shared by the header and every body row so cells stay aligned.
// name + tags are the flexible (fr) columns that absorb the remaining width;
// every column has a px minimum so the grid never collapses columns onto each
// other — below MIN_TABLE_WIDTH the table scrolls horizontally instead.
const GRID_COLS = "200px minmax(280px,1fr) 72px 110px 80px 96px 190px 220px";
// Sum of the per-column minimums above (used as the table's min-width).
const MIN_TABLE_WIDTH = 200 + 280 + 72 + 110 + 80 + 96 + 190 + 220;

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
  /** Whether the active view is the built-in Watch Later collection (changes empty-state copy). */
  watchLater?: boolean;
  /** Set only while a collection is shown in its manual order; enables drag-to-reorder. */
  reorder?: MediaReorder;
}

// Memoized: Home re-renders on every thumbVersion flush and its other props are
// referentially stable, so the table only re-renders when the data actually changes.
export const MediaTable = memo(function MediaTable({
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
  watchLater = false,
  reorder,
}: Props) {
  const { t } = useI18n();
  const watchLaterMembership = useWatchLater();
  const navigate = useNavigate();

  // Capture the scroll viewport into state so we can measure its width (the
  // element mounts after the loading→data transition, so a plain ref + effect
  // would measure nothing). The measured width is applied to the table in px so
  // the grid's fr columns fill exactly (CSS width:100% doesn't resolve reliably
  // inside the Radix ScrollArea wrapper).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollEl(node);
  }, []);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!scrollEl) return;
    const compute = () => setWidth(scrollEl.clientWidth);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  // The table is at least MIN_TABLE_WIDTH wide; below the viewport width it
  // overflows and scrolls horizontally rather than overlapping columns.
  const tableWidth = Math.max(width, MIN_TABLE_WIDTH);

  // TanStack Virtual returns functions React Compiler can't memoize; the skipped
  // memoization is expected and harmless here (the virtualizer drives its own state).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    paddingStart: listOffset * ROW_HEIGHT,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Keyboard focus navigation (vertical; columns=1). Open the focused row on Enter.
  // Keyboard Enter opens the detail with auto-play (same intent as a thumbnail click).
  const scrollToRow = useScrollToRow(virtualizer);
  const onOpen = useCallback(
    (index: number) => {
      const f = items[index];
      if (f) void navigate(fileHref(f.id, f.workspaceId));
    },
    [items, navigate],
  );
  // Shared row click handler: routes to the detail view either with or without
  // auto-play. `useCallback` keeps the function reference stable so memoized
  // rows don't re-render on every parent update (e.g. on thumb:done bumps).
  const onRowOpen = useCallback(
    (index: number, autoplay: boolean) => {
      const f = items[index];
      if (f) void navigate(fileHref(f.id, f.workspaceId, { autoplay }));
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
    threshold: 8,
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
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="aspect-video w-[180px] shrink-0 rounded" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <MediaEmptyState watchLater={watchLater} />;
  }

  return (
    <MediaReorderProvider items={items} reorder={reorder}>
      <ScrollArea className="page-scroll h-full" viewportRef={setScrollRef}>
        <div role="table" style={{ width: tableWidth }} className="text-sm">
          {/* Sticky header. Same grid columns as rows so cells line up. */}
          <div
            role="row"
            className="sticky top-0 z-10 grid border-b border-border bg-surface text-muted"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <HeadCell />
            <HeadCell>{t("table.name")}</HeadCell>
            <HeadCell>{t("media.metaKind")}</HeadCell>
            <HeadCell>{t("media.metaResolution")}</HeadCell>
            <HeadCell>{t("media.metaDuration")}</HeadCell>
            <HeadCell>{t("media.metaSize")}</HeadCell>
            <HeadCell>{t("media.rating")}</HeadCell>
            <HeadCell>{t("media.tags")}</HeadCell>
          </div>
          {/* Body. Height reserved for all rows; only visible rows are mounted. */}
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize(), width: "100%" }}
          >
            {virtualRows.map((vr) => {
              const file = items[vr.index];
              const rowProps = {
                index: vr.index,
                file,
                version: thumbVersion[mediaSortId(file)] ?? 0,
                mediaBase,
                top: vr.start,
                onTagClick,
                focused: vr.index === focusedIndex,
                watchLater: watchLaterMembership,
                onOpen: onRowOpen,
                t,
              };
              return reorder ? (
                <SortableTableRow key={mediaSortId(file)} {...rowProps} />
              ) : (
                <MediaTableRow key={mediaSortId(file)} {...rowProps} />
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </MediaReorderProvider>
  );
});

function HeadCell({ children }: { children?: ReactNode }) {
  return (
    <div
      role="columnheader"
      className="flex h-10 items-center truncate px-2 font-medium"
    >
      {children}
    </div>
  );
}

// Memoize so only rows whose version changed re-render (handlers are stabilized in the parent).
const MediaTableRow = memo(function MediaTableRow({
  index,
  file,
  version,
  mediaBase,
  top,
  onTagClick,
  focused,
  watchLater,
  onOpen,
  t,
  dnd,
}: {
  index: number;
  file: FileRow;
  version: number;
  mediaBase: string;
  top: number;
  onTagClick?: (name: string) => void;
  focused?: boolean;
  watchLater: WatchLaterMembership;
  /** Opens the detail view. `autoplay=true` (thumbnail click) plays automatically. */
  onOpen: (index: number, autoplay: boolean) => void;
  t: TFunc;
  /** Drag wiring, present only while the collection is in manual order. */
  dnd?: DragWiring;
}) {
  // The row's default click opens the detail view paused (treated as a
  // "metadata" click). The thumbnail cell stops propagation and opts in to
  // auto-play instead. The rating cell also stops propagation so accidental
  // clicks on its empty padding around the heart icon don't open the detail.
  return (
    <div
      role="row"
      aria-current={focused ? "true" : undefined}
      onClick={() => onOpen(index, false)}
      ref={dnd?.ref}
      className={cn(
        "absolute left-0 top-0 grid w-full cursor-pointer items-center border-b border-border transition-colors hover:bg-overlay/50",
        focused && "bg-primary/15 ring-2 ring-inset ring-primary",
        dnd && "touch-none",
        dnd?.isDragging && "opacity-60",
      )}
      style={{
        height: ROW_HEIGHT,
        // The virtual offset comes first; the drag offset rides on top of it.
        transform: `translateY(${top}px) ${dnd?.transform ?? ""}`.trimEnd(),
        transition: dnd?.transition,
        zIndex: dnd?.isDragging ? 1 : undefined,
        gridTemplateColumns: GRID_COLS,
      }}
      {...dnd?.attributes}
      {...dnd?.listeners}
    >
      <div
        role="cell"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(index, true);
        }}
        className="group/thumb flex items-center px-2"
      >
        <div className="relative aspect-video w-[180px] shrink-0 overflow-hidden rounded bg-overlay text-muted">
          <MediaThumbnail
            file={file}
            mediaBase={mediaBase}
            version={version}
            fallbackIconSize="size-7"
            playOverlaySize="size-8"
            playIconSize="size-4"
          />
        </div>
      </div>
      <div role="cell" className="flex items-center px-2">
        <span className="truncate text-fg" title={file.relPath}>
          {fileNameOf(file.relPath)}
        </span>
      </div>
      <div role="cell" className="flex items-center px-2 text-muted">
        {file.kind === "video" ? t("kind.video") : t("kind.image")}
      </div>
      <div role="cell" className="flex items-center px-2 text-muted">
        {file.width && file.height ? `${file.width}×${file.height}` : "—"}
      </div>
      <div role="cell" className="flex items-center px-2 text-muted">
        {file.kind === "video" && file.duration
          ? formatDuration(file.duration)
          : "—"}
      </div>
      <div role="cell" className="flex items-center px-2 text-muted">
        {formatSize(file.size, "—")}
      </div>
      <div
        role="cell"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 px-2"
      >
        <FavoriteButton
          fileId={file.id}
          workspaceId={file.workspaceId}
          favorite={file.favorite}
          size={14}
        />
        <WatchLaterButton
          fileId={file.id}
          workspaceId={file.workspaceId}
          watchLater={watchLater}
          size={14}
        />
        <RatingButton
          fileId={file.id}
          workspaceId={file.workspaceId}
          rating={file.rating}
          size={14}
        />
      </div>
      <div role="cell" className="flex items-center px-2">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto overflow-y-hidden">
          <TagChips tags={file.tags} onTagClick={onTagClick} />
        </div>
      </div>
    </div>
  );
});

/** Drag props MediaTableRow applies to its own element (it owns its positioning). */
interface DragWiring {
  ref: (node: HTMLElement | null) => void;
  transform: string | undefined;
  transition: string | undefined;
  isDragging: boolean;
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
}

/**
 * Table rows position themselves with a transform, so instead of nesting them in
 * a sortable wrapper (which would fight over that transform) the drag wiring is
 * handed down and composed inside the row.
 */
function SortableTableRow(
  props: Omit<Parameters<typeof MediaTableRow>[0], "dnd">,
) {
  // Read during render by design (see SortableMedia in MediaReorder.tsx).
  // dnd-kit's attributes default role to "button". Spread over a row that
  // declares role="row" inside a role="table", that orphans its role="cell"
  // children, so the row's own semantics are handed back to it here.
  const sortable = useSortable({
    id: mediaSortId(props.file),
    attributes: { role: "row" },
  });
  const { setNodeRef, transition, isDragging, attributes, listeners } =
    sortable;
  return (
    <MediaTableRow
      {...props}
      dnd={{
        ref: setNodeRef,
        transform: CSS.Transform.toString(sortable.transform) || undefined,
        transition,
        isDragging,
        attributes,
        listeners,
      }}
    />
  );
}
