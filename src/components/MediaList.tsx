// Media listing as a vertical list (alternative to MediaGrid). Each row shows a
// thumbnail, the name with its folder and tags, the resolution/duration/size in
// aligned columns, and the rating / favorite / Watch Later controls.
// thumbVersion forces a reload (cache bust) after a thumbnail-completion event.
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { Link } from "react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Folder } from "lucide-react";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import {
  MediaReorderProvider,
  SortableMedia,
  type MediaReorder,
} from "@/components/MediaReorder";
import { mediaSortId } from "@/lib/mediaSortId";
import { SelectionCheck } from "@/components/SelectionCheck";
import { useSelectableClick } from "@/hooks/useSelectableClick";
import { useFileDrag } from "@/hooks/useFileDrag";
import type { FileRow, FolderEntry } from "@/ipc/types";
import { FolderRow } from "@/components/FolderRow";
import { useFolderEntries } from "@/hooks/useFolderEntries";
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
import { hasTimeline, kindIcon, kindLabel } from "@/lib/mediaKind";
import { formatDuration, formatSize, resolutionBadge } from "@/lib/format";
import { fileHref } from "@/lib/fileHref";
import { useActivateFile } from "@/audio/useActivateFile";
import { dirOf, fileNameOf } from "@/lib/relPath";
import { useI18n } from "@/i18n/I18nProvider";
import {
  usePreferences,
  type ListThumbSize,
} from "@/settings/PreferencesProvider";
import { useGridKeyboardNav, useScrollToRow } from "@/hooks/useGridKeyboardNav";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { usePublishFocusedFile } from "@/hooks/useFocusedFile";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";

const ROW_ESTIMATE = 118; // initial row-height estimate (corrected by measurement)

/** Thumbnail width per list thumbnail-size preference (the height follows at 16:9). */
const THUMB_WIDTH: Record<ListThumbSize, string> = {
  small: "w-32",
  medium: "w-44",
  large: "w-56",
};

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
  /**
   * Shown by folder: child folders drawn as rows ahead of `items`. They
   * belong to the top of the list, so they are shown only while it is loaded
   * from its start (listOffset 0) and count toward the rows above a later
   * window. Same contract as MediaGrid's.
   */
  folders?: FolderEntry[];
  onOpenFolder?: (path: string) => void;
  /** Changing it scrolls back to the top, as a workspace switch does (e.g. the folder shown). */
  resetKey?: string;
  /** The list is a search inside a folder: its empty state says so. */
  inFolder?: boolean;
}

