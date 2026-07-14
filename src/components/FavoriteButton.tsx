// Favorite (heart) toggle. Self-contained: runs the mutation and invalidates the
// affected queries so list cards and the detail view reflect the new state.
import { Heart } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { syncFileRowAcrossCaches } from "@/lib/queryCache";
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

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api.fileSetFavorite(fileId, workspaceId, next),
    onSuccess: (_d, next) => {
      syncFileRowAcrossCaches(qc, workspaceId, fileId, {
        favorite: next ? 1 : 0,
      });
    },
  });

  return (
    <button
      type="button"
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate(!isFav);
      }}
      disabled={toggle.isPending}
      aria-pressed={isFav}
      aria-label={isFav ? t("favorite.remove") : t("favorite.add")}
      title={isFav ? t("favorite.remove") : t("favorite.add")}
      className={cn(
        "flex items-center justify-center transition-colors",
        isFav ? "text-error" : "text-muted hover:text-error",
        className,
      )}
    >
      <Heart
        style={{ width: size, height: size }}
        className={cn(
          "transition-transform hover:scale-110",
          isFav && "fill-current",
        )}
      />
    </button>
  );
}
