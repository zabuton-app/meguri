import type { ReactNode } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";

// The player's only interactive surface. Deliberately minimal: no jump-to-detail,
// no scene rail, no favorite/rating/tag editing — those belong to the list and
// the detail view, not to unattended playback (spec FR-022).
export function PlayerChrome({
  title,
  position,
  total,
  playing,
  shuffle,
  repeat,
  fullscreen,
  canPrev,
  visible,
  volume,
  muted,
  audible,
  onVolumeChange,
  onToggleMute,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onToggleRepeat,
  onToggleFullscreen,
  onExit,
  t,
}: {
  title: string;
  position: number;
  total: number;
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  /** Whether the player currently owns the screen (it does not by default). */
  fullscreen: boolean;
  canPrev: boolean;
  /** False once the user has been idle; the chrome fades out of the way. */
  visible: boolean;
  /** Playback volume, 0..1. Kept as-is while muted. */
  volume: number;
  muted: boolean;
  /**
   * Whether the item on screen can make a sound (false for a still image). The
   * controls stay drawn and usable either way — dropping them would shift every
   * button beside them each time the queue reaches a picture, and the keyboard
   * can move the level during a picture too — so this only dims them to say
   * "nothing to hear right now".
   */
  audible: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  t: TFunc;
}) {
  return (
    <div
      data-slot="player-chrome"
      className={`absolute inset-0 z-20 transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="absolute right-3 top-3">
        <ChromeButton onClick={onExit} title={t("playlist.exit")}>
          <X size={20} />
        </ChromeButton>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5 pb-4">
        <h2
          className="truncate text-lg font-bold text-bright-fg drop-shadow-md"
          title={title}
        >
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <ChromeButton
            onClick={onPrev}
            disabled={!canPrev}
            title={t("playlist.prev")}
          >
            <SkipBack size={20} />
          </ChromeButton>
          <ChromeButton
            onClick={onTogglePlay}
            title={playing ? t("playlist.pause") : t("playlist.play")}
          >
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </ChromeButton>
          <ChromeButton onClick={onNext} title={t("playlist.next")}>
            <SkipForward size={20} />
          </ChromeButton>

          <span className="ml-2 text-sm tabular-nums text-bright-fg/80">
            {t("playlist.progress", { current: position, total })}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <div
              className={`mr-1 flex items-center gap-1 transition-opacity ${
                audible ? "" : "opacity-50"
              }`}
            >
              <ChromeButton
                onClick={onToggleMute}
                title={muted ? t("player.unmute") : t("player.mute")}
              >
                {muted || volume === 0 ? (
                  <VolumeX size={18} />
                ) : (
                  <Volume2 size={18} />
                )}
              </ChromeButton>
              {/* Always open, unlike the detail player's hover-to-expand slider:
                  from across the room the current level has to be readable
                  without hunting for it first. */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                title={t("player.volume")}
                aria-label={t("player.volume")}
                className="w-24 cursor-pointer accent-[var(--c-primary)]"
              />
            </div>
            <ChromeButton
              onClick={onToggleShuffle}
              active={shuffle}
              title={t("playlist.shuffle")}
            >
              <Shuffle size={18} />
            </ChromeButton>
            <ChromeButton
              onClick={onToggleRepeat}
              active={repeat}
              title={t("playlist.repeat")}
            >
              <Repeat size={18} />
            </ChromeButton>
            <ChromeButton
              onClick={onToggleFullscreen}
              title={
                fullscreen
                  ? t("playlist.exitFullscreen")
                  : t("playlist.fullscreen")
              }
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </ChromeButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChromeButton({
  onClick,
  title,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** Renders the toggle's on state (shuffle / repeat). */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex size-10 items-center justify-center rounded-full border border-border/60 backdrop-blur-md transition hover:bg-bg/70 disabled:opacity-40 ${
        active ? "bg-bg/80 text-[var(--c-primary)]" : "bg-bg/40 text-bright-fg"
      }`}
    >
      {children}
    </button>
  );
}
