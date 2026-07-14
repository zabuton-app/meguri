import { useState } from "react";
import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { SceneBookmark } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { MainThumbStar } from "./MainThumbStar";
import { fmtTime, isSameThumbSource, isThumbPendingFor } from "./utils";

// User-curated scene bookmarks. Same horizontal-scroll layout as `Scenes` so the two
// sections feel like siblings. Each thumb seeks on click and exposes a hover-only delete
// button. The "add" entry point lives in the player's control bar (not here).
export function SceneBookmarks({
  id,
  bookmarks,
  mediaBase,
  wsId,
  thumbOffsetSec,
  pendingThumbSec,
  onSeek,
  onRemove,
  onSetMainThumb,
  t,
}: {
  id: number;
  bookmarks: SceneBookmark[];
  mediaBase: string;
  wsId: string;
  thumbOffsetSec: number | null;
  /** sec being applied (or null if a revert-to-auto is in flight); undefined when idle. */
  pendingThumbSec: number | null | undefined;
  onSeek: (t: number) => void;
  onRemove: (bookmarkId: number) => void;
  onSetMainThumb: (sec: number | null) => void;
  t: TFunc;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase text-muted">
        {t("media.bookmarks")}
      </h3>
      <ScrollArea className="w-full" viewportClassName="pb-3">
        <div className="flex gap-2">
          {bookmarks.map((b) => {
            const isMain = isSameThumbSource(thumbOffsetSec, b.sec);
            const pending = isThumbPendingFor(pendingThumbSec, b.sec, isMain);
            return (
              <BookmarkThumb
                key={b.id}
                id={id}
                bookmark={b}
                mediaBase={mediaBase}
                wsId={wsId}
                isMainThumb={isMain}
                thumbPending={pending}
                onSeek={onSeek}
                onRemove={onRemove}
                onSetMainThumb={onSetMainThumb}
                t={t}
              />
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

function BookmarkThumb({
  id,
  bookmark,
  mediaBase,
  wsId,
  isMainThumb,
  thumbPending,
  onSeek,
  onRemove,
  onSetMainThumb,
  t,
}: {
  id: number;
  bookmark: SceneBookmark;
  mediaBase: string;
  wsId: string;
  isMainThumb: boolean;
  thumbPending: boolean;
  onSeek: (t: number) => void;
  onRemove: (bookmarkId: number) => void;
  onSetMainThumb: (sec: number | null) => void;
  t: TFunc;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="group/bm relative shrink-0">
      <button
        type="button"
        onClick={() => onSeek(bookmark.sec)}
        className={`relative block overflow-hidden rounded-lg border transition hover:border-[var(--c-primary)] ${
          isMainThumb ? "border-[var(--c-primary)]" : "border-border"
        }`}
        title={t("scene.seekTo", { time: fmtTime(bookmark.sec) })}
      >
        {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={`${mediaBase}/ws/${wsId}/frame/${id}?t=${bookmark.sec}`}
          alt={t("scene.alt", { time: fmtTime(bookmark.sec) })}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-24 bg-black transition group-hover/bm:opacity-85 ${
            loaded ? "w-auto opacity-100" : "w-40 opacity-0"
          }`}
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] tabular-nums text-white">
          {fmtTime(bookmark.sec)}
        </span>
      </button>
      <MainThumbStar
        isMainThumb={isMainThumb}
        pending={thumbPending}
        onClick={() => onSetMainThumb(isMainThumb ? null : bookmark.sec)}
        t={t}
        alwaysVisible={isMainThumb}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(bookmark.id);
        }}
        title={t("media.bookmarkRemove")}
        aria-label={t("media.bookmarkRemove")}
        // Hidden by default; revealed on parent hover OR when the button itself is focused
        // (keyboard users need to reach it without a pointer).
        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/85 focus-visible:flex group-hover/bm:flex"
      >
        <X size={14} />
      </button>
    </div>
  );
}
