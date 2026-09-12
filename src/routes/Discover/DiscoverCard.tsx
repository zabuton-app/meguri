import { createElement, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ImageIcon, Play } from "lucide-react";
import { kindIcon } from "@/lib/mediaKind";
import { useAudioPlayer } from "@/audio/useAudioPlayer";
import { useActivateFile } from "@/audio/useActivateFile";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";
import log from "@/lib/logger";
import { dropFromWatchLaterCache } from "@/lib/queryCache";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/components/FavoriteButton";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
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
const CENTER_PLAY_CLASS =
  "absolute left-1/2 top-1/2 z-20 flex size-[76px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-bg/40 text-bright-fg backdrop-blur-md transition hover:scale-105 hover:bg-bg/60";

export function DiscoverCard({
  file,
  mediaBase,
  thumbVersion,
  onRate,
  watchLater,
  watchLaterRef,
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
  /** Shared membership lookup, resolved once by the route. */
  watchLater: WatchLaterMembership;
  /** Set only on the selected slide, so the "w" shortcut can drive this card. */
  watchLaterRef?: Ref<HTMLButtonElement>;
  filterParam?: string;
  /** Label of the file's workspace, shown as the first meta chip. */
  workspaceName?: string;
  /** Whether this slide is the selected one (scene frames load lazily per slide). */
  isActive: boolean;
  t: TFunc;
}) {
  const qc = useQueryClient();
  const { pause: pauseAudio, current: audioCurrent } = useAudioPlayer();
  const { activate } = useActivateFile();
  const wsId = file.workspaceId;
  // Same rule as MediaThumbnail: thumb_status alone can be 'done' with no file
  // produced (audio without embedded cover art), which would 404.
  const hasThumb =
    file.thumbStatus === "done" && file.hasThumb === 1 && mediaBase && wsId;
  const thumbUrl = hasThumb
    ? `${mediaBase}/ws/${wsId}/thumb/${file.id}?v=${thumbVersion}`
    : undefined;
  // Same recovery as MediaThumbnail: a recorded thumbnail whose file has gone
  // missing 404s, and without a fallback the card would show broken artwork.
  // Keyed on the URL rather than a flag so a later version bump (or a different
  // file rendered by a reused card) gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = thumbUrl && failedSrc !== thumbUrl ? thumbUrl : undefined;
  const slash = file.relPath.lastIndexOf("/");
  const basename = slash >= 0 ? file.relPath.slice(slash + 1) : file.relPath;
  const isVideo = file.kind === "video";
  const isAudio = file.kind === "audio";
  const ActionIcon = isVideo || isAudio ? Play : ImageIcon;
  // Audio follows the list views' gesture split: "Play" starts the track in the
  // bottom bar without leaving Discover, and opening the card is the inspect
  // gesture, so its detail view must not start playback on its own.
  const detailTo = detailPath(file.id, wsId, filterParam, undefined, {
    autoplay: !isAudio,
  });
  const playInBar = () => activate(file);
  const showRail = isVideo && !!file.duration && file.duration > 0 && isActive;

  // Hover scrub preview on the main media (same behavior/preference as the
  // list thumbnails): pointer X maps onto the video timeline.
  const { hoverPreview, frameQuality } = usePreferences();
  const { previewSrc, scrubFraction, onMouseEnter, onMouseMove, onMouseLeave } =
    useHoverFramePreview({
      enabled: Boolean(hoverPreview && src && isVideo),
      frameUrl: (t) =>
        `${mediaBase}/ws/${wsId}/frame/${file.id}?t=${t}&q=${frameQuality}`,
      duration: file.duration,
      fileId: file.id,
    });

  return (
    // Black is the right ground behind a frame or a photo; with nothing to
    // show it only leaves a dark slab that the light-toned scrims fade into,
    // so a cover-less slide sits on the theme's surface instead.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden",
        src ? "bg-black" : "bg-surface",
      )}
    >
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
              onError={() => setFailedSrc(src)}
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
          // The fallback covers every kind; audio without cover art lands here
          // as a matter of course. A faint primary glow behind an album-sized
          // tile, in the theme's own tones, so the slide reads as "a track
          // with no artwork" rather than as a failed image.
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,color-mix(in_oklab,var(--c-primary)_14%,transparent),transparent_70%)] text-muted">
            <div className="flex size-64 items-center justify-center rounded-[20px] border border-bright-fg/10 bg-gradient-to-br from-overlay to-surface shadow-2xl shadow-black/15">
              {createElement(kindIcon(file.kind), {
                className: "size-28",
                strokeWidth: 1.5,
              })}
            </div>
          </div>
        )}
      </Link>

      {/* Gradient scrims for overlay legibility. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-bg/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-bg/90 via-bg/40 to-transparent" />

      {/* Center play affordance: opens the video, or plays the track in the
          bottom bar. Images have nothing to play. */}
      {isVideo && (
        <Link
          to={detailTo}
          aria-label={t("discover.play")}
          className={CENTER_PLAY_CLASS}
        >
          <Play className="size-7 translate-x-0.5 fill-current" />
        </Link>
      )}
      {isAudio && (
        <button
          type="button"
          onClick={playInBar}
          aria-label={t("discover.play")}
          className={CENTER_PLAY_CLASS}
        >
          <Play className="size-7 translate-x-0.5 fill-current" />
        </button>
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
              <FavoriteButton
                fileId={file.id}
                workspaceId={wsId}
                favorite={file.favorite}
                size={14}
              />
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
          {isAudio ? (
            <Button
              size="lg"
              className="px-7 font-bold shadow-lg"
              onClick={playInBar}
            >
              <ActionIcon className="fill-current" />
              {t("discover.play")}
            </Button>
          ) : (
            <Button asChild size="lg" className="px-7 font-bold shadow-lg">
              <Link to={detailTo}>
                <ActionIcon className={isVideo ? "fill-current" : undefined} />
                {isVideo ? t("discover.play") : t("discover.open")}
              </Link>
            </Button>
          )}
          {/* Styled to sit flush with the outline icon buttons around it; the
              control keeps its own primary hover/pressed colors. */}
          <WatchLaterButton
            ref={watchLaterRef}
            fileId={file.id}
            workspaceId={wsId}
            watchLater={watchLater}
            className="size-11 shrink-0 rounded-md border border-border/60 bg-bg/50 backdrop-blur-md hover:bg-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          />
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0 border-border/60 bg-bg/50 backdrop-blur-md"
            // Main-side this counts as a play and consumes the Watch Later
            // entry, so mirror that once it confirms (it can refuse for a file
            // that has gone missing under the root).
            onClick={() => {
              // Same courtesy the detail view extends: the external player is
              // about to play the very file the bar may be playing.
              if (
                audioCurrent?.file.id === file.id &&
                audioCurrent.workspaceId === wsId
              )
                pauseAudio();
              void api
                .openExternal(file.id, wsId)
                .then(() => dropFromWatchLaterCache(qc, wsId, file.id))
                .catch((e: unknown) => log.error("open external", e));
            }}
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
