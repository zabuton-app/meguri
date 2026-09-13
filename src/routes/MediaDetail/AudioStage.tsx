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
    <div className="flex flex-col overflow-hidden rounded-xl bg-black">
      <button
        type="button"
        disabled={disabled}
        onClick={start}
        title={label}
        aria-label={label}
        className="group relative flex w-full items-center justify-center py-8"
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={file.relPath}
            className="max-h-[50vh] max-w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex size-48 items-center justify-center rounded-lg bg-overlay text-muted">
            <Music className="size-24" aria-hidden />
          </div>
        )}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity",
            playing && "opacity-0 group-hover:opacity-100",
          )}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70">
            {playing ? (
              <Pause size={30} />
            ) : (
              <Play size={30} className="translate-x-0.5" />
            )}
          </span>
        </span>
      </button>
      <div
        role="region"
        aria-label={t("player.audio.region")}
        className="flex items-center gap-3 px-4 pb-4 text-sm text-fg"
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
