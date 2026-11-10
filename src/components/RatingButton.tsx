// Rating stars with a self-contained mutation. Like FavoriteButton, it runs the
// mutation and syncs the affected queries so list cards and the detail view
// reflect the new rating. Used across the grid/list views.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { syncFileRowAcrossCaches } from "@/lib/queryCache";
import { RatingStars } from "@/components/RatingStars";

interface Props {
  fileId: number;
  /** Owning workspace ID (file IDs are unique only within a workspace). */
  workspaceId: string;
  /** Current rating (0..5). */
  rating: number;
  size?: number;
}

export function RatingButton({
  fileId,
  workspaceId,
  rating,
  size = 16,
}: Props) {
  const qc = useQueryClient();

  // The file goes in with the variables, as in FavoriteButton (#258).
  const setRating = useMutation({
    mutationFn: (v: { fileId: number; workspaceId: string; rating: number }) =>
      api.fileSetRating(v.fileId, v.workspaceId, v.rating),
    onSuccess: (_d, v) => {
      syncFileRowAcrossCaches(qc, v.workspaceId, v.fileId, {
        rating: v.rating,
      });
    },
  });

  return (
    <div
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="flex items-center"
    >
      <RatingStars
        value={rating}
        onChange={(r) => setRating.mutate({ fileId, workspaceId, rating: r })}
        size={size}
        disabled={setRating.isPending}
        file={{ id: fileId, workspaceId }}
      />
    </div>
  );
}
