// Rating star display/editing. 0..5. Click to set; clicking the same value resets to 0.
// On activation it plays a control-local effect: a staggered pop across stars
// 1..N with a particle burst on the selected star, or a joint settle fade when
// clearing. The trigger lives in local state set only inside the click handler,
// so value changes arriving via props can never fire it (spec 009, FR-005). The
// one other trigger is an explicit request from a menu that changed the file
// (see lib/fileFxStore), for which the caller names the file.
import { Star } from "lucide-react";
import { BurstEffect } from "@/components/effects/BurstEffect";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  useDrawnRatingFx,
  useRatingFx,
  type FileKey,
  type RatingFx,
} from "@/lib/fileFxStore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

/** How star `n` is drawn for a rating of `value`: lit up to the value. */
function starClass(n: number, value: number): string {
  return n <= value ? "fill-accent2 text-accent2" : "text-muted";
}

/** Per-star delay of the staggered pop when setting a rating. */
const STAGGER_MS = 40;

/**
 * Star `n` and its share of an effect: the pop or settle on the icon, and the
 * burst on the last star set. Its parent must be position: relative.
 */
function StarIcon({
  n,
  value,
  size,
  fx,
  showFx,
}: {
  n: number;
  value: number;
  size: number;
  fx: RatingFx;
  showFx: boolean;
}) {
  const animated = showFx && n <= fx.upTo;
  return (
    <>
      {/* Keys share fx.seq to restart on re-activation but must stay
          distinct between siblings — equal sibling keys corrupt React's
          reconciliation and leave stale DOM behind. */}
      <span
        key={`icon-${animated ? fx.seq : 0}`}
        className={cn(
          "flex",
          animated && (fx.variant === "set" ? "fx-pop" : "fx-settle"),
        )}
        style={
          animated && fx.variant === "set"
            ? { animationDelay: `${(n - 1) * STAGGER_MS}ms` }
            : undefined
        }
      >
        <Star
          aria-hidden
          style={{ width: size, height: size }}
          className={starClass(n, value)}
        />
      </span>
      {animated && fx.variant === "set" && n === fx.upTo && (
        <BurstEffect
          key={`burst-${fx.seq}`}
          sizePx={size}
          colorClass="text-accent2"
          // Fire together with this star's (last) staggered pop.
          delayMs={(n - 1) * STAGGER_MS}
        />
      )}
    </>
  );
}

interface Props {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  /** Disables interaction (e.g. while a rating mutation is in flight). */
  disabled?: boolean;
  /** Whose rating this is; plays the effects a menu asks for on that file. */
  file?: FileKey;
}

export function RatingStars({
  value,
  onChange,
  size = 16,
  disabled = false,
  file,
}: Props) {
  const { t } = useI18n();
  const editable = !!onChange && !disabled;
  const prefersReducedMotion = usePrefersReducedMotion();
  // seq=0 means "never activated"; each activation remounts the animated star
  // wrappers via key so a running effect restarts cleanly (FR-008). For
  // "clear", `upTo` keeps the pre-click value so the previously lit stars are
  // the ones that settle.
  const [fx, playFx] = useRatingFx(file);

  const showFx = fx.seq > 0 && !prefersReducedMotion;

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        return (
          <button
            key={n}
            type="button"
            disabled={!editable}
            onClick={() => {
              const next = n === value ? 0 : n;
              playFx({
                variant: next === 0 ? "clear" : "set",
                upTo: next === 0 ? value : next,
              });
              onChange?.(next);
            }}
            className={cn(
              "relative transition-colors",
              editable ? "cursor-pointer hover:scale-110" : "cursor-default",
            )}
            aria-label={t("rating.star", { n })}
          >
            <StarIcon n={n} value={value} size={size} fx={fx} showFx={showFx} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same five stars, drawn only: no buttons, no effect state, a third of the
 * DOM. For a card that is not being hovered (see useHoverActivation), which
 * swaps in the editable RatingButton once it is. Laid out exactly as
 * RatingStars inside RatingButton, so the swap moves nothing.
 */
export function RatingStarsView({
  value,
  size = 16,
  file,
}: {
  value: number;
  size?: number;
  /** Whose rating this is; plays the effects a menu asks for on that file. */
  file?: FileKey;
}) {
  const { t } = useI18n();
  const fx = useDrawnRatingFx(file);
  return (
    <div
      role="img"
      aria-label={t("rating.value", { n: value })}
      className="flex items-center"
    >
      <div className="flex items-center gap-0.5">
        {fx ? (
          <StarsViewFx value={value} size={size} fx={fx} />
        ) : (
          <PlainStars value={value} size={size} />
        )}
      </div>
    </div>
  );
}

function PlainStars({ value, size }: { value: number; size: number }) {
  return [1, 2, 3, 4, 5].map((n) => (
    <Star
      key={n}
      aria-hidden
      style={{ width: size, height: size }}
      className={starClass(n, value)}
    />
  ));
}

/**
 * The drawn stars playing an effect a menu asked for. Apart from the plain
 * ones so that only a card playing one reads the motion preference: every
 * card in a scrolled grid mounts a RatingStarsView.
 */
function StarsViewFx({
  value,
  size,
  fx,
}: {
  value: number;
  size: number;
  fx: RatingFx;
}) {
  if (usePrefersReducedMotion())
    return <PlainStars value={value} size={size} />;
  return [1, 2, 3, 4, 5].map((n) => (
    // Wrapped for the burst to sit on.
    <span key={n} className="relative">
      <StarIcon n={n} value={value} size={size} fx={fx} showFx />
    </span>
  ));
}