const noop = () => {};

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
  watchLater = false,
  reorder,
  folders,
  onOpenFolder,
  resetKey,
  inFolder = false,
}: Props) {
  const watchLaterMembership = useWatchLater();
  const { listThumbSize } = usePreferences();
  const thumbWidth = THUMB_WIDTH[listThumbSize];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);

  // Rows all share one fixed height (fixed-width thumbnail + fixed-height text
  // block), so instead of measuring every visible row with measureElement (one
  // ResizeObserver + forced reflow per row), measure a single mounted row once
  // per thumbnail size and feed it to estimateSize. The narrow and wide layouts
  // keep the same line count, so a container resize never changes the height.
  const [rowH, setRowH] = useState(0);
  const measuredFor = useRef<ListThumbSize | null>(null);
  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || measuredFor.current === listThumbSize) return;
      const h = node.getBoundingClientRect().height;
      // A row not yet laid out is measured again on the next attach.
      if (!(h > 0)) return;
      measuredFor.current = listThumbSize;
      setRowH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    },
    [listThumbSize],
  );
  const rowEstimate = rowH || ROW_ESTIMATE;

  // Folder rows lead the list (see useFolderEntries).
  const { entries, leadingEntries, onOpen, onInspect } = useFolderEntries({
    items,
    folders,
    listOffset,
    onOpenFolder,
  });

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowEstimate,
    overscan: 8,
    paddingStart: leadingEntries * rowEstimate,
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
  // Enter / Shift+Enter come from useFolderEntries (open or inspect a file,
  // open a folder).
  const { focusedIndex, setFocusedIndex } = useGridKeyboardNav({
    itemCount: entries.length,
    columns: 1,
    active: navActive,
    onOpen,
    onInspect,
    scrollToRow,
  });
  // Points at the focused row's toggle so "W" activates it through the button
  // itself (same mutation, toast, effect and disabled state). Mirrors Discovery.
  const focusedWatchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({ active: navActive, buttonRef: focusedWatchLaterRef });
  // The command menu acts on the focused file.
  usePublishFocusedFile(entries, focusedIndex);

  // Reset the scroll position to the top on workspace switch and on a
  // resetKey change (another folder).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    setFocusedIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, resetKey]);

  // Fetch the next page when a row near the end becomes visible.
  useInfiniteScrollTrigger({
    virtualRows,
    totalRows: entries.length,
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
      <div className="flex flex-col gap-0.5 px-3 py-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2">
            <Skeleton
              className={cn("aspect-video shrink-0 rounded-md", thumbWidth)}
            />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <MediaEmptyState watchLater={watchLater} inFolder={inFolder} />;
  }

  return (
    <MediaReorderProvider items={items} reorder={reorder}>
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
              className="absolute left-0 top-0 w-full px-3 pb-0.5"
              style={{ transform: `translateY(${vr.start}px)` }}
            >
              {(() => {
                const entry = entries[vr.index];
                const focused = vr.index === focusedIndex;
                if (entry.kind === "folder") {
                  return (
                    <FolderRow
                      entry={entry.folder}
                      mediaBase={mediaBase}
                      thumbVersion={thumbVersion}
                      thumbWidth={thumbWidth}
                      focused={focused}
                      onOpen={onOpenFolder ?? noop}
                    />
                  );
                }
                const file = entry.file;
                const row = (
                  <MediaRow
                    file={file}
                    index={entry.fileIndex}
                    version={thumbVersion[mediaSortId(file)] ?? 0}
                    mediaBase={mediaBase}
                    thumbWidth={thumbWidth}
                    onTagClick={onTagClick}
                    focused={focused}
                    watchLater={watchLaterMembership}
                    watchLaterRef={focused ? focusedWatchLaterRef : undefined}
                    fileDraggable={!reorder}
                  />
                );
                return reorder ? (
                  <SortableMedia id={mediaSortId(file)}>{row}</SortableMedia>
                ) : (
                  row
                );
              })()}
            </div>
          ))}
        </div>
      </ScrollArea>
    </MediaReorderProvider>
  );
});

