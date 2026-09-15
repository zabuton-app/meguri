// The pieces every Home layout builds from: the row model and its renderer,
// the hero stage, the compact card, headers, actions and skeletons. A layout
// (src/routes/Home/layouts/) arranges these; it does not restyle them, so the
// layouts stay interchangeable from Settings.
import {
  forwardRef,
  memo,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Link } from "react-router";
import { Play } from "lucide-react";
import type { FileRow } from "@/ipc/types";
import type { ShelfData } from "./useHomeShelves";
import type { TFunc } from "@/i18n/I18nProvider";
import { useActivateFile } from "@/audio/useActivateFile";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { TagChips } from "@/components/TagChips";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fileHref } from "@/lib/fileHref";
import { fileNameOf, folderOf } from "@/lib/relPath";
import { hasTimeline } from "@/lib/mediaKind";
import { formatDuration } from "@/lib/format";
import { metaLine } from "@/lib/mediaMeta";
import { cn } from "@/lib/utils";
import { HOME_SPLIT_DEFAULT, splitColumns } from "./useHomeSplit";

/** A row of cards: what it shows and where its data stands. */
export interface Row {
  id: string;
  title: string;
  action: ReactNode;
  data: ShelfData;
  /** The rows to show: `data.files`, or fewer (a row may skip the hero). */
  files: FileRow[];
  /** Tailwind grid for the cards. */
  gridClass: string;
  /** Receives the grid element, for a row that sizes itself to a stage. */
  attachGrid?: (el: HTMLDivElement | null) => void;
}

/** The grid a full-width row of cards uses: as many 160px+ columns as fit
 *  (the same card size as the picks beside the stage). */
export const WRAP_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3";
/** The picks beside the hero: as many 160px+ columns as fit, like the list
 *  grid (its cards are a little smaller than the list's 180px). */
export const SIDE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3";

/**
 * One row: header, then its cards (or its error / skeleton). `focusedIndex`
 * is the keyboard-focused card in this row (null: none), which gets the ring
 * and the Watch Later ref. `divided` opens the row with a rule across the
 * page.
 */
