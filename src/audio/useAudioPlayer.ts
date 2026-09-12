import { useContext } from "react";
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
