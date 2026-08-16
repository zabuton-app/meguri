// Watch Later toggle for list entries (grid card, list row, table row).
// Mirrors FavoriteButton, except that the collection id and membership come from
// the parent view via useWatchLater() — resolving them per row would give every
// rendered card its own query observer and a linear scan of the collection.
import { Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { invalidateCollectionSearches } from "@/lib/queryCache";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
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
}

export function WatchLaterButton({
  fileId,
  workspaceId,
  watchLater,
  size = 16,
  className,
}: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const included = watchLater.has(workspaceId, fileId);

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
      invalidateCollectionSearches(qc);
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
  return (
    <button
      type="button"
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate(!included);
      }}
      disabled={toggle.isPending || !watchLater.id}
      aria-pressed={included}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center justify-center transition-colors",
        included ? "text-primary" : "text-muted hover:text-primary",
        className,
      )}
    >
      <Clock
        style={{ width: size, height: size }}
        className={cn(
          "transition-transform hover:scale-110",
          included && "fill-current",
        )}
      />
    </button>
  );
}
