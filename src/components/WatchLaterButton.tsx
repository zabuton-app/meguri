// Watch Later toggle for list entries (grid card, list row, table row).
// Mirrors FavoriteButton, except that the collection id and membership come from
// the parent view via useWatchLater() — resolving them per row would give every
// rendered card its own query observer and a linear scan of the collection.
// It also plays the same control-local effect (burst on queue, settle on
// unqueue); the trigger lives in local state set only inside the click handler,
// so cache syncs from other views can never fire it (spec 009, FR-005).
import { useState, type Ref } from "react";
import { Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { invalidateCollectionSearches } from "@/lib/queryCache";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
import { BurstEffect } from "@/components/effects/BurstEffect";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  fileId: number;
  /** Owning workspace ID (file IDs are unique only within a workspace). */
  workspaceId: string;
  /** Shared membership lookup from the enclosing view. */
  watchLater: WatchLaterMembership;
  size?: number;
  className?: string;
  /**
   * Skip the collection-search invalidation on success. The detail view sets
   * this: refetching a collection-scoped list while a file is open drops that
   * file out of the prev/next order (the same reason the main process stays
   * quiet about its own auto-removal — see `removeFromWatchLater` in
   * electron/core/workspaces.ts). MediaDetail flushes those caches on close.
   */
  deferListRefresh?: boolean;
  /**
   * Handle on the underlying button. Discovery uses it to drive the toggle from
   * a keyboard shortcut through this same control, so the mutation, toast,
   * effect and disabled state stay in one place.
   */
  ref?: Ref<HTMLButtonElement>;
}

export function WatchLaterButton({
  fileId,
  workspaceId,
  watchLater,
  size = 16,
  className,
  deferListRefresh = false,
  ref,
}: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const included = watchLater.has(workspaceId, fileId);
  const prefersReducedMotion = usePrefersReducedMotion();
  // seq=0 means "never activated"; each activation remounts the animated
  // wrapper via key so a running effect restarts cleanly (FR-008).
  const [fx, setFx] = useState<{ seq: number; variant: "add" | "remove" }>({
    seq: 0,
    variant: "add",
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) => {
      if (!watchLater.id) return Promise.resolve();
      return next
        ? api.collectionAddFile(watchLater.id, fileId, workspaceId)
        : api.collectionRemoveFile(watchLater.id, fileId, workspaceId);
    },
    onSuccess: (_d, next) => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      // Membership changes only affect collection-scoped lists, not workspace lists.
      if (!deferListRefresh) invalidateCollectionSearches(qc);
      toast.success(
        next ? t("watchLater.addedToast") : t("watchLater.removedToast"),
      );
    },
    onError: (error: unknown) => {
      toast.error(t("watchLater.actionFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const label = included ? t("watchLater.remove") : t("watchLater.add");
  const showFx = fx.seq > 0 && !prefersReducedMotion;

  return (
    <button
      ref={ref}
      type="button"
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !included;
        setFx((f) => ({ seq: f.seq + 1, variant: next ? "add" : "remove" }));
        toggle.mutate(next);
      }}
      disabled={toggle.isPending || !watchLater.id}
      aria-pressed={included}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex items-center justify-center transition-colors",
        included ? "text-primary" : "text-muted hover:text-primary",
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
        <Clock
          style={{ width: size, height: size }}
          className={cn(
            "transition-transform hover:scale-110",
            included && "fill-current",
          )}
        />
      </span>
      {showFx && fx.variant === "add" && (
        // The burst is always in the queued color, independent of the button's
        // current (pre-mutation) text color.
        <BurstEffect
          key={`burst-${fx.seq}`}
          sizePx={size}
          colorClass="text-primary"
        />
      )}
    </button>
  );
}
