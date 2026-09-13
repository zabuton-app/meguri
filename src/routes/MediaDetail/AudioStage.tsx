// The audio counterpart of VideoPlayer: the artwork is the click target with
// the paused-state play glyph in its centre, and the transport (the bottom
// bar's controls, which steps aside while the detail view is open) runs along
// the bottom edge. Playback itself happens in the provider's single element,
// so this only drives it.
import { Music, Pause, Play } from "lucide-react";
import type { FileDetail } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { useAudioActions, useAudioPlayer } from "@/audio/useAudioPlayer";
import { AudioTransport } from "@/audio/AudioTransport";

interface Props {
  file: FileDetail;
  wsId: string;
  mediaBase: string;
  /** Embedded cover art URL, or null when the file has none. */
  coverSrc: string | null;
}

export function AudioStage({ file, wsId, mediaBase, coverSrc }: Props) {
  const { t } = useI18n();
  const { current, isPlaying } = useAudioPlayer();
  const { playOrToggle } = useAudioActions();
  const isCurrent =
    current?.file.id === file.id && current.workspaceId === wsId;
  const playing = isCurrent && isPlaying;
  // Before app_status resolves there is no media origin to build the track
  // URL from, so starting has to wait; toggling a loaded track needs none.
  const canStart = Boolean(mediaBase && wsId);
  const disabled = !isCurrent && !canStart;
  // `file_get` does not inject workspaceId into its row, so add the one
  // resolved from the URL (the same track key the list views use).
  const start = () => playOrToggle({ ...file, workspaceId: wsId }, wsId);
  const label = playing ? t("player.audio.pause") : t("player.play");

  return (
    // Same anatomy as the video player: the artwork is the stage, and the
    // transport is laid over its bottom edge on a gradient, shown while paused
    // and on hover, out of the way while the track plays.
    <div className="group relative flex aspect-video max-h-[78vh] w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      {coverSrc ? (
        <img
          // Scaled up until its width or its height fits the stage (a square
          // jacket is pillarboxed, a wide one letterboxed) rather than shown
          // at whatever size it was embedded at.
          src={coverSrc}
          alt={file.relPath}
          className="h-full w-full object-contain"
        />
      ) : (
        // No embedded art: the placeholder takes the whole stage too, so a
        // cover-less track does not shrink to a tile in a black field.
        <div className="flex h-full w-full items-center justify-center bg-overlay text-muted">
          <Music className="size-1/3" strokeWidth={1.5} aria-hidden />
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={start}
        title={label}
        aria-label={label}
        className="absolute inset-0 flex items-center justify-center"
      >
        <span
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70",
            playing && "opacity-0 group-hover:opacity-100",
          )}
        >
          {playing ? (
            <Pause size={30} />
          ) : (
            <Play size={30} className="translate-x-0.5" />
          )}
        </span>
      </button>
      <div
        role="region"
        aria-label={t("player.audio.region")}
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-3 pt-8 text-sm text-white transition-opacity",
          playing &&
            "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <AudioTransport
          size="stage"
          target={{ fileId: file.id, workspaceId: wsId }}
          fallbackDuration={file.duration}
          disabled={disabled}
          onStart={start}
        />
      </div>
    </div>
  );
}
