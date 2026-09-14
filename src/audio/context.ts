// Contexts live apart from the provider component so the provider file exports
// only components (fast refresh requirement).
import { createContext } from "react";
import type { FileRow } from "@/ipc/types";
import type { TranslationKey } from "@/i18n/locales/ja";

export interface AudioTrack {
  file: FileRow;
  workspaceId: string;
}

export interface PlayOpts {
  /** Start this many seconds in rather than from the top (a playlist handing
   *  the track it was playing over to the bar). */
  startAt?: number;
}

export interface AudioPlayerState {
  /** The loaded track, or null when nothing is loaded (bar hidden). */
  current: AudioTrack | null;
  isPlaying: boolean;
  /** True from the track playing to its end until it is started, sought or
   *  replaced. Lets a consumer that was not mounted for the `ended` event (the
   *  playlist during a detail detour) find out afterwards. */
  ended: boolean;
  /** Track length in seconds; null when indeterminate. */
  duration: number | null;
  volume: number;
  muted: boolean;
  /** i18n key of the playback failure message; null when healthy. */
  error: TranslationKey | null;

  // Declared as properties rather than methods: every one is an arrow function
  // from useCallback, so they carry no `this` and are safe to destructure.
  play: (file: FileRow, workspaceId: string, opts?: PlayOpts) => void;
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

/**
 * The provider's actions alone, with a reference that never changes for the
 * provider's lifetime. Anything that only needs to *do* something to the player
 * (the list views' activation handlers, Discover's Play) subscribes to this and
 * not to AudioPlayerContext, whose value changes on every play/pause, track
 * switch and volume step — a context change punches through `memo`, so a
 * subscriber inside a virtualized card would re-render every visible card on
 * each of those.
 */
export interface AudioActions {
  play: (file: FileRow, workspaceId: string, opts?: PlayOpts) => void;
  /** Play the file, or toggle it if it is the track already loaded. */
  playOrToggle: (file: FileRow, workspaceId: string) => void;
  /** Whether the given file is the track loaded in the bar (playing or paused).
   *  Reads a ref, so it is for event handlers only: nothing re-renders when
   *  the track changes. To render on the loaded track, read `current` from
   *  AudioPlayerContext instead. */
  isCurrent: (fileId: number, workspaceId: string) => boolean;
  /** Pause only if the given file is the loaded track (e.g. before opening it externally). */
  pauseIfCurrent: (fileId: number, workspaceId: string) => void;
  toggle: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMuted: () => void;
  close: () => void;
  dismissError: () => void;
  /** Called with the track when it plays to its end (the playlist advances
   *  on it). Returns the unsubscribe function. */
  subscribeEnded: (listener: (track: AudioTrack) => void) => () => void;
  /** Register another sound source (see useExclusivePlayback). The listener is
   *  called whenever bar audio starts; returns the unregister function. */
  registerPeer: (onAudioStart: () => void) => () => void;
  /** The analyser tapping the bar's element, for the spectrum display. The
   *  first call routes the element through a Web Audio graph for good (see
   *  analyser.ts); later calls return the same node. Null where Web Audio
   *  is unavailable. */
  ensureAnalyser: () => AnalyserNode | null;
}

export const AudioActionsContext = createContext<AudioActions | null>(null);

// Split from AudioPlayerContext deliberately: position ticks several times a
// second and the virtualized grid subscribes to context, so a combined value
// would re-render every visible thumbnail on every tick. Only the seek bar and
// the elapsed-time readout may consume this.
export const AudioPositionContext = createContext<number | null>(null);
