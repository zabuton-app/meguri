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
