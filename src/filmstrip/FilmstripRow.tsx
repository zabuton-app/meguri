import { memo, type Ref } from "react";
import { Bookmark } from "lucide-react";
import { HashLink } from "@/components/HashLink";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { SelectionCheck } from "@/components/SelectionCheck";
import { TagChips } from "@/components/TagChips";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
import { useSelectableClick } from "@/hooks/useSelectableClick";
import { useActivateFile } from "@/audio/useActivateFile";
import { mediaSortId } from "@/lib/mediaSortId";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { fileNameOf } from "@/lib/relPath";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import type { ImageLimiter } from "@/filmstrip/imageLimiter";
import { FRAME_H, FrameStrip } from "@/filmstrip/FrameStrip";
import { Waveform } from "@/filmstrip/Waveform";

/** Details for the left column: duration, size, codec and frame rate. */
function detailsOf(file: FileRow): string {
  const parts: string[] = [];
  if (file.kind !== "image" && file.duration)
    parts.push(formatDuration(file.duration));
  if (file.width && file.height) parts.push(`${file.width}×${file.height}`);
  if (file.codec) parts.push(file.codec);
  if (file.fps) parts.push(`${Number(file.fps.toFixed(2))} fps`);
  return parts.join(" · ");
}

// The row is a stretched link that opens the file paused, as the list's is;
// frames, the waveform, the thumbnail and the toggles sit above it.
export const FilmstripRow = memo(function FilmstripRow({
  file,
  index,
  mediaBase,
  limiter,
  onScreen,
  onTagClick,
  focused,
  peeked,
  watchLater,
  watchLaterRef,
}: {
  file: FileRow;
  /** Position in the loaded list — what a Shift-click ranges from. */
  index: number;
  mediaBase: string;
  limiter: ImageLimiter;
  onScreen: boolean;
  onTagClick?: (name: string) => void;
  focused?: boolean;
  peeked?: boolean;
  watchLater: WatchLaterMembership;
  watchLaterRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  const { onThumbnailClick } = useActivateFile();
  const { selected, onSelectableClick } = useSelectableClick(file, index);
  const duration = file.duration ?? 0;
  const timeline = file.kind !== "image" && duration > 0;
  const bookmarks = file.bookmarkSecs?.length ?? 0;
  const details = detailsOf(file);

  return (
    <div
      data-slot="filmstrip-row"
      data-file-key={mediaSortId(file)}
      aria-current={focused ? "true" : peeked ? "page" : undefined}
      data-selected={selected || undefined}
      className={cn(
        "group relative flex items-start gap-4 rounded-card p-2 transition-colors hover:bg-fg/10",
        selected && "bg-primary/15 hover:bg-primary/25",
        peeked && "ring-1 ring-inset ring-primary",
        focused && "ring-2 ring-inset ring-primary",
      )}
    >
      <div className="flex w-64 shrink-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <SelectionCheck
            file={file}
            index={index}
            className="relative z-10 shrink-0"
          />
          <HashLink
            to={fileHref(file.id, file.workspaceId, { autoplay: false })}
            onClick={onSelectableClick}
            className="h-6 min-w-0 truncate text-sm font-medium leading-6 text-bright-fg outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
          >
            <span title={file.relPath}>{fileNameOf(file.relPath)}</span>
          </HashLink>
        </div>
        <div className="truncate text-xs tabular-nums text-muted">
          {details || "—"}
        </div>
        <div className="no-scrollbar pointer-events-none relative z-10 flex h-5 w-fit max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden [&>button]:pointer-events-auto">
          <TagChips tags={file.tags} onTagClick={onTagClick} />
        </div>
        <div className="pointer-events-none relative z-10 flex items-center gap-3 text-xs text-muted [&>*]:pointer-events-auto">
          {bookmarks > 0 && (
            <span
              className="flex items-center gap-1"
              aria-label={t("filmstrip.bookmarks", { count: bookmarks })}
              title={t("filmstrip.bookmarks", { count: bookmarks })}
            >
              <Bookmark className="size-3" aria-hidden />
              <span aria-hidden>{bookmarks}</span>
            </span>
          )}
          <FavoriteButton
            fileId={file.id}
            workspaceId={file.workspaceId}
            favorite={file.favorite}
            size={14}
          />
          <WatchLaterButton
            ref={watchLaterRef}
            fileId={file.id}
            workspaceId={file.workspaceId}
            watchLater={watchLater}
            size={14}
          />
        </div>
      </div>

      {timeline && file.kind === "video" ? (
        <FrameStrip
          file={file}
          duration={duration}
          mediaBase={mediaBase}
          limiter={limiter}
          onScreen={onScreen}
          onFrameClick={onSelectableClick}
        />
      ) : timeline && file.kind === "audio" ? (
        <Waveform
          file={file}
          duration={duration}
          mediaBase={mediaBase}
          limiter={limiter}
          onScreen={onScreen}
        />
      ) : (
        // An image, or a file not probed yet: its thumbnail, once.
        <HashLink
          data-slot="filmstrip-thumb"
          to={fileHref(file.id, file.workspaceId)}
          onClick={(e) => {
            if (onSelectableClick(e)) return;
            onThumbnailClick(file)(e);
          }}
          aria-label={fileNameOf(file.relPath)}
          className="relative z-10 block aspect-video shrink-0 overflow-hidden rounded-item bg-overlay text-muted"
          style={{ height: FRAME_H }}
        >
          <MediaThumbnail
            file={file}
            mediaBase={mediaBase}
            showPlayOverlay={false}
          />
        </HashLink>
      )}
    </div>
  );
});
