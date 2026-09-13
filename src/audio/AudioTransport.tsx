// The playback controls shared by the bottom player bar and the audio detail
// view: play/pause, seek, time readout, mute and volume, plus the error row that
// replaces the seek control after a failure. Both surfaces drive the same
// provider, so this is one component with two hosts rather than two copies that
// would drift.
import { Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fmtTime } from "@/routes/MediaDetail/utils";
import { useAudioPlayer, useAudioPosition } from "./useAudioPlayer";

export const CTRL_CLASS =
  "flex shrink-0 items-center justify-center rounded-full p-1.5 text-muted transition hover:bg-fg/10 hover:text-fg";
// The stage variant sits on a dark gradient over the artwork, so it uses the
// video controls' white rather than the theme's text colours.
const STAGE_CTRL_CLASS =
  "flex shrink-0 items-center justify-center rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white";

interface Props {
  /** The track these controls stand for. Everything else — whether it is the
   *  one loaded in the provider, its position, duration and error — is derived
   *  from the player state in here, so both hosts only say *which* track. */
  target: { fileId: number; workspaceId: string };
  /** Length from the library, shown while the target is not loaded (the detail
   *  view before its track starts); the provider's duration takes over once it is. */
  fallbackDuration?: number | null;
  /** Play pressed while the target is not the loaded track: the host starts it.
   *  Omitted by the bar, whose target is the loaded track by construction. */
  onStart?: () => void;
  /** Larger play control for the detail view's stage. */
  size?: "bar" | "stage";
  /** Play control unavailable (e.g. the media origin is not known yet). */
  disabled?: boolean;
}

export function AudioTransport({
  target,
  fallbackDuration = null,
  onStart,
  size = "bar",
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const player = useAudioPlayer();
  // "Live" = the target is the loaded track: only then do the seek bar, the
  // readout and the error row describe it rather than some other track.
  const live =
    player.current?.file.id === target.fileId &&
    player.current.workspaceId === target.workspaceId;
  const isPlaying = live && player.isPlaying;
  const duration = live ? player.duration : fallbackDuration;
  const error = live ? player.error : null;
  const seekable = live && duration != null && duration > 0;
  const playLabel = isPlaying ? t("player.audio.pause") : t("player.play");
  const iconSize = size === "stage" ? 22 : 18;
  const ctrl = size === "stage" ? STAGE_CTRL_CLASS : CTRL_CLASS;
  const dim = size === "stage" ? "text-white/70" : "text-muted";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (live) player.toggle();
          else onStart?.();
        }}
        disabled={disabled}
        title={playLabel}
        aria-label={playLabel}
        className={
          size === "stage"
            ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            : ctrl
        }
      >
        {isPlaying ? (
          <Pause size={iconSize} />
        ) : (
          <Play size={iconSize} className="translate-x-px" />
        )}
      </button>

      {error ? (
        <div className="flex flex-1 items-center gap-2">
          <span className="truncate text-error">{t(error)}</span>
          <button
            type="button"
            onClick={player.dismissError}
            title={t("player.audio.dismissError")}
            aria-label={t("player.audio.dismissError")}
            className={ctrl}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <SeekBar
          live={live}
          seekable={seekable}
          duration={duration}
          onSeek={player.seek}
        />
      )}

      <TimeReadout live={live} duration={duration} className={dim} />

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={player.toggleMuted}
          title={player.muted ? t("player.unmute") : t("player.mute")}
          aria-label={player.muted ? t("player.unmute") : t("player.mute")}
          className={ctrl}
        >
          {player.muted || player.volume === 0 ? (
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
          value={player.muted ? 0 : player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          className={
            size === "stage"
              ? "ml-1 w-36 accent-primary"
              : "ml-1 w-28 accent-primary"
          }
          title={t("player.volume")}
          aria-label={t("player.volume")}
        />
      </div>
    </>
  );
}

/** Split out so the position tick re-renders only the seek input, not the host. */
function SeekBar({
  live,
  seekable,
  duration,
  onSeek,
}: {
  live: boolean;
  seekable: boolean;
  duration: number | null;
  onSeek: (sec: number) => void;
}) {
  const position = useAudioPosition();
  const { t } = useI18n();
  const max = duration ?? 0;
  const value = seekable && live ? Math.min(position, max) : 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step={0.1}
      value={value}
      disabled={!seekable}
      onChange={(e) => onSeek(Number(e.target.value))}
      // A native range input already is role="slider" with working arrow keys and
      // reports valuemin/valuemax/valuenow, so keyboard seeking needs no extra wiring.
      aria-label={t("player.seek")}
      aria-valuetext={
        seekable ? `${fmtTime(value)} / ${fmtTime(max)}` : undefined
      }
      className="min-w-24 flex-1 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      title={t("player.seek")}
    />
  );
}

function TimeReadout({
  live,
  duration,
  className,
}: {
  live: boolean;
  duration: number | null;
  className: string;
}) {
  const position = useAudioPosition();
  const { t } = useI18n();
  return (
    <span className={`shrink-0 tabular-nums ${className}`}>
      {fmtTime(live ? position : 0)}
      <span className="opacity-50"> / </span>
      {/* Never fabricate a total when the duration is indeterminate. */}
      {duration != null && duration > 0
        ? fmtTime(duration)
        : t("player.audio.unknownDuration")}
    </span>
  );
}
