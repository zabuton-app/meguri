// The floating bar that appears while a selection is being built.
//
// It stays put once selection mode is on, even at zero selected: the bar is the
// only way back out, and taking it away the moment the last row is deselected
// leaves the user in a mode with no visible exit. The actions disable instead.
//
// Every control here mirrors one that exists per file (tags, rating, favorite,
// Watch Later) and reads the selection as a whole: a mixed selection is the
// normal case, so each shows what the selection currently is and levels it up
// on click (see src/lib/bulkEdit.ts for those rules).
import { useState } from "react";
import { useLocation } from "react-router";
import { Clock, Heart, Link2, StarOff, Tag, X } from "lucide-react";
import { useSelection } from "@/components/SelectionContext";
import { BurstEffect } from "@/components/effects/BurstEffect";
import { RatingStars } from "@/components/RatingStars";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useBulkEdit } from "@/hooks/useBulkEdit";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useI18n } from "@/i18n/I18nProvider";
import { bulkFlagOf, bulkToggleTarget, uniformRating } from "@/lib/bulkEdit";
import { MAX_BULK_FILES } from "@shared/tags";
import { cn } from "@/lib/utils";

interface Props {
  /** Opens the bulk tag dialog. */
  onEditTags: () => void;
  onRecoverSources?: () => void;
  /** Leaves selection mode. Owned by the caller, which also closes the dialog. */
  onExit: () => void;
}

const ACTION_CLASS =
  "flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-bg px-2.5 text-xs text-fg transition hover:bg-overlay disabled:cursor-default disabled:opacity-50 disabled:hover:bg-bg";

// The same button, minus the fade on `disabled`. The toggles below disable
// themselves while their write is in flight, and fading them out at that exact
// moment would play the activation effect on a half-transparent button. They dim
// only when there is nothing to act on, which the caller applies explicitly.
const TOGGLE_CLASS =
  "relative flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-bg px-2.5 text-xs text-fg transition hover:bg-overlay disabled:cursor-default disabled:hover:bg-bg";

