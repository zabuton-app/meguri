import { useEffect, useRef } from "react";
import { useAudioActions, useAudioPlayer } from "@/audio/useAudioPlayer";
import type { FileDetail } from "@/ipc/types";
import { queueKey, type QueueItem } from "@/lib/playbackQueue";

/**
 * Audio items in the playlist.
 *
 * They play through the bottom bar's element rather than a <video> of the
 * player's own: that element lives outside the router, so stepping out to the
 * detail view (a sibling route that unmounts the player) and back never
 * interrupts the sound — the same reason Discover's playback survives the
 * trip. The bar itself stays hidden under the full-screen player.
 *
 * This hook starts the bar on the current audio item, advances the queue when
 * the track ends (including a track that ran out during a detour), and skips
 * a track the bar could not play.
 */
export function usePlaylistAudio({
  current,
  file,
  mediaBase,
  isDetourPickUp,
  resumeSec,
  goNext,
  skipCurrent,
}: {
  current: QueueItem | null;
  file: FileDetail | null;
  mediaBase: string;
  /** Back from the detail view on the very item the pass was parked on. */
  isDetourPickUp: boolean;
  resumeSec: number;
  goNext: () => void;
  skipCurrent: () => void;
}): {
  /** The current item is audio and is the track in the bar. */
  isCurrentAudio: boolean;
  audioPlaying: boolean;
  toggleAudio: () => void;
} {
  const audio = useAudioPlayer();
  const {
    play: playAudio,
    toggle: toggleAudio,
    subscribeEnded,
  } = useAudioActions();
  const isAudio = current?.kind === "audio";
  const currentKey = current ? queueKey(current) : "";
  const isCurrentAudio =
    isAudio &&
    !!current &&
    audio.current?.file.id === current.fileId &&
    audio.current.workspaceId === current.workspaceId;
  const audioPlaying = isCurrentAudio && audio.isPlaying;

  // Read by the audio `ended` subscription, which is set up once.
  const goNextRef = useRef(goNext);
  useEffect(() => {
    goNextRef.current = goNext;
  }, [goNext]);
  // Start the audio item in the bar once its row is known (play() needs the
  // row; the detail is fetched anyway). Guarded per visit of an item so a
  // refetch cannot restart it; the guard is dropped when the track ends so a
  // one-item queue on repeat plays it again. A track already in the bar is
  // resumed (or left alone if it is playing — coming back from the detail
  // view, or opening the playlist on the track Discover started).
  const startedAudioFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isAudio) {
      startedAudioFor.current = null;
      return;
    }
    if (!current || !file || !mediaBase) return;
    if (startedAudioFor.current === currentKey) return;
    startedAudioFor.current = currentKey;
    if (isCurrentAudio) {
      if (isDetourPickUp) return;
      if (!audioPlaying) toggleAudio();
      return;
    }
    playAudio(
      { ...file, workspaceId: current.workspaceId },
      current.workspaceId,
      { startAt: resumeSec },
    );
  }, [
    isAudio,
    current,
    currentKey,
    file,
    mediaBase,
    isCurrentAudio,
    isDetourPickUp,
    audioPlaying,
    playAudio,
    toggleAudio,
    resumeSec,
  ]);
  // `ended` advances the queue, the way the video's does.
  const currentKeyForEnded = useRef(currentKey);
  const detourEndedHandledFor = useRef<string | null>(null);
  useEffect(() => {
    currentKeyForEnded.current = currentKey;
    detourEndedHandledFor.current = null;
  }, [currentKey]);
  useEffect(
    () =>
      subscribeEnded((track) => {
        const key = queueKey({
          fileId: track.file.id,
          workspaceId: track.workspaceId,
        });
        if (key !== currentKeyForEnded.current) return;
        startedAudioFor.current = null;
        goNextRef.current();
      }),
    [subscribeEnded],
  );
  // While the detail route is open the player is unmounted, so it misses the
  // provider's `ended`; the provider keeps the fact as state, so a track that
  // ran out during the detour advances the queue on return rather than being
  // restored and restarted.
  useEffect(() => {
    if (!isCurrentAudio || !isDetourPickUp || !audio.ended) return;
    if (detourEndedHandledFor.current === currentKey) return;
    detourEndedHandledFor.current = currentKey;
    startedAudioFor.current = null;
    goNextRef.current();
  }, [isCurrentAudio, isDetourPickUp, audio.ended, currentKey]);
  // An audio item that fails to play is skipped like a broken video.
  useEffect(() => {
    if (isCurrentAudio && audio.error) skipCurrent();
  }, [isCurrentAudio, audio.error, skipCurrent]);

  return { isCurrentAudio, audioPlaying, toggleAudio };
}
