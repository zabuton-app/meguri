import { createElement, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AudioLines, ExternalLink, ImageIcon, Pause, Play } from "lucide-react";
import { kindIcon } from "@/lib/mediaKind";
import { fileHref } from "@/lib/fileHref";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";
import { useAudioActions, useAudioPlayer } from "@/audio/useAudioPlayer";
import { AudioSpectrum } from "@/audio/AudioSpectrum";
import { useSpectrumPattern } from "@/audio/useSpectrumPattern";
import { PATTERN_LAYOUT } from "@/audio/spectrumPatterns";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useActivateFile } from "@/audio/useActivateFile";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";
import log from "@/lib/logger";
import {
  dropFromWatchLaterCache,
  invalidatePlayedSearches,
} from "@/lib/queryCache";
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
  const { pause: pauseAudio } = useAudioActions();
  const { activate } = useActivateFile();
  // Discover shows at most a handful of slides, so subscribing to the player
  // state here is fine (unlike the virtualized lists): the slide has to say
  // whether its own track is the one playing. Deliberately no transport here —
  // Discover stays a browsing surface; seeking and volume wait for the bar.
  const audio = useAudioPlayer();
  const wsId = file.workspaceId;
  const coverUrl = hasThumbFile(file)
    ? (thumbUrl(mediaBase, wsId, file.id, thumbVersion) ?? undefined)
    : undefined;
  // Same recovery as MediaThumbnail: a recorded thumbnail whose file has gone
  // missing 404s, and without a fallback the card would show broken artwork.
  // Keyed on the URL rather than a flag so a later version bump (or a different
  // file rendered by a reused card) gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = coverUrl && failedSrc !== coverUrl ? coverUrl : undefined;
  const slash = file.relPath.lastIndexOf("/");
  const basename = slash >= 0 ? file.relPath.slice(slash + 1) : file.relPath;
  const isVideo = file.kind === "video";
  const isAudio = file.kind === "audio";
  const ActionIcon = isVideo || isAudio ? Play : ImageIcon;
  // Audio follows the list views' gesture split: "Play" starts the track in the
  // bottom bar without leaving Discover, and opening the card is the inspect
  // gesture, so its detail view must not start playback on its own.
  const detailTo = fileHref(file.id, wsId, {
    from: "discover",
    filter: filterParam,
    autoplay: !isAudio,
  });
  const playInBar = () => activate(file);
  const isCurrentAudio =
    isAudio &&
    audio.current?.file.id === file.id &&
    audio.current.workspaceId === wsId;
  const audioPlaying = isCurrentAudio && audio.isPlaying;
  const audioLabel = audioPlaying
    ? t("player.audio.pause")
    : t("discover.play");
  const showRail = isVideo && !!file.duration && file.duration > 0 && isActive;

  // The audio spectrum over the slide's artwork, with the same on/off toggle
  // the detail stage and the playlist carry (one preference for all of them;
  // inert under the OS reduce-motion setting, which overrides it).
  const spectrumPattern = useSpectrumPattern();
  const spectrumLayout = spectrumPattern
    ? PATTERN_LAYOUT[spectrumPattern]
    : null;
  const { audioSpectrum, setAudioSpectrum } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  const spectrumLabel = audioSpectrum
    ? t("player.audio.spectrumHide")
    : t("player.audio.spectrumShow");

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

      {isAudio && spectrumLayout && (
        <AudioSpectrum
          active={audioPlaying}
          mode={src ? "overlay" : "full"}
          className={src ? spectrumLayout.overlayBox : "absolute inset-0"}
        />
      )}

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
          aria-label={audioLabel}
          aria-pressed={audioPlaying}
          className={CENTER_PLAY_CLASS}
        >
          {audioPlaying ? (
            <Pause className="size-7 fill-current" />
          ) : (
            <Play className="size-7 translate-x-0.5 fill-current" />
          )}
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
              aria-pressed={audioPlaying}
            >
              {audioPlaying ? (
                <Pause className="fill-current" />
              ) : (
                <ActionIcon className="fill-current" />
              )}
              {audioLabel}
            </Button>
          ) : (
            <Button asChild size="lg" className="px-7 font-bold shadow-lg">
              <Link to={detailTo}>
                <ActionIcon className={isVideo ? "fill-current" : undefined} />
                {isVideo ? t("discover.play") : t("discover.open")}
              </Link>
            </Button>
          )}
          {isAudio && (
            <Button
              variant="outline"
              size="icon"
              className={cn(
                "size-11 shrink-0 border-border/60 bg-bg/50 backdrop-blur-md",
                audioSpectrum && "text-primary",
              )}
              onClick={() => setAudioSpectrum(!audioSpectrum)}
              disabled={reducedMotion}
              aria-pressed={audioSpectrum}
              title={
                reducedMotion
                  ? t("player.audio.spectrumReducedMotion")
                  : spectrumLabel
              }
              aria-label={spectrumLabel}
            >
              <AudioLines />
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
              // Same courtesy the detail view extends: an external player about
              // to play audio must not sound over whatever the bar is playing.
              if (isAudio) pauseAudio();
              void api
                .openExternal(file.id, wsId)
                .then(() => {
                  dropFromWatchLaterCache(qc, wsId, file.id);
                  // It is a play, so everything listing plays refreshes too.
                  invalidatePlayedSearches(qc);
                })
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
