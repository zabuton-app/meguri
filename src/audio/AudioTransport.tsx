// The playback controls shared by the bottom player bar and the audio detail
// view: play/pause, seek, time readout, mute and volume, plus the error row that
// replaces the seek control after a failure. Both surfaces drive the same
// provider, so this is one component with two hosts rather than two copies that
// would drift.
import { Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import type { TranslationKey } from "@/i18n/locales/ja";
import { useI18n } from "@/i18n/I18nProvider";
import { fmtTime } from "@/routes/MediaDetail/utils";
import { useAudioPosition } from "./useAudioPlayer";

export const CTRL_CLASS =
  "flex shrink-0 items-center justify-center rounded-full p-1.5 text-muted transition hover:bg-fg/10 hover:text-fg";

interface Props {
  /** False when the controls describe a track that is not the one loaded in the
   *  provider (the detail view before its track starts): the seek bar and the
   *  readout then show the start rather than another track's position. */
  live: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  /** Track length in seconds; null while unknown. */
  duration: number | null;
  onSeek: (sec: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMuted: () => void;
  error?: TranslationKey | null;
  onDismissError?: () => void;
  /** Larger play control for the detail view's stage. */
  size?: "bar" | "stage";
}

export function AudioTransport({
  live,
  isPlaying,
  onTogglePlay,
  duration,
  onSeek,
  volume,
  muted,
  onVolume,
  onToggleMuted,
  error = null,
  onDismissError,
  size = "bar",
}: Props) {
  const { t } = useI18n();
  const seekable = live && duration != null && duration > 0;
  const playLabel = isPlaying ? t("player.audio.pause") : t("player.play");
  const iconSize = size === "stage" ? 22 : 18;

  return (
    <>
      <button
        type="button"
        onClick={onTogglePlay}
        title={playLabel}
        aria-label={playLabel}
        className={
          size === "stage"
            ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90"
            : CTRL_CLASS
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
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              title={t("player.audio.dismissError")}
              aria-label={t("player.audio.dismissError")}
              className={CTRL_CLASS}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <SeekBar
          live={live}
          seekable={seekable}
          duration={duration}
          onSeek={onSeek}
        />
      )}

      <TimeReadout live={live} duration={duration} />

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onToggleMuted}
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
          onChange={(e) => onVolume(Number(e.target.value))}
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
}: {
  live: boolean;
  duration: number | null;
}) {
  const position = useAudioPosition();
  const { t } = useI18n();
  return (
    <span className="shrink-0 tabular-nums text-muted">
      {fmtTime(live ? position : 0)}
      <span className="opacity-50"> / </span>
      {/* Never fabricate a total when the duration is indeterminate. */}
      {duration != null && duration > 0
        ? fmtTime(duration)
        : t("player.audio.unknownDuration")}
    </span>
  );
}
