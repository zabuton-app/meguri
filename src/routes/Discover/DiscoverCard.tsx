import { Link } from "react-router-dom";
import { ExternalLink, Film, Heart, ImageIcon, Play } from "lucide-react";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/RatingStars";
import { formatDuration } from "@/lib/format";
import type { TFunc } from "@/i18n/I18nProvider";
import { detailPath } from "./utils";

export function DiscoverCard({
  file,
  mediaBase,
  thumbVersion,
  onRate,
  onToggleFavorite,
  filterParam,
  t,
}: {
  file: FileRow;
  mediaBase: string;
  /** Bumped on thumb:done so a regenerated thumbnail busts the browser cache. */
  thumbVersion: number;
  onRate: (rating: number) => void;
  onToggleFavorite: () => void;
  filterParam?: string;
  t: TFunc;
}) {
  const wsId = file.workspaceId;
  const isFav = !!file.favorite;
  const hasThumb = file.thumbStatus === "done" && mediaBase && wsId;
  const src = hasThumb
    ? `${mediaBase}/ws/${wsId}/thumb/${file.id}?v=${thumbVersion}`
    : undefined;
  const slash = file.relPath.lastIndexOf("/");
  const basename = slash >= 0 ? file.relPath.slice(slash + 1) : file.relPath;
  const dir = slash >= 0 ? file.relPath.slice(0, slash) : "";
  const isVideo = file.kind === "video";
  const ActionIcon = isVideo ? Play : ImageIcon;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] md:gap-5">
      {/* Large preview. Click to open the detail/player. */}
      <Link
        to={detailPath(file.id, wsId, filterParam)}
        className="group relative block aspect-video w-full self-start overflow-hidden rounded-xl border border-border bg-black"
      >
        {src ? (
          <img
            src={src}
            alt={file.relPath}
            className="h-full w-full object-contain transition group-hover:opacity-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            {isVideo ? (
              <Film className="size-12" />
            ) : (
              <ImageIcon className="size-12" />
            )}
          </div>
        )}
        {isVideo ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
            <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <Play className="size-6 translate-x-0.5 fill-current" />
            </span>
          </div>
        ) : null}
        {isVideo && file.duration ? (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 text-[11px] tabular-nums text-white">
            {formatDuration(file.duration, { hours: true, fallback: "—" })}
          </span>
        ) : null}
      </Link>

      {/* Right column: meta panel */}
      <div className="flex min-w-0 flex-col gap-3">
        {/* Title + path */}
        <div className="min-w-0">
          <h2
            className="line-clamp-2 text-base font-semibold leading-snug text-bright-fg"
            title={file.relPath}
          >
            {basename}
          </h2>
          {dir && (
            <p
              className="mt-0.5 truncate text-xs text-muted"
              title={file.relPath}
            >
              {dir}
            </p>
          )}
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            {file.width && file.height ? `${file.width}×${file.height}` : "—"}
          </Badge>
          {isVideo ? (
            <Badge variant="outline" className="font-normal">
              {formatDuration(file.duration, { hours: true, fallback: "—" })}
            </Badge>
          ) : null}
        </div>

        {/* Favorite + rating */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={isFav}
            aria-label={isFav ? t("favorite.remove") : t("favorite.add")}
            title={isFav ? t("favorite.remove") : t("favorite.add")}
            className={cn(
              "flex items-center justify-center transition-colors",
              isFav ? "text-error" : "text-muted hover:text-error",
            )}
          >
            <Heart
              className={cn(
                "size-[18px] transition-transform hover:scale-110",
                isFav && "fill-current",
              )}
            />
          </button>
          <RatingStars value={file.rating} onChange={onRate} size={18} />
        </div>

        {/* Tags */}
        <div className="no-scrollbar flex min-h-0 flex-wrap gap-1 overflow-y-auto">
          {file.tags && file.tags.length > 0 ? (
            file.tags.map((tag) => (
              <span
                key={`${tag.id}-${tag.source}`}
                className="h-fit shrink-0 rounded bg-overlay px-1.5 text-[11px] leading-5 text-fg"
              >
                {tag.name}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-muted">{t("tag.none")}</span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button asChild size="sm" className="flex-1">
            <Link to={detailPath(file.id, wsId, filterParam)}>
              <ActionIcon className={isVideo ? "fill-current" : undefined} />
              {isVideo ? t("discover.play") : t("discover.open")}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => void api.openExternal(file.id, wsId)}
            title={t("media.openExternal")}
            aria-label={t("media.openExternal")}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>
    </div>
  );
}
