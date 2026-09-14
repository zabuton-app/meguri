import type { RefObject } from "react";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { RatingStars } from "@/components/RatingStars";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import { TagEditor } from "@/components/TagEditor";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";

/** Rating, Watch Later and favorite toggles, and the tag editor, as one card. */
export function RatingTagsCard({
  detail,
  fileId,
  wsId,
  watchLater,
  watchLaterRef,
  onRate,
  onAddTag,
  onRemoveTag,
  onTagClick,
  t,
}: {
  detail: FileDetail;
  fileId: number;
  wsId: string;
  watchLater: WatchLaterMembership;
  /** The Watch Later button, so the "W" shortcut can drive it. */
  watchLaterRef: RefObject<HTMLButtonElement | null>;
  onRate: (rating: number) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: number) => void;
  onTagClick: (qualifiedName: string) => void;
  t: TFunc;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs font-semibold uppercase text-muted">
          {t("media.rating")}
        </span>
        <RatingStars value={detail.rating} onChange={onRate} size={20} />
        {/* Pushed to the far end of the row, favorite outermost. */}
        <WatchLaterButton
          ref={watchLaterRef}
          fileId={fileId}
          workspaceId={wsId}
          watchLater={watchLater}
          size={22}
          deferListRefresh
          className="ml-auto"
        />
        <FavoriteButton
          fileId={fileId}
          workspaceId={wsId}
          favorite={detail.favorite}
          size={22}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-xs font-semibold uppercase text-muted">
          {t("media.tags")}
        </span>
        <TagEditor
          tags={detail.tags}
          workspaceId={wsId}
          onAdd={onAddTag}
          onRemove={onRemoveTag}
          onTagClick={onTagClick}
        />
      </div>
    </div>
  );
}
