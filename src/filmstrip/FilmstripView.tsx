// The filmstrip view: one row per file, laid out along its length — a video's
// frames at even intervals, an audio file's waveform, an image's thumbnail —
// so what a clip holds, and where, shows without opening it. Built like the
// list (MediaList): the same keyboard, selection, peek and paging, no folders
// and no drag-to-reorder.
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import { FileContextMenu } from "@/components/FileContextMenu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useFolderEntries } from "@/hooks/useFolderEntries";
import { useScrollToPeek } from "@/hooks/useScrollToPeek";
import { useGridKeyboardNav, useScrollToRow } from "@/hooks/useGridKeyboardNav";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { usePublishFocusedFile } from "@/hooks/useFocusedFile";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";
import { mediaSortId } from "@/lib/mediaSortId";
import type { FileRow } from "@/ipc/types";
import {
  createImageLimiter,
  FILMSTRIP_MAX_IN_FLIGHT,
} from "@/filmstrip/imageLimiter";
import { FilmstripRow } from "@/filmstrip/FilmstripRow";

/** Every row has this height: frames, timecodes and the bookmark bar, padded. */
const FILMSTRIP_ROW_H = 120;

interface Props {
  items: FileRow[];
  mediaBase: string;
  workspaceId: string;
  /** Global index offset of items[0] within the full filtered result set. */
  listOffset?: number;
  loading: boolean;
  onTagClick?: (name: string) => void;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  hasPreviousPage?: boolean;
  fetchPreviousPage?: () => void;
  isFetchingPreviousPage?: boolean;
  /** Whether keyboard focus navigation is active (the view is foreground). */
  navActive?: boolean;
  /** Whether the built-in Watch Later collection is shown (empty-state copy). */
  watchLater?: boolean;
  /** mediaSortId of the file a docked side peek shows. */
  peekFileKey?: string;
  /** Changing it scrolls back to the top, as a workspace switch does (a new search). */
  resetKey?: string;
}

export const FilmstripView = memo(function FilmstripView({
  items,
  mediaBase,
  workspaceId: wsId,
  listOffset = 0,
  loading,
  onTagClick,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  hasPreviousPage,
  fetchPreviousPage,
  isFetchingPreviousPage,
  navActive = false,
  watchLater = false,
  peekFileKey,
  resetKey,
}: Props) {
  const watchLaterMembership = useWatchLater();
  // One queue for the whole view, so a screenful of rows shares the cap.
  const limiter = useMemo(
    () => createImageLimiter(FILMSTRIP_MAX_IN_FLIGHT),
    [],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);

  const { entries, onOpen, onInspect } = useFolderEntries({
    items,
    folders: undefined,
    listOffset,
    onOpenFolder: undefined,
  });

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILMSTRIP_ROW_H,
    overscan: 4,
  });
  const virtualRows = virtualizer.getVirtualItems();
  // Rows in the viewport, without the overscan: only these load frames.
  const range = virtualizer.range;

  const scrollToRow = useScrollToRow(virtualizer);
  const { focusedIndex, setFocusedIndex } = useGridKeyboardNav({
    itemCount: entries.length,
    columns: 1,
    active: navActive,
    onOpen,
    onInspect,
    scrollToRow,
  });
  const focusedWatchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({ active: navActive, buttonRef: focusedWatchLaterRef });
  usePublishFocusedFile(entries, focusedIndex);

  // Back to the top on a workspace switch and on a resetKey change, as the
  // list does: Home keeps the previous results on screen while a new search
  // loads, so the view would otherwise land mid-way into the new one.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    setFocusedIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, resetKey]);

  const peekIndex = peekFileKey
    ? entries.findIndex(
        (e) => e.kind === "file" && mediaSortId(e.file) === peekFileKey,
      )
    : -1;
  const peekReady = useCallback(() => !loading, [loading]);
  useScrollToPeek({
    peekFileKey,
    row: peekIndex,
    ready: peekReady,
    scrollToRow,
  });

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
      <div className="flex flex-col gap-2 px-3 py-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <MediaEmptyState watchLater={watchLater} />;
  }

  return (
    <FileContextMenu
      items={items}
      mediaBase={mediaBase}
      workspaceId={wsId}
      active={navActive}
    >
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
          {virtualRows.map((vr) => {
            const entry = entries[vr.index];
            if (entry.kind !== "file") return null;
            const focused = vr.index === focusedIndex;
            const onScreen =
              range != null &&
              vr.index >= range.startIndex &&
              vr.index <= range.endIndex;
            return (
              <div
                key={vr.key}
                className="absolute left-0 top-0 w-full px-3 pb-0.5"
                style={{
                  transform: `translateY(${vr.start}px)`,
                  height: FILMSTRIP_ROW_H,
                }}
              >
                <FilmstripRow
                  file={entry.file}
                  index={entry.fileIndex}
                  mediaBase={mediaBase}
                  limiter={limiter}
                  onScreen={onScreen}
                  onTagClick={onTagClick}
                  focused={focused}
                  peeked={vr.index === peekIndex}
                  watchLater={watchLaterMembership}
                  watchLaterRef={focused ? focusedWatchLaterRef : undefined}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </FileContextMenu>
  );
});