export function SelectionBar({ onEditTags, onRecoverSources, onExit }: Props) {
  const { t } = useI18n();
  const selection = useSelection();
  const watchLaterMembership = useWatchLater();
  // A docked side peek leaves this bar usable while a file is open, so the
  // detail view's deferral rule applies here too. Matched on the route rather
  // than on "is the peek docked": what matters is that MediaDetail is mounted
  // and will flush the caches when it closes.
  const detailOpen = useLocation().pathname.startsWith("/file/");
  const bulk = useBulkEdit(selection.rows, watchLaterMembership.id, detailOpen);
  const prefersReducedMotion = usePrefersReducedMotion();
  // One counter per toggle, bumped only inside its click handler — so a state
  // change arriving from elsewhere (another view's edit landing in the cache, a
  // selection that grew) can never fire the effect. seq=0 means "never pressed".
  // Same rule the per-file controls follow.
  const [fx, setFx] = useState<{
    seq: number;
    control: "favorite" | "watchLater" | null;
    variant: "add" | "remove";
  }>({ seq: 0, control: null, variant: "add" });
  const play = (control: "favorite" | "watchLater", on: boolean) =>
    setFx((f) => ({
      seq: f.seq + 1,
      control,
      variant: on ? "add" : "remove",
    }));
  const showFx = (control: "favorite" | "watchLater") =>
    fx.seq > 0 && fx.control === control && !prefersReducedMotion;

  if (!selection.active) return null;

  const rows = selection.rows;
  // `count`, not rows.length: a selected folder past the cap holds more files
  // than were fetched for it, and those are what the cap is about.
  const empty = selection.count === 0;
  const favorite = bulkFlagOf(rows, (row) => !!row.favorite);
  const queued = bulkFlagOf(rows, (row) =>
    watchLaterMembership.has(row.workspaceId, row.id),
  );
  const rating = uniformRating(rows);
  // Past the cap one call cannot be written, so the controls refuse here — where
  // the number can be explained — instead of letting main reject the payload and
  // surfacing a raw validation message. Same rule as the tag dialog.
  const tooMany = selection.count > MAX_BULK_FILES;
  // Nothing to act on: the controls dim as well as refuse. Distinct from a write
  // in flight, which only refuses (see TOGGLE_CLASS). A folder still fetching
  // its files counts as nothing yet: an edit now would miss them.
  const unavailable = empty || tooMany || selection.pending;
  const busy = unavailable || bulk.pending;
  const limitTitle = t("select.bulkFileLimit", { max: MAX_BULK_FILES });

  return (
    <div
      role="region"
      aria-label={t("select.barLabel")}
      // z-40 puts this above the two FABs (z-30 in Home), which otherwise cover
      // it where they overlap, and below the modals and popovers (z-50) that are
      // meant to cover it — the tag dialog included.
      className="pointer-events-auto absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border-strong bg-surface p-2 shadow-lg shadow-black/40"
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap pl-0.5 pr-1 text-[13px] font-bold text-fg">
        <span
          className={cn(
            "flex size-[22px] items-center justify-center rounded-md text-xs font-bold tabular-nums",
            empty
              ? "bg-overlay text-muted"
              : "bg-primary text-primary-foreground",
          )}
        >
          {selection.count}
        </span>
        {t("select.count")}
        {selection.folderCount > 0 && (
          <span className="text-[11px] font-normal text-muted">
            {selection.pending
              ? t("select.folderLoading")
              : t("select.folderCount", { count: selection.folderCount })}
          </span>
        )}
      </span>

      <span className="h-6 w-px bg-border-strong" />

      <button
        type="button"
        className={ACTION_CLASS}
        onClick={selection.selectAll}
      >
        {t("select.selectAll")}
      </button>
      <button
        type="button"
        className={ACTION_CLASS}
        onClick={selection.deselectAll}
        disabled={empty}
      >
        {t("select.deselectAll")}
      </button>

      {onRecoverSources && (
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={onRecoverSources}
          disabled={
            selection.pending ||
            tooMany ||
            !rows.some((row) => row.kind === "video")
          }
        >
          <Link2 className="size-3.5" />
          {t("source.recoverSelected")}
        </button>
      )}

      <span className="h-6 w-px bg-border-strong" />

      <button
        type="button"
        onClick={onEditTags}
        // Capped like the others: opening a dialog whose Apply can never enable
        // is a dead end, not a refusal.
        disabled={unavailable}
        title={tooMany ? limitTitle : undefined}
        className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-md border border-primary bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-default disabled:opacity-50"
      >
        <Tag className="size-[15px]" />
        {t("select.editTags")}
        <span className="rounded bg-bg/20 px-1 text-[10px] font-bold">T</span>
      </button>

      {/* Stars read as the whole selection's rating, or as empty with a "mixed"
          tooltip when the files disagree — showing one file's value would claim
          a rating the selection does not have. Clicking sets every file. */}
      <span
        className={cn(
          "flex h-[30px] items-center gap-1 rounded-md border border-border bg-bg px-2",
          // RatingStars plays its own staggered pop and burst on click; only a
          // selection it cannot act on greys the group out.
          unavailable && "pointer-events-none opacity-50",
        )}
        title={
          tooMany
            ? limitTitle
            : rating === null
              ? t("select.ratingMixed")
              : t("select.rating")
        }
      >
        <RatingStars
          value={rating ?? 0}
          onChange={(next) => bulk.setRating(next)}
          size={14}
          disabled={busy}
        />
        {/* A mixed selection shows no lit star, so the per-file "click the same
            star again" gesture has nothing to click: clearing gets its own
            button, and only while it is the only way to do it. */}
        {rating === null && (
          <button
            type="button"
            onClick={() => bulk.setRating(0)}
            disabled={busy}
            aria-label={t("select.ratingClear")}
            title={t("select.ratingClear")}
            className="ml-1 flex items-center text-muted transition hover:text-fg"
          >
            <StarOff className="size-[13px]" />
          </button>
        )}
      </span>

      <button
        type="button"
        onClick={() => {
          const next = bulkToggleTarget(favorite.flag);
          play("favorite", next);
          bulk.setFavorite(next);
        }}
        disabled={busy}
        aria-pressed={favorite.flag === "all"}
        title={
          tooMany
            ? limitTitle
            : favorite.flag === "all"
              ? t("select.favoriteOff")
              : t("select.favorite")
        }
        className={cn(TOGGLE_CLASS, unavailable && "opacity-50")}
      >
        {/* Keys share fx.seq to restart on re-activation but must stay distinct
            between siblings — equal sibling keys corrupt React's reconciliation
            and leave stale DOM behind. */}
        <span
          key={`fav-icon-${fx.seq}`}
          className={cn(
            "flex",
            showFx("favorite") &&
              (fx.variant === "add" ? "fx-pop" : "fx-settle"),
          )}
        >
          <Heart
            className={cn(
              "size-[15px] text-error",
              // A partly-favorited selection shows an outline, not a fill: the
              // fill would read as "all of these are favorites".
              favorite.flag === "all" && "fill-current",
            )}
          />
        </span>
        {showFx("favorite") && fx.variant === "add" && (
          // Always the favorited colour, independent of the button's current
          // (pre-mutation) text colour.
          <BurstEffect
            key={`fav-burst-${fx.seq}`}
            sizePx={15}
            colorClass="text-error"
          />
        )}
        {t("select.favorite")}
        {favorite.flag === "some" && (
          <span className="text-[10px] tabular-nums text-muted">
            {favorite.on}/{favorite.total}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          const next = bulkToggleTarget(queued.flag);
          play("watchLater", next);
          bulk.setWatchLater(next);
        }}
        // Watch Later is a collection: until the workspace list has loaded there
        // is no id to write to.
        disabled={busy || !watchLaterMembership.id}
        aria-pressed={queued.flag === "all"}
        title={
          tooMany
            ? limitTitle
            : queued.flag === "all"
              ? t("select.watchLaterOff")
              : t("select.watchLater")
        }
        className={cn(TOGGLE_CLASS, unavailable && "opacity-50")}
      >
        <span
          key={`queue-icon-${fx.seq}`}
          className={cn(
            "flex",
            showFx("watchLater") &&
              (fx.variant === "add" ? "fx-pop" : "fx-settle"),
          )}
        >
          <Clock
            className={cn(
              "size-[15px]",
              queued.flag === "all" ? "text-primary" : "text-muted",
            )}
          />
        </span>
        {showFx("watchLater") && fx.variant === "add" && (
          <BurstEffect
            key={`queue-burst-${fx.seq}`}
            sizePx={15}
            colorClass="text-primary"
          />
        )}
        {t("select.watchLater")}
        {queued.flag === "some" && (
          <span className="text-[10px] tabular-nums text-muted">
            {queued.on}/{queued.total}
          </span>
        )}
      </button>

      <span className="h-6 w-px bg-border-strong" />

      <button
        type="button"
        onClick={onExit}
        aria-label={t("select.exit")}
        title={t("select.exit")}
        className="flex size-[30px] items-center justify-center rounded-md border border-border bg-bg text-muted transition hover:bg-overlay hover:text-fg"
      >
        <X className="size-[15px]" />
      </button>
    </div>
  );
}
