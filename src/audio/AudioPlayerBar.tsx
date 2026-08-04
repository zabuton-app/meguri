// Persistent bottom player bar for audio playback.
//
// Participates in layout below the routed content rather than floating over it, so it
// never occludes the last row of the list, and occupies zero height when no track is
// loaded. Only the seek bar and the time readout consume useAudioPosition(), so the
// per-tick re-render stays confined to those two small components.
import { useLayoutEffect, useState } from "react";
import { Music, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { fmtTime } from "@/routes/MediaDetail/utils";
import type { AudioTrack } from "./context";
import { useAudioPlayer, useAudioPosition } from "./useAudioPlayer";

function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

// Published so bottom-anchored overlays (the Discovery FAB, the scan-progress
// panel) can lift themselves clear of the bar. It stays 0px whenever no track is
// loaded, so those overlays keep their original position in that case.
const BAR_HEIGHT_VAR = "--meguri-player-bar-h";

/** Mirrors the bar's measured height into a CSS variable on <html>.
 *
 *  Assumes a single mounted bar (App.tsx mounts exactly one). With two, the
 *  first to unmount would reset the variable while the other is still showing.
 *  Runs as a layout effect so the offset is in place before the browser paints
 *  the frame the bar appears in — otherwise the FAB overlaps it for one frame. */
function usePublishBarHeight(el: HTMLDivElement | null): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty(BAR_HEIGHT_VAR, "0px");
      return;
    }
    const publish = () =>
      root.style.setProperty(
        BAR_HEIGHT_VAR,
        `${el.getBoundingClientRect().height}px`,
      );
    publish();
    // The bar's height changes with the content zoom and with the error row
    // replacing the seek control, so measure rather than hardcode.
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty(BAR_HEIGHT_VAR, "0px");
    };
  }, [el]);
}

const CTRL_CLASS =
  "flex shrink-0 items-center justify-center rounded-full p-1.5 text-muted transition hover:bg-fg/10 hover:text-fg";

export function AudioPlayerBar() {
  const {
    current,
    isPlaying,
    duration,
    volume,
    muted,
    error,
    toggle,
    seek,
    setVolume,
    toggleMuted,
    close,
    dismissError,
  } = useAudioPlayer();
  const { t } = useI18n();
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  usePublishBarHeight(barEl);

  // Occupies no space at all when nothing is loaded.
  if (!current) return null;

  const name = baseName(current.file.relPath);
  const seekable = duration != null && duration > 0;
  const playLabel = isPlaying ? t("player.audio.pause") : t("player.play");

  return (
    <div
      ref={setBarEl}
      role="region"
      aria-label={t("player.audio.region")}
      className="flex shrink-0 items-center gap-3 border-t border-border bg-bg px-3 py-2 text-sm text-fg"
    >
      {/* Keyed on the track so a failed cover doesn't stick: remounting resets
          the fallback state, and the previous jacket never shows while the new
          one loads. */}
      <Cover
        key={`${current.workspaceId}:${current.file.id}`}
        track={current}
      />
      {/* Announced when the track changes; position updates are never announced. */}
      <span
        className="min-w-0 max-w-64 flex-1 truncate"
        title={name}
        aria-live="polite"
      >
        {name}
      </span>

      <button
        type="button"
        onClick={toggle}
        title={playLabel}
        aria-label={playLabel}
        className={CTRL_CLASS}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      {error ? (
        <div className="flex flex-1 items-center gap-2">
          <span className="truncate text-error">{t(error)}</span>
          <button
            type="button"
            onClick={dismissError}
            title={t("player.audio.dismissError")}
            aria-label={t("player.audio.dismissError")}
            className={CTRL_CLASS}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <SeekBar seekable={seekable} duration={duration} onSeek={seek} />
      )}

      <TimeReadout duration={duration} />

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={toggleMuted}
          title={muted ? t("player.unmute") : t("player.mute")}
          aria-label={muted ? t("player.unmute") : t("player.mute")}
          className={CTRL_CLASS}
        >
          {muted || volume === 0 ? (
            <VolumeX size={18} />
          ) : (
            <Volume2 size={18} />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="ml-1 w-16 accent-primary"
          title={t("player.volume")}
          aria-label={t("player.volume")}
        />
      </div>

      <button
        type="button"
        onClick={close}
        title={t("player.audio.close")}
        aria-label={t("player.audio.close")}
        className={CTRL_CLASS}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/** The track's embedded cover art, falling back to a music note when the file has
 *  none (or the image fails to load). Square and bar-height, so a taller jacket
 *  cannot grow the bar and shift every bottom-anchored overlay with it.
 *
 *  Decorative: the filename beside it already identifies the track, so an alt text
 *  here would only make screen readers announce the same name twice. */
function Cover({ track }: { track: AudioTrack }) {
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const [failed, setFailed] = useState(false);
  const src =
    track.file.hasThumb === 1 && mediaBase
      ? `${mediaBase}/ws/${track.workspaceId}/thumb/${track.file.id}`
      : null;

  if (!src || failed) {
    return (
      <Music size={18} className="shrink-0 text-muted" aria-hidden="true" />
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-sm object-cover"
    />
  );
}

/** Split out so the position tick re-renders only the seek input, not the whole bar. */
function SeekBar({
  seekable,
  duration,
  onSeek,
}: {
  seekable: boolean;
  duration: number | null;
  onSeek: (sec: number) => void;
}) {
  const position = useAudioPosition();
  const { t } = useI18n();
  const max = duration ?? 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step={0.1}
      value={seekable ? Math.min(position, max) : 0}
      disabled={!seekable}
      onChange={(e) => onSeek(Number(e.target.value))}
      // A native range input already is role="slider" with working arrow keys and
      // reports valuemin/valuemax/valuenow, so keyboard seeking needs no extra wiring.
      aria-label={t("player.seek")}
      aria-valuetext={
        seekable ? `${fmtTime(position)} / ${fmtTime(max)}` : undefined
      }
      className="min-w-24 flex-1 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      title={t("player.seek")}
    />
  );
}

function TimeReadout({ duration }: { duration: number | null }) {
  const position = useAudioPosition();
  const { t } = useI18n();
  return (
    <span className="shrink-0 tabular-nums text-muted">
      {fmtTime(position)}
      <span className="opacity-50"> / </span>
      {/* Never fabricate a total when the duration is indeterminate. */}
      {duration != null && duration > 0
        ? fmtTime(duration)
        : t("player.audio.unknownDuration")}
    </span>
  );
}
