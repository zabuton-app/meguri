// Contexts live apart from the provider component so the provider file exports
// only components (fast refresh requirement).
import { createContext } from "react";
import type { FileRow } from "@/ipc/types";
import type { TranslationKey } from "@/i18n/locales/ja";

export interface AudioTrack {
  file: FileRow;
  workspaceId: string;
}

export interface AudioPlayerState {
  /** The loaded track, or null when nothing is loaded (bar hidden). */
  current: AudioTrack | null;
  isPlaying: boolean;
  /** Track length in seconds; null when indeterminate. */
  duration: number | null;
  volume: number;
  muted: boolean;
  /** i18n key of the playback failure message; null when healthy. */
  error: TranslationKey | null;

  // Declared as properties rather than methods: every one is an arrow function
  // from useCallback, so they carry no `this` and are safe to destructure.
  play: (file: FileRow, workspaceId: string) => void;
  toggle: () => void;
  /** Pause without unloading. Used for video exclusivity. */
  pause: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMuted: () => void;
  /** Stop playback, unload the track, hide the bar. */
  close: () => void;
  /** Clear the error message without unloading the track. */
  dismissError: () => void;
}

export const AudioPlayerContext = createContext<AudioPlayerState | null>(null);

// Split from AudioPlayerContext deliberately: position ticks several times a
// second and the virtualized grid subscribes to context, so a combined value
// would re-render every visible thumbnail on every tick. Only the seek bar and
// the elapsed-time readout may consume this.
export const AudioPositionContext = createContext<number | null>(null);