export function ShelfRow({
  row,
  focusedIndex,
  divided = false,
  mediaBase,
  thumbVersion,
  watchLater,
  focusedWatchLaterRef,
  t,
}: {
  row: Row;
  focusedIndex: number | null;
  divided?: boolean;
  mediaBase: string;
  thumbVersion: Record<string, number>;
  watchLater: WatchLaterMembership;
  focusedWatchLaterRef: RefObject<HTMLButtonElement | null>;
  t: TFunc;
}) {
  const { loaded, error } = row.data;
  const { attachGrid, gridClass, files } = row;
  const sectionClass = cn(
    "flex min-w-0 flex-col gap-2",
    divided && "border-t border-border pt-5",
  );
  if (!loaded)
    return (
      <div className={sectionClass}>
        <RowSkeleton gridClass={gridClass} />
      </div>
    );
  if (files.length === 0 && !error) return null;
  return (
    <div className={sectionClass}>
      <RowHeader title={row.title} action={row.action} />
      {error && files.length === 0 ? (
        <p className="text-xs text-muted">{t("home.shelfError")}</p>
      ) : (
        <div ref={attachGrid} className={gridClass}>
          {files.map((file, index) => {
            const focused = index === focusedIndex;
            return (
              <ShelfCard
                key={`${file.workspaceId}:${file.id}`}
                file={file}
                mediaBase={mediaBase}
                version={thumbVersion[`${file.workspaceId}:${file.id}`] ?? 0}
                watchLater={watchLater}
                focused={focused}
                watchLaterRef={focused ? focusedWatchLaterRef : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RowHeader({
  title,
  action,
}: {
  title: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[13px] font-semibold text-bright-fg">{title}</h2>
      <span className="flex-1" />
      {action}
    </div>
  );
}

export function RowAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 items-center gap-1 rounded px-1 text-xs text-muted transition hover:bg-fg/10 hover:text-fg"
    >
      {children}
    </button>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">
      <Skeleton className="aspect-video rounded-none" />
      <div className="flex flex-col gap-1.5 px-2 py-1.5">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export function PicksSkeleton() {
  return (
    <div
      className="grid items-start gap-x-2 gap-y-4"
      style={{ gridTemplateColumns: splitColumns(HOME_SPLIT_DEFAULT) }}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="aspect-video rounded-lg" />
      </div>
      <div className="w-3" />
      <RowSkeleton gridClass={SIDE_GRID_CLASS} count={4} />
    </div>
  );
}

export function RowSkeleton({
  gridClass,
  count = 6,
}: {
  gridClass: string;
  count?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-32" />
      <div className={gridClass}>
        {Array.from({ length: count }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// Today's pick, large. The thumbnail is the play gesture (as on every card);
// the panel below repeats it as buttons so the intent reads. Memoized: Home
// re-renders on every thumbnail flush and every prop here is stable.
export const HeroCard = memo(
  forwardRef<
    HTMLDivElement,
    {
      file: FileRow;
      mediaBase: string;
      version: number;
      watchLater: WatchLaterMembership;
      focused: boolean;
      watchLaterRef?: Ref<HTMLButtonElement>;
      /** The last redraw failed; this pick is the one from before. */
      refreshFailed: boolean;
      onTagClick?: (token: string) => void;
      t: TFunc;
    }
  >(function HeroCard(
    {
      file,
      mediaBase,
      version,
      watchLater,
      focused,
      watchLaterRef,
      refreshFailed,
      onTagClick,
      t,
    },
    ref,
  ) {
    const { activate, onThumbnailClick } = useActivateFile();
    const folder = folderOf(file.relPath);
    return (
      <div
        ref={ref}
        data-testid="shelf-hero"
        data-shelf-focused={focused ? "true" : undefined}
        aria-current={focused ? "true" : undefined}
        className="group flex min-w-0 flex-col gap-3"
      >
        {/* The picture, as on every card: the shared thumbnail region, so the
            hover scrub (and its seek line along the bottom edge) works here
            exactly as in the grid. Nothing is laid over it. */}
        <Link
          to={fileHref(file.id, file.workspaceId)}
          onClick={onThumbnailClick(file)}
          className={cn(
            "group/thumb relative block aspect-video overflow-hidden rounded-lg bg-overlay text-muted",
            focused && "ring-2 ring-primary",
          )}
        >
          <MediaThumbnail
            file={file}
            mediaBase={mediaBase}
            version={version}
            fallbackIconSize="size-16"
            playOverlaySize="size-16"
            playIconSize="size-8"
          />
          {hasTimeline(file.kind) && file.duration && (
            <span className="absolute bottom-2 right-2 rounded bg-bg/70 px-1.5 text-xs text-fg">
              {formatDuration(file.duration)}
            </span>
          )}
          <FavoriteButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            favorite={file.favorite}
            size={18}
            className={cn(
              "absolute right-2 top-2 rounded bg-bg/70 p-1.5 backdrop-blur-[1px] transition-opacity",
              file.favorite
                ? "opacity-100"
                : "opacity-0 focus:opacity-100 group-hover:opacity-100",
            )}
          />
          <WatchLaterButton
            ref={watchLaterRef}
            fileId={file.id}
            workspaceId={file.workspaceId}
            watchLater={watchLater}
            size={18}
            className="absolute right-2 top-11 rounded bg-bg/70 p-1.5 opacity-0 backdrop-blur-[1px] transition-opacity focus:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100"
          />
        </Link>
        {/* Caption and controls below the picture. */}
        <div className="flex min-w-0 flex-col gap-1.5">
          {(folder || refreshFailed) && (
            <div className="flex items-center gap-2 text-[11px] text-muted">
              {folder && <span className="truncate">{folder}</span>}
              {refreshFailed && (
                <span className="truncate">{t("home.shelfError")}</span>
              )}
            </div>
          )}
          <Link
            to={fileHref(file.id, file.workspaceId, { autoplay: false })}
            className="truncate text-lg font-bold text-bright-fg"
            title={file.relPath}
          >
            {fileNameOf(file.relPath)}
          </Link>
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted">
            <span className="shrink-0">{metaLine(file)}</span>
            <div className="no-scrollbar flex h-6 min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden">
              <TagChips tags={file.tags} onTagClick={onTagClick} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={() => activate(file)}>
              <Play className="fill-current" />
              {t("discover.play")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => activate(file, { autoplay: false })}
            >
              {t("home.shelfOpenDetail")}
            </Button>
          </div>
        </div>
      </div>
    );
  }),
);

// Same two click regions as the grid card (thumbnail → open with autoplay,
// name → inspect), minus rating and tags: the shelf is an entry point, the
// list views are where editing happens. Kept in step with MediaGrid's
// MediaCard by hand (see the note there).
export const ShelfCard = memo(function ShelfCard({
  file,
  mediaBase,
  version,
  watchLater,
  focused,
  watchLaterRef,
}: {
  file: FileRow;
  mediaBase: string;
  version: number;
  watchLater: WatchLaterMembership;
  focused: boolean;
  watchLaterRef?: Ref<HTMLButtonElement>;
}) {
  const { onThumbnailClick } = useActivateFile();
  return (
    <div
      data-testid="shelf-card"
      data-shelf-focused={focused ? "true" : undefined}
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-primary",
        focused && "border-primary ring-2 ring-primary",
      )}
    >
      <Link
        to={fileHref(file.id, file.workspaceId)}
        onClick={onThumbnailClick(file)}
        className="group/thumb relative block aspect-video overflow-hidden bg-overlay text-muted"
      >
        <MediaThumbnail file={file} mediaBase={mediaBase} version={version} />
        {hasTimeline(file.kind) && file.duration && (
          <span className="absolute bottom-1 right-1 rounded bg-bg/70 px-1 text-[10px] text-fg">
            {formatDuration(file.duration)}
          </span>
        )}
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
        <WatchLaterButton
          ref={watchLaterRef}
          fileId={file.id}
          workspaceId={file.workspaceId}
          watchLater={watchLater}
          size={16}
          className="absolute right-1 top-9 rounded bg-bg/70 p-1 opacity-0 backdrop-blur-[1px] transition-opacity focus:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100"
        />
      </Link>
      <Link
        to={fileHref(file.id, file.workspaceId, { autoplay: false })}
        className="flex flex-col gap-0.5 border-t border-border px-2 py-1.5"
      >
        <div className="truncate text-xs text-fg" title={file.relPath}>
          {fileNameOf(file.relPath)}
        </div>
        <div className="truncate text-[10px] text-muted">{metaLine(file)}</div>
      </Link>
    </div>
  );
});
