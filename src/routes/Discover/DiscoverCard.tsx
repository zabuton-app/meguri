import type { ReactNode } from "react";
import { Link } from "react-router";
import { ExternalLink, Film, Heart, ImageIcon, Play } from "lucide-react";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/RatingStars";
import { useHoverFramePreview } from "@/hooks/useHoverFramePreview";
import { usePreferences } from "@/settings/PreferencesProvider";
import { formatDuration, formatSize } from "@/lib/format";
import { LIST_HIDDEN_SOURCES } from "@shared/tags";
import { tagColorClass } from "@/lib/tagColorClass";
import { tagHumanLabel } from "@/lib/tagLabel";
import { TagChipLabel } from "@/components/TagChipLabel";
import type { TFunc } from "@/i18n/I18nProvider";
import { detailPath } from "./utils";
import { SceneRail } from "./SceneRail";

// Full-bleed immersive slide: the media fills the card (blurred cover backdrop
// + sharp contain foreground) and all info/actions are overlaid on gradient
// scrims. The whole media area is a link to the detail/player; overlay
// containers are pointer-events-none so empty overlay space still clicks
// through, with interactive children opting back in.
export function DiscoverCard({
  file,
  mediaBase,
  thumbVersion,
  onRate,
  onToggleFavorite,
  filterParam,
  workspaceName,
  isActive,
  t,
}: {
  file: FileRow;
  mediaBase: string;
  /** Bumped on thumb:done so a regenerated thumbnail busts the browser cache. */
  thumbVersion: number;
  onRate: (rating: number) => void;
  onToggleFavorite: () => void;
  filterParam?: string;
  /** Label of the file's workspace, shown as the first meta chip. */
  workspaceName?: string;
  /** Whether this slide is the selected one (scene frames load lazily per slide). */
  isActive: boolean;
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
  const isVideo = file.kind === "video";
  const ActionIcon = isVideo ? Play : ImageIcon;
  const detailTo = detailPath(file.id, wsId, filterParam);
  const showRail = isVideo && !!file.duration && file.duration > 0 && isActive;

  // Hover scrub preview on the main media (same behavior/preference as the
  // list thumbnails): pointer X maps onto the video timeline.
  const { hoverPreview, frameQuality } = usePreferences();
  const { previewSrc, scrubFraction, onMouseEnter, onMouseMove, onMouseLeave } =
    useHoverFramePreview({
      enabled: Boolean(hoverPreview && hasThumb && isVideo),
      frameUrl: (t) =>
        `${mediaBase}/ws/${wsId}/frame/${file.id}?t=${t}&q=${frameQuality}`,
      duration: file.duration,
      fileId: file.id,
    });

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Media layers. Click anywhere to open the detail/player. */}
      <Link
        to={detailTo}
        className="absolute inset-0 block"
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {src ? (
          <>
            <img
              src={src}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
            />
            <img
              src={src}
              alt={file.relPath}
              className="absolute inset-0 h-full w-full object-contain"
            />
            {previewSrc && (
              <img
                src={previewSrc}
                alt=""
                className="absolute inset-0 h-full w-full bg-black object-contain"
              />
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            {isVideo ? (
              <Film className="size-16" />
            ) : (
              <ImageIcon className="size-16" />
            )}
          </div>
        )}
      </Link>

      {/* Gradient scrims for overlay legibility. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-bg/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-bg/90 via-bg/40 to-transparent" />

      {/* Center play affordance (videos only). */}
      {isVideo && (
        <Link
          to={detailTo}
          aria-label={t("discover.play")}
          className="absolute left-1/2 top-1/2 z-20 flex size-[76px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-bg/40 text-bright-fg backdrop-blur-md transition hover:scale-105 hover:bg-bg/60"
        >
          <Play className="size-7 translate-x-0.5 fill-current" />
        </Link>
      )}

      {/* Bottom overlay: scene rail, title, meta chips, actions. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-6 p-5 pb-4">
        <div className="min-w-0 flex-1">
          {showRail && file.duration ? (
            <SceneRail
              id={file.id}
              total={file.duration}
              mediaBase={mediaBase}
              wsId={wsId}
              filterParam={filterParam}
              t={t}
              className="pointer-events-auto mb-2"
            />
          ) : null}

          <h2
            className="truncate text-xl font-bold text-bright-fg drop-shadow-md"
            title={file.relPath}
          >
            {basename}
          </h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {workspaceName && <Chip>{workspaceName}</Chip>}
            {file.width && file.height ? (
              <Chip>
                {file.width}×{file.height}
              </Chip>
            ) : null}
            {isVideo ? (
              <Chip>
                {formatDuration(file.duration, { hours: true, fallback: "—" })}
              </Chip>
            ) : (
              <>
                {file.size ? <Chip>{formatSize(file.size)}</Chip> : null}
                {file.capturedAt ? (
                  <Chip>
                    {new Date(file.capturedAt * 1000).toLocaleDateString()}
                  </Chip>
                ) : null}
              </>
            )}
            <Chip interactive className="gap-2">
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
                <Heart className={cn("size-3.5", isFav && "fill-current")} />
              </button>
              <RatingStars value={file.rating} onChange={onRate} size={14} />
            </Chip>
            {file.tags
              ?.filter((tag) => !LIST_HIDDEN_SOURCES.includes(tag.source))
              .map((tag) => (
                <Chip
                  key={`${tag.id}-${tag.source}`}
                  className={tagColorClass(tag.source)}
                  title={tagHumanLabel(t, tag.namespace, tag.name)}
                >
                  <TagChipLabel namespace={tag.namespace} name={tag.name} />
                </Chip>
              ))}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2.5">
          <Button asChild size="lg" className="px-7 font-bold shadow-lg">
            <Link to={detailTo}>
              <ActionIcon className={isVideo ? "fill-current" : undefined} />
              {isVideo ? t("discover.play") : t("discover.open")}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0 border-border/60 bg-bg/50 backdrop-blur-md"
            onClick={() => void api.openExternal(file.id, wsId)}
            title={t("media.openExternal")}
            aria-label={t("media.openExternal")}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {/* Seekbar-style indicator while hover-scrubbing. */}
      {previewSrc && scrubFraction != null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-1 bg-bg/40">
          <div
            className="h-full bg-primary"
            style={{ width: `${scrubFraction * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Small translucent meta chip used in the bottom overlay. */
function Chip({
  children,
  interactive,
  className,
  title,
}: {
  children: ReactNode;
  interactive?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "flex items-center rounded-md border border-border/60 bg-bg/50 px-2 py-1 text-xs text-fg backdrop-blur-md",
        interactive && "pointer-events-auto",
        className,
      )}
    >
      {children}
    </span>
  );
}
