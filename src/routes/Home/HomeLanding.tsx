// Home landing: short shelves above the library list (issue #123). Each shelf
// is a horizontal strip of compact cards with the grid's click / keyboard
// behaviour (open, inspect, favorite, Watch Later). Rendered by the list views
// as their leading block, so it scrolls away with the list rather than
// pinning the first rows below the fold.
//
// Shelves are one ordered list (`shelves` below): the keyboard focus, the
// sizes and the markup all derive from it, so a new shelf is one entry.
// "Continue watching" (files with a resume point) waits on the resume-point
// feature (#122); until then the list holds Recently added and Picks for today.
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import type { FileRow } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useActivateFile } from "@/audio/useActivateFile";
import {
  useWatchLater,
  type WatchLaterMembership,
} from "@/hooks/useWatchLater";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileHref } from "@/lib/fileHref";
import { fileNameOf } from "@/lib/relPath";
import { hasTimeline } from "@/lib/mediaKind";
import { formatDuration } from "@/lib/format";
import { metaLine } from "@/lib/mediaMeta";
import { cn } from "@/lib/utils";
import {
  useLandingKeyboardNav,
  type LandingFocus,
} from "./useLandingKeyboardNav";

export interface HomeLandingProps {
  recent: FileRow[];
  picks: FileRow[];
  mediaBase: string;
  /** workspaceId:id → update counter (thumb:done cache buster), as in the grid. */
  thumbVersion: Record<string, number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** "See all" on Recently added: sort the list the same way. */
  onSeeAllRecent: () => void;
  onOpenDiscover: () => void;
  onReshufflePicks: () => void;
  picksFetching: boolean;
  /** Whether the shelves own keyboard focus (list foreground and focus region = landing). */
  navActive: boolean;
  /** Bumped when keyboard focus enters from the list below. */
  enterToken: number;
  /** Down past the last shelf: the list takes keyboard focus. */
  onExitBottom: () => void;
}

interface ShelfSpec {
  id: string;
  title: string;
  hint?: string;
  files: FileRow[];
  action: React.ReactNode;
}

