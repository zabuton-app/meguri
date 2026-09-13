// What the detail view does for an audio file beyond showing its stage: it
// hides the bottom bar for as long as it is open as a modal (whatever the kind), starts
// the track on arrival unless told not to, and keeps the bar's audio and the
// video player from sounding at once. Kept apart from index.tsx the way
// VideoPlayer is, so the route stays about layout, queries and mutations.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { FileDetail } from "@/ipc/types";
import { useAudioPlayer, useExclusivePlayback } from "@/audio/useAudioPlayer";
import { holdBarSuppressed } from "@/audio/barVisibility";

interface Options {
  /** The file on screen; undefined while it loads. */
  file: FileDetail | undefined;
  /** Its owning workspace (from `?ws=`); "" while unresolved. */
  wsId: string;
  /** Media server origin; "" until app_status resolves. */
  mediaBase: string;
  /** False when the route was opened with `?autoplay=0` (the inspect gesture). */
  autoplay: boolean;
  /** `?t=`: where to begin, in seconds (the playlist handing over the track it
   *  was playing). 0 when absent. */
  startAt: number;
  /** Pause the video player, if one is mounted (a no-op otherwise). */
  pauseVideo: () => void;
  /** False when the view is docked as a side peek: the bar sits below the
   *  list area, clear of the sheet, and is the audio transport there. Defaults
   *  to true (the modal). */
  suppressBar?: boolean;
}

export function useAudioDetail({
  file,
  wsId,
  mediaBase,
  autoplay,
  startAt,
  pauseVideo,
  suppressBar = true,
}: Options) {
  const { current, isPlaying, play, close } = useAudioPlayer();
  const isAudio = file?.kind === "audio";
  const isCurrentAudio =
    isAudio && current?.file.id === file.id && current.workspaceId === wsId;

  // The bottom bar steps aside for as long as this view is open, whatever the
  // kind: for audio the same transport lives under the cover art, and for a
  // video or image the bar would sit over the modal while the track it shows is
  // paused anyway (starting the video pauses it). Playback is untouched; the
  // bar returns on close.
  // Layout effect so the bar is gone in the very frame this view first paints
  // (and back in the frame it leaves) — otherwise the bar and the FABs above
  // it visibly jump one frame later.
  // Not while docked as a side peek: the sheet ends above the bar, and for an
  // audio track the bar is the only transport on screen.
  useLayoutEffect(() => {
    if (!suppressBar) return;
    return holdBarSuppressed();
  }, [suppressBar]);

  // Video demands attention, background audio yields — and the other way
  // round, audio starting while a video is on screen pauses the video. The
  // provider runs `pauseVideo` on every audio start; `claim` is for the video
  // player's onPlaybackStart.
  const { claim } = useExclusivePlayback(pauseVideo);

  // Audio opens this view like any other kind (it is where tags, rating and
  // bookmarks live) but plays through the persistent bottom bar rather than an
  // inline element, so the track survives closing the modal. Auto-start mirrors
  // the video player's `autoplay` handling: a thumbnail click starts playback,
  // a name click (`?autoplay=0`) opens the details silently.
  // Guarded per visit of a track, not just by `file`: react-query can hand back
  // a fresh object for the same row, and re-running play() would restart the
  // track the user is already listening to. The key carries the workspace
  // because file ids only mean something within one (the All view puts several
  // side by side), and it is cleared whenever a non-audio file is shown so
  // "A → video → A" starts A again.
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!file) return;
    if (file.kind !== "audio") {
      autoStartedFor.current = null;
      return;
    }
    if (!autoplay) return;
    // `file_get` does not inject workspaceId into its row, so file.workspaceId
    // is undefined here — use the id resolved from the URL. Also wait for the
    // media base: on a direct URL the detail query can resolve before
    // app_status, and playing then would build a src against an empty origin.
    if (!wsId || !mediaBase) return;
    const visitKey = `${wsId}:${file.id}`;
    if (autoStartedFor.current === visitKey) return;
    autoStartedFor.current = visitKey;
    const loaded = current?.file.id === file.id && current.workspaceId === wsId;
    // Already playing in the bar (reopened from the list mid-track): leave it
    // alone rather than restarting from zero. Loaded but paused — in practice
    // prev/next back to the track after a video interrupted it — starts over,
    // like arriving at any other item, rather than resuming mid-track.
    if (loaded && isPlaying) return;
    play({ ...file, workspaceId: wsId }, wsId, { startAt });
  }, [file, wsId, mediaBase, autoplay, startAt, current, isPlaying, play]);

  /** For "delete from index": the bar outlives this modal, so a track that was
   *  playing would keep going (and 404 on the next seek) after its row is gone. */
  const closeIfCurrent = useCallback(() => {
    if (isCurrentAudio) close();
  }, [isCurrentAudio, close]);

  return { isAudio, claimPlayback: claim, closeIfCurrent };
}
