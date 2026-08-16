// Watch Later toggle for list entries (grid card, list row, table row).
// Self-contained like FavoriteButton: it resolves the built-in collection from
// the workspace list, runs the add/remove mutation, and refreshes the caches
// that show collection membership.
import { Clock } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { invalidateCollectionSearches } from "@/lib/queryCache";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  fileId: number;
  /** Owning workspace ID (file IDs are unique only within a workspace). */
  workspaceId: string;
  size?: number;
  className?: string;
}

export function WatchLaterButton({
  fileId,
  workspaceId,
  size = 16,
  className,
}: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const watchLater =
    workspaces.data?.collections.find((c) => c.id === WATCH_LATER_ID) ?? null;
  const included =
    watchLater?.items.some(
      (item) => item.workspaceId === workspaceId && item.fileId === fileId,
    ) ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) => {
      if (!watchLater) return Promise.resolve();
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
      disabled={toggle.isPending || !watchLater}
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