export const HomeLanding = memo(function HomeLanding({
  recent,
  picks,
  mediaBase,
  thumbVersion,
  collapsed,
  onToggleCollapsed,
  onSeeAllRecent,
  onOpenDiscover,
  onReshufflePicks,
  picksFetching,
  navActive,
  enterToken,
  onExitBottom,
}: HomeLandingProps) {
  const { t } = useI18n();
  const { activate } = useActivateFile();
  const watchLater = useWatchLater();

  // Display order. Empty shelves are left out of the markup and skipped by
  // the keyboard navigation, so positions stay meaningful either way.
  const shelves = useMemo<ShelfSpec[]>(
    () => [
      {
        id: "recent",
        title: t("home.landingRecent"),
        files: recent,
        action: (
          <ShelfAction onClick={onSeeAllRecent}>
            {t("home.landingSeeAll")}
            <ChevronRight className="size-3.5" />
          </ShelfAction>
        ),
      },
      {
        id: "picks",
        title: t("home.landingPicks"),
        hint: t("home.landingPicksHint"),
        files: picks,
        action: (
          <div className="flex items-center gap-2">
            <ShelfAction onClick={onOpenDiscover}>
              {t("home.landingOpenDiscover")}
              <Sparkles className="size-3.5" />
            </ShelfAction>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-6"
              title={t("home.landingReshuffle")}
              aria-label={t("home.landingReshuffle")}
              onClick={onReshufflePicks}
              disabled={picksFetching}
            >
              <RefreshCw
                className={cn("size-3.5", picksFetching && "animate-spin")}
              />
            </Button>
          </div>
        ),
      },
    ],
    [
      t,
      recent,
      picks,
      onSeeAllRecent,
      onOpenDiscover,
      onReshufflePicks,
      picksFetching,
    ],
  );
  const shelfSizes = useMemo(
    () => shelves.map((s) => s.files.length),
    [shelves],
  );

  const onOpen = useCallback(
    (f: LandingFocus) => {
      const file = shelves[f.shelf]?.files[f.index];
      if (file) activate(file);
    },
    [shelves, activate],
  );
  const onInspect = useCallback(
    (f: LandingFocus) => {
      const file = shelves[f.shelf]?.files[f.index];
      if (file) activate(file, { autoplay: false });
    },
    [shelves, activate],
  );
  const { focus } = useLandingKeyboardNav({
    shelfSizes,
    active: navActive && !collapsed,
    enterToken,
    onExitBottom,
    onOpen,
    onInspect,
  });
  // "W" drives the focused card's Watch Later toggle, as in the list views.
  const focusedWatchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({
    active: navActive && !collapsed,
    buttonRef: focusedWatchLaterRef,
  });

  // Keep the focused card in view (the strip scrolls sideways, the list down).
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    rootRef.current
      ?.querySelector('[data-landing-focused="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);

  const filled = shelves.filter((s) => s.files.length > 0);

  return (
    <section
      ref={rootRef}
      data-testid="home-landing"
      aria-label={t("home.landingTitle")}
      className="flex flex-col gap-3 border-b border-border pb-4"
    >
      <div className="flex items-center gap-2 px-4">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex h-6 items-center gap-1 rounded px-1 text-[11px] tracking-wider text-muted transition hover:bg-fg/10 hover:text-fg"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          {t("home.landingTitle")}
        </button>
        {collapsed && (
          <span className="truncate text-[11px] text-muted">
            {filled.map((s) => s.title).join(" · ")}
          </span>
        )}
        <span className="flex-1" />
        {collapsed ? (
          <ShelfAction onClick={onOpenDiscover}>
            {t("discover.title")}
            <Sparkles className="size-3.5" />
          </ShelfAction>
        ) : (
          <ShelfAction onClick={onToggleCollapsed}>
            {t("home.landingCollapse")}
            <ChevronDown className="size-3.5" />
          </ShelfAction>
        )}
      </div>

      {!collapsed &&
        shelves.map((shelf, shelfIndex) =>
          shelf.files.length === 0 ? null : (
            <Shelf
              key={shelf.id}
              title={shelf.title}
              hint={shelf.hint}
              action={shelf.action}
            >
              {shelf.files.map((file, index) => {
                const focused =
                  focus?.shelf === shelfIndex && focus.index === index;
                return (
                  <LandingCard
                    key={`${file.workspaceId}:${file.id}`}
                    file={file}
                    mediaBase={mediaBase}
                    version={
                      thumbVersion[`${file.workspaceId}:${file.id}`] ?? 0
                    }
                    watchLater={watchLater}
                    focused={focused}
                    watchLaterRef={focused ? focusedWatchLaterRef : undefined}
                  />
                );
              })}
            </Shelf>
          ),
        )}
    </section>
  );
});

function ShelfAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
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

function Shelf({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-4">
        <h2 className="text-[13px] font-semibold text-bright-fg">{title}</h2>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {/* Sideways strip. The app's own scrollbar (ScrollArea), shown only
          while the cards overflow; the viewport keeps room under the cards
          for it, as it overlays the content. */}
      <ScrollArea type="auto" viewportClassName="px-4 pb-3">
        <div className="flex gap-3">{children}</div>
      </ScrollArea>
    </div>
  );
}

const CARD_WIDTH_CLASS = "w-[200px]";

// Same two click regions as the grid card (thumbnail → open with autoplay,
// name → inspect), minus rating and tags: the shelf is an entry point, the
// grid below is where editing happens.
const LandingCard = memo(function LandingCard({
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
  watchLaterRef?: React.Ref<HTMLButtonElement>;
}) {
  const { onThumbnailClick } = useActivateFile();
  return (
    <div
      data-testid="landing-card"
      data-landing-focused={focused ? "true" : undefined}
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group flex shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-primary",
        CARD_WIDTH_CLASS,
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