// Memoize so only rows whose version changed re-render (onTagClick is stabilized in the parent).
const MediaRow = memo(function MediaRow({
  file,
  index,
  version,
  mediaBase,
  thumbWidth,
  onTagClick,
  focused,
  watchLater,
  watchLaterRef,
  fileDraggable,
}: {
  file: FileRow;
  /** Position in the loaded list — what a Shift-click ranges from. */
  index: number;
  version: number;
  mediaBase: string;
  /** Tailwind width class for the thumbnail (from the list thumbnail-size preference). */
  thumbWidth: string;
  onTagClick?: (name: string) => void;
  focused?: boolean;
  watchLater: WatchLaterMembership;
  /** Set only on the focused row, so the "W" shortcut can drive this toggle. */
  watchLaterRef?: Ref<HTMLButtonElement>;
  /** Can be dragged onto a collection in the rail (off while reordering). */
  fileDraggable: boolean;
}) {
  // The row has two click regions so the click target controls whether the
  // detail view auto-plays. Thumbnail click → auto-play (default); anywhere
  // else on the row → opens detail paused (`?autoplay=0`). For audio the
  // thumbnail plays the track in the bottom bar instead of navigating, and the
  // rest of the row opens the detail view without starting playback.
  //
  // No control is nested inside a link: the name link stretches over the row
  // with a pseudo-element, and the thumbnail, tags and toggles sit above it
  // (`relative z-10`) as its siblings.
  const { t } = useI18n();
  const { onThumbnailClick } = useActivateFile();
  const { selected, onSelectableClick } = useSelectableClick(file, index);
  const dragProps = useFileDrag(file, selected, fileDraggable);
  const dir = dirOf(file.relPath);
  const dims =
    file.width && file.height ? `${file.width}×${file.height}` : null;
  const duration = hasTimeline(file.kind) ? formatDuration(file.duration) : "";
  const badge = resolutionBadge(file.kind, file.width, file.height);
  const KindIcon = kindIcon(file.kind);
  // Values that are set stay on screen; unset toggles only show up on the row
  // under the pointer or keyboard focus. Their space stays reserved either way
  // so the columns do not shift from row to row.
  const reveal = (isSet: boolean) =>
    isSet || focused
      ? undefined
      : "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div
      {...dragProps}
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group @container relative flex items-center gap-4 rounded-lg p-2 pr-4 transition-colors hover:bg-overlay/50",
        selected && "bg-primary/10 ring-1 ring-inset ring-primary/50",
        focused && "bg-primary/15 ring-2 ring-inset ring-primary",
      )}
    >
      <div
        className={cn(
          "relative z-10 aspect-video shrink-0 overflow-hidden rounded-md bg-overlay text-muted",
          thumbWidth,
        )}
      >
        <Link
          to={fileHref(file.id, file.workspaceId)}
          onClick={(e) => {
            if (onSelectableClick(e)) return;
            onThumbnailClick(file)(e);
          }}
          className="group/thumb absolute inset-0 block"
        >
          <MediaThumbnail file={file} mediaBase={mediaBase} version={version} />
          {duration && (
            <span className="absolute bottom-1 right-1 rounded bg-bg/80 px-1 text-[11px] leading-4 tabular-nums text-bright-fg">
              {duration}
            </span>
          )}
        </Link>
        <SelectionCheck
          file={file}
          index={index}
          className="absolute left-1.5 top-1.5 z-10"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link
          to={fileHref(file.id, file.workspaceId, { autoplay: false })}
          onClick={onSelectableClick}
          title={file.relPath}
          className="h-6 truncate text-[15px] font-medium leading-6 text-bright-fg outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
        >
          {fileNameOf(file.relPath)}
        </Link>
        {/* Wide rows give the metadata its own columns and show the folder
            here; narrow ones (a docked side peek) fold the metadata into this
            line instead, which keeps the row height the same. */}
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted">
          <Folder className="hidden size-3 shrink-0 @3xl:block" />
          <span className="hidden truncate @3xl:inline">{dir || "/"}</span>
          <span className="truncate @3xl:hidden">
            {[dims, duration, formatSize(file.size)]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
        </div>
        <div className="no-scrollbar relative z-10 flex h-5 w-fit max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden">
          <TagChips tags={file.tags} onTagClick={onTagClick} />
        </div>
      </div>

      <div className="hidden shrink-0 grid-cols-[9.5rem_4rem_4.75rem] items-center gap-x-4 text-[13px] tabular-nums text-fg @3xl:grid">
        <div className="flex min-w-0 items-center justify-end gap-2">
          {file.kind !== "video" && (
            <KindIcon
              className="size-3.5 shrink-0 text-muted"
              aria-label={kindLabel(t, file.kind)}
            />
          )}
          {badge && (
            <span className="shrink-0 rounded border border-border-strong px-1 text-[10px] font-semibold leading-4 text-muted">
              {badge}
            </span>
          )}
          <span className={cn("truncate", !dims && "text-muted")}>
            {dims ?? "—"}
          </span>
        </div>
        <div className={cn("text-right", !duration && "text-muted")}>
          {duration || "—"}
        </div>
        <div className={cn("text-right", !file.size && "text-muted")}>
          {formatSize(file.size, "—")}
        </div>
      </div>

      {/* The wrapper lets clicks in the gaps fall through to the row link;
          only the toggles themselves take the pointer. Narrow rows drop the
          rating, which the side peek beside them shows anyway. */}
      <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-3 [&>*]:pointer-events-auto">
        <div className={cn("hidden @lg:block", reveal(file.rating > 0))}>
          <RatingButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            rating={file.rating}
            size={13}
          />
        </div>
        <div className={reveal(!!file.favorite)}>
          <FavoriteButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            favorite={file.favorite}
            size={16}
          />
        </div>
        <div className={reveal(watchLater.has(file.workspaceId, file.id))}>
          <WatchLaterButton
            ref={watchLaterRef}
            fileId={file.id}
            workspaceId={file.workspaceId}
            watchLater={watchLater}
            size={16}
          />
        </div>
      </div>
    </div>
  );
});
