import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import {
  AudioActionsContext,
  AudioPlayerContext,
  AudioPositionContext,
  type AudioActions,
  type AudioPlayerState,
} from "./context";

export function useAudioPlayer(): AudioPlayerState {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx)
    throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}

/** The player's actions only (stable identity, never re-renders the caller).
 *  Use this from anything rendered per list item; useAudioPlayer() there would
 *  re-render every visible item on each play/pause/volume change. */
export function useAudioActions(): AudioActions {
  const ctx = useContext(AudioActionsContext);
  if (!ctx)
    throw new Error("useAudioActions must be used within AudioPlayerProvider");
  return ctx;
}

/** Current playback position in seconds. Updates on every timeupdate, so only the
 *  seek bar and the elapsed-time readout may consume it — any other consumer
 *  re-renders at tick frequency. */
export function useAudioPosition(): number {
  const pos = useContext(AudioPositionContext);
  if (pos === null)
    throw new Error("useAudioPosition must be used within AudioPlayerProvider");
  return pos;
}

/**
 * Only one thing sounds at a time. A video player (the detail view's, the
 * playlist's) registers how it can be paused and gets back `claim`, which it
 * calls when it starts: the bar's audio is paused then, and whenever the bar's
 * audio starts, the registered pauser runs. Both directions of the exclusivity
 * live here rather than in each host, so a new sound source only has to
 * register once.
 *
 * `pause` is read through a ref, so callers may pass a fresh closure each render.
 */
export function useExclusivePlayback(pause: () => void): {
  /** Call when this source starts playing: pauses the bar. */
  claim: () => void;
} {
  const { registerPeer, pause: pauseAudio } = useAudioActions();
  const pauseRef = useRef(pause);
  useLayoutEffect(() => {
    pauseRef.current = pause;
  });
  useEffect(() => registerPeer(() => pauseRef.current()), [registerPeer]);
  return { claim: pauseAudio };
}
