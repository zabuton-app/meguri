// Rating star display/editing. 0..5. Click to set; clicking the same value resets to 0.
// On activation it plays a control-local effect: a staggered pop across stars
// 1..N with a particle burst on the selected star, or a joint settle fade when
// clearing. The trigger lives in local state set only inside the click handler,
// so value changes arriving via props can never fire it (spec 009, FR-005).
import { useState } from "react";
import { Star } from "lucide-react";
import { BurstEffect } from "@/components/effects/BurstEffect";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

/** Per-star delay of the staggered pop when setting a rating. */
const STAGGER_MS = 40;

interface Props {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  /** Disables interaction (e.g. while a rating mutation is in flight). */
  disabled?: boolean;
}

export function RatingStars({
  value,
  onChange,
  size = 16,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const editable = !!onChange && !disabled;
  const prefersReducedMotion = usePrefersReducedMotion();
  // seq=0 means "never activated"; each activation remounts the animated star
  // wrappers via key so a running effect restarts cleanly (FR-008). For
  // "clear", `upTo` keeps the pre-click value so the previously lit stars are
  // the ones that settle.
  const [fx, setFx] = useState<{
    seq: number;
    variant: "set" | "clear";
    upTo: number;
  }>({ seq: 0, variant: "set", upTo: 0 });

  const showFx = fx.seq > 0 && !prefersReducedMotion;

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const animated = showFx && n <= fx.upTo;
        return (
          <button
            key={n}
            type="button"
            disabled={!editable}
            onClick={() => {
              const next = n === value ? 0 : n;
              setFx((f) => ({
                seq: f.seq + 1,
                variant: next === 0 ? "clear" : "set",
                upTo: next === 0 ? value : next,
              }));
              onChange?.(next);
            }}
            className={cn(
              "relative transition-colors",
              editable ? "cursor-pointer hover:scale-110" : "cursor-default",
            )}
            aria-label={t("rating.star", { n })}
          >
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
                style={{ width: size, height: size }}
                className={n <= value ? "fill-accent2 text-accent2" : "text-muted"}
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
          </button>
        );
      })}
    </div>
  );
}
