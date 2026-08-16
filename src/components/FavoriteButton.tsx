// Favorite (heart) toggle. Self-contained: runs the mutation and invalidates the
// affected queries so list cards and the detail view reflect the new state.
// On activation it also plays a control-local effect (burst on add, settle on
// remove). The trigger lives in local state set only inside the click handler,
// so cache syncs from other views can never fire it (spec 009, FR-005).
import { useState } from "react";
import { Heart } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { syncFileRowAcrossCaches } from "@/lib/queryCache";
import { BurstEffect } from "@/components/effects/BurstEffect";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  fileId: number;
  /** Owning workspace ID (file IDs are unique only within a workspace). */
  workspaceId: string;
  /** Current favorite state (accepts the DB's 0/1 number or a boolean). */
  favorite: boolean | number;
  size?: number;
  className?: string;
}

export function FavoriteButton({
  fileId,
  workspaceId,
  favorite,
  size = 16,
  className,
}: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const isFav = !!favorite;
  const prefersReducedMotion = usePrefersReducedMotion();
  // seq=0 means "never activated"; each activation remounts the animated
  // wrapper via key so a running effect restarts cleanly (FR-008).
  const [fx, setFx] = useState<{ seq: number; variant: "add" | "remove" }>({
    seq: 0,
    variant: "add",
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api.fileSetFavorite(fileId, workspaceId, next),
    onSuccess: (_d, next) => {
      syncFileRowAcrossCaches(qc, workspaceId, fileId, {
        favorite: next ? 1 : 0,
      });
    },
  });

  const showFx = fx.seq > 0 && !prefersReducedMotion;

  return (
    <button
      type="button"
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !isFav;
        setFx((f) => ({ seq: f.seq + 1, variant: next ? "add" : "remove" }));
        toggle.mutate(next);
      }}
      disabled={toggle.isPending}
      aria-pressed={isFav}
      aria-label={isFav ? t("favorite.remove") : t("favorite.add")}
      title={isFav ? t("favorite.remove") : t("favorite.add")}
      className={cn(
        "relative flex items-center justify-center transition-colors",
        isFav ? "text-error" : "text-muted hover:text-error",
        className,
      )}
    >
      {/* Keys share fx.seq to restart on re-activation but must stay distinct
          between siblings — equal sibling keys corrupt React's reconciliation
          and leave stale DOM behind. */}
      <span
        key={`icon-${fx.seq}`}
        className={cn(
          "flex",
          showFx && (fx.variant === "add" ? "fx-pop" : "fx-settle"),
        )}
      >
        <Heart
          style={{ width: size, height: size }}
          className={cn(
            "transition-transform hover:scale-110",
            isFav && "fill-current",
          )}
        />
      </span>
      {showFx && fx.variant === "add" && (
        // The burst is always in the heart's "favorited" color, independent of
        // the button's current (pre-mutation) text color.
        <BurstEffect key={`burst-${fx.seq}`} sizePx={size} colorClass="text-error" />
      )}
    </button>
  );
}
