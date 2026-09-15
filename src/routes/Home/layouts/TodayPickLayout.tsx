// Home layout "Today's pick": one of today's picks leads as a full-bleed
// stage, the rest sit beside it in a grid sized to the stage's height (the
// bar between them sets the balance), and the newest files fill a grid
// below. Keyboard order: the stage, the picks beside it, then the rows.
//
// Everything below the stage is the `rows` list: keyboard order, sizes and
// markup derive from it, so another row ("Continue watching", #122) is one
// entry there plus its data in useHomeShelves.
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ChevronRight,
  EllipsisVertical,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { FileRow } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useActivateFile } from "@/audio/useActivateFile";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useShelfKeyboardNav, type ShelfFocus } from "../useShelfKeyboardNav";
import {
  HOME_SPLIT_MAX,
  HOME_SPLIT_MIN,
  splitColumns,
  splitPercent,
  useHomeSplit,
} from "../useHomeSplit";
import { useSideFit } from "../useSideFit";
import {
  HeroCard,
  PicksSkeleton,
  RowAction,
  RowHeader,
  ShelfRow,
  SIDE_GRID_CLASS,
  WRAP_GRID_CLASS,
  type Row,
} from "../shelfParts";
import type { HomeLayoutProps } from "./types";

export const TodayPickLayout = memo(function TodayPickLayout({
  recent,
  picks,
  mediaBase,
  thumbVersion,
  onSeeAllRecent,
  onOpenDiscover,
  onReshufflePicks,
  onTagClick,
  navActive,
}: HomeLayoutProps) {
  const { t } = useI18n();
  const { activate } = useActivateFile();
  const watchLater = useWatchLater();

  // The first pick leads; the rest sit beside it. A failed refresh keeps the
  // last rows (react-query holds them), so they stay usable. The hero's
  // height decides how many sit beside it: whole rows, as many as fit.
  const hero = picks.files[0];
  const { fit: sideFit, attachHero, attachGrid } = useSideFit();
  const morePicks = useMemo(() => {
    const rest = picks.files.slice(1);
    return sideFit === 0 ? rest : rest.slice(0, sideFit);
  }, [picks.files, sideFit]);

  // Retry / redraw the picks. It sits beside "Open in Discovery" on the row
  // of picks; with no such row (a single pick, or none) it stays reachable
  // next to the stage's title or the empty / error line.
  const reshuffle = useMemo(
    () => (
      <Button
        size="icon"
        variant="outline"
        className="size-6 [&_svg]:size-3.5"
        title={t("home.shelfReshuffle")}
        aria-label={t("home.shelfReshuffle")}
        onClick={onReshufflePicks}
        disabled={picks.fetching}
      >
        <RefreshCw className={cn(picks.fetching && "animate-spin")} />
      </Button>
    ),
    [t, onReshufflePicks, picks.fetching],
  );

  const rows = useMemo<Row[]>(
    () => [
      {
        id: "more-picks",
        title: t("home.shelfMorePicks"),
        action: (
          <div className="flex items-center gap-2">
            <RowAction onClick={onOpenDiscover}>
              {t("home.shelfOpenDiscover")}
              <Sparkles className="size-3.5" />
            </RowAction>
            {reshuffle}
          </div>
        ),
        data: picks,
        files: morePicks,
        gridClass: SIDE_GRID_CLASS,
        attachGrid,
      },
      {
        id: "recent",
        title: t("home.shelfRecent"),
        action: (
          <RowAction onClick={onSeeAllRecent}>
            {t("home.shelfSeeAll")}
            <ChevronRight className="size-3.5" />
          </RowAction>
        ),
        data: recent,
        files: recent.files,
        gridClass: WRAP_GRID_CLASS,
      },
    ],
    [
      t,
      picks,
      morePicks,
      recent,
      onOpenDiscover,
      onSeeAllRecent,
      attachGrid,
      reshuffle,
    ],
  );
  // Keyboard order: the hero, then each row — exactly what is on screen.
  const shelves = useMemo<FileRow[][]>(
    () => [hero ? [hero] : [], ...rows.map((r) => r.files)],
    [hero, rows],
  );
  const shelfSizes = useMemo(() => shelves.map((s) => s.length), [shelves]);
  const HERO_ROW = 0;
  const rowIndex = (i: number) => i + 1;

  const onOpen = useCallback(
    (f: ShelfFocus) => {
      const file = shelves[f.shelf]?.[f.index];
      if (file) activate(file);
    },
    [shelves, activate],
  );
  const onInspect = useCallback(
    (f: ShelfFocus) => {
      const file = shelves[f.shelf]?.[f.index];
      if (file) activate(file, { autoplay: false });
    },
    [shelves, activate],
  );
  const { focus } = useShelfKeyboardNav({
    shelfSizes,
    active: navActive,
    onOpen,
    onInspect,
  });
  const isFocused = (shelf: number, index: number) =>
    focus?.shelf === shelf && focus.index === index;
  // "W" drives the focused card's Watch Later toggle, as in the list views.
  const focusedWatchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({ active: navActive, buttonRef: focusedWatchLaterRef });

  // The balance between the hero and the picks beside it, dragged on the bar
  // between them.
  const splitRowRef = useRef<HTMLDivElement>(null);
  const split = useHomeSplit(splitRowRef);

  // Keep the focused card in view.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    rootRef.current
      ?.querySelector('[data-shelf-focused="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);

  // Nothing at all only once every query has answered without rows or error.
  const empty =
    picks.loaded &&
    recent.loaded &&
    !picks.error &&
    !recent.error &&
    picks.files.length === 0 &&
    recent.files.length === 0;

  const sideRow = rows[0];
  const fullRows = rows.slice(1);
  // The focused card within a keyboard row (null: the focus is elsewhere).
  const focusedIn = (shelf: number) =>
    focus?.shelf === shelf ? focus.index : null;
  const rowProps = {
    mediaBase,
    thumbVersion,
    watchLater,
    focusedWatchLaterRef,
    onTagClick,
    t,
  };

  return (
    <ScrollArea className="page-scroll h-full">
      <section
        ref={rootRef}
        data-testid="home-shelves"
        aria-label={t("home.shelfTitle")}
        className="flex flex-col gap-6 p-4"
      >
        {empty && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted">{t("home.shelfEmpty")}</p>
            {reshuffle}
          </div>
        )}

        {/* Today's pick, with the other picks beside it. */}
        {!picks.loaded ? (
          <PicksSkeleton />
        ) : hero ? (
          <div
            ref={splitRowRef}
            className="grid items-start gap-x-2 gap-y-4"
            style={{ gridTemplateColumns: splitColumns(split.ratio) }}
          >
            <div className="flex min-w-0 flex-col gap-2">
              <RowHeader
                title={t("home.shelfTodayPick")}
                action={morePicks.length > 0 ? null : reshuffle}
              />
              <HeroCard
                ref={attachHero}
                file={hero}
                mediaBase={mediaBase}
                version={thumbVersion[`${hero.workspaceId}:${hero.id}`] ?? 0}
                watchLater={watchLater}
                focused={isFocused(HERO_ROW, 0)}
                watchLaterRef={
                  isFocused(HERO_ROW, 0) ? focusedWatchLaterRef : undefined
                }
                refreshFailed={picks.error}
                onTagClick={onTagClick}
                t={t}
              />
            </div>
            {/* The bar between the two: drag, or arrow keys once focused;
                double-click restores the even split. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("home.shelfSplit")}
              aria-valuenow={splitPercent(split.ratio)}
              aria-valuemin={splitPercent(HOME_SPLIT_MIN)}
              aria-valuemax={splitPercent(HOME_SPLIT_MAX)}
              tabIndex={0}
              title={t("home.shelfSplit")}
              onPointerDown={split.onPointerDown}
              onKeyDown={split.onKeyDown}
              onDoubleClick={split.reset}
              className="group/handle relative flex w-3 cursor-col-resize touch-none items-center justify-center self-stretch rounded hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
            >
              {/* The line the bar draws down the gap; the grip sits on it. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover/handle:bg-primary group-focus-visible/handle:bg-primary"
              />
              <span
                aria-hidden
                className="flex h-6 w-4 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-muted group-hover/handle:border-primary group-hover/handle:text-fg group-focus-visible/handle:border-primary group-focus-visible/handle:text-fg"
              >
                <EllipsisVertical className="size-3.5" />
              </span>
            </div>
            <ShelfRow
              row={sideRow}
              focusedIndex={focusedIn(rowIndex(0))}
              {...rowProps}
            />
          </div>
        ) : picks.error ? (
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted">{t("home.shelfError")}</p>
            {reshuffle}
          </div>
        ) : null}

        {/* Full-width rows below the hero open with a rule across the page,
            so each reads as its own section. */}
        {fullRows.map((row, i) => (
          <ShelfRow
            key={row.id}
            row={row}
            focusedIndex={focusedIn(rowIndex(i + 1))}
            divided
            {...rowProps}
          />
        ))}
      </section>
    </ScrollArea>
  );
});
