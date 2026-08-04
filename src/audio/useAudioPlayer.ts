import { useContext } from "react";
import {
  AudioPlayerContext,
  AudioPositionContext,
  type AudioPlayerState,
} from "./context";

export function useAudioPlayer(): AudioPlayerState {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx)
    throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
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
