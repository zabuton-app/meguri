// Single-track audio playback backed by one <audio> element.
//
// Mounted outside RouterProvider (see App.tsx) so navigation never unmounts it and
// playback continues across route changes. One element also makes overlapping audio
// unrepresentable: a second play() necessarily replaces the first track.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import type { TranslationKey } from "@/i18n/locales/ja";
import log from "@/lib/logger";
import {
  dropFromWatchLaterCache,
  invalidatePlayedSearches,
} from "@/lib/queryCache";
import {
  setVolume as setSharedVolume,
  toggleMuted as toggleSharedMuted,
  useVolume,
} from "@/hooks/useVolume";
import { useAppStatus } from "@/hooks/useAppStatus";
import {
  AudioActionsContext,
  AudioPlayerContext,
  AudioPositionContext,
  type AudioActions,
  type AudioPlayerState,
  type AudioTrack,
} from "./context";

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  // One volume for every player surface: the detail view, the playlist player
  // and this bar all read and write the same store (hooks/useVolume.ts), so a
  // level set in one place holds for the others within the session, not just
  // after a restart.
  const { volume, muted } = useVolume();
  const [error, setError] = useState<TranslationKey | null>(null);

  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const qc = useQueryClient();

  // Live copies for the actions below, which must keep one identity for the
  // provider's lifetime (see AudioActionsContext) and so cannot close over the
  // state they were created with.
  const currentRef = useRef<AudioTrack | null>(null);
  const durationRef = useRef<number | null>(null);
  const mediaBaseRef = useRef("");
  // Synced before paint, so a click handled in the same frame sees the state
  // that produced what is on screen (the rules-of-hooks lint forbids writing
  // a ref during render itself).
  useLayoutEffect(() => {
    currentRef.current = current;
    durationRef.current = duration;
    mediaBaseRef.current = mediaBase;
  }, [current, duration, mediaBase]);

  // Whether the element is sitting on a failed resource. Tracked apart from the
  // displayed `error` because dismissing the message must not also discard the
  // knowledge that a retry has to reload the source first.
  const needsReload = useRef(false);

  const ensureEl = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  // Bumped by every play()/pause()/close(). play() returns a promise that can
  // reject long after a newer track replaced the source (an interrupted load
  // rejects with AbortError), so a late rejection must not attach its error to
  // whatever is playing now. pause() bumps it too: pausing while play() is
  // still pending rejects that promise with AbortError, and an intentional stop
  // is not a playback failure.
  const requestId = useRef(0);

  // The track whose first `playing` event still has to be written to the play
  // history. Set by play(), consumed once playback is actually under way, so a
  // rejected autoplay, an unsupported codec or a file that has gone missing
  // never counts as a play. (The video player records from its element the same
  // way.) Replaced wholesale by the next play(), dropped by close().
  const pendingRecord = useRef<AudioTrack | null>(null);

  // Other sound sources (see useExclusivePlayback): each is paused when audio
  // starts here. A Set, not state — registration must not re-render anything.
  const peers = useRef(new Set<() => void>());

  /** Pause and disown any play() still in flight (see requestId). */
  const pauseEl = useCallback((el: HTMLAudioElement) => {
    requestId.current++;
    el.pause();
  }, []);

  /** Start the element and report failure only if the request is still current. */
  const startPlayback = useCallback((el: HTMLAudioElement) => {
    const id = ++requestId.current;
    void Promise.resolve(el.play()).catch((e: unknown) => {
      if (requestId.current !== id) return;
      log.warn("audio playback failed:", e);
      needsReload.current = true;
      setError("player.audio.error");
    });
  }, []);

  /** One history entry per activation (see pendingRecord). Resuming from pause
   *  goes through toggle() and is deliberately not recorded. */
  const recordPlay = useCallback(
    ({ file, workspaceId }: AudioTrack) => {
      void api
        .fileRecordPlay(file.id, workspaceId, "browser")
        .then(() => {
          // Same refresh the video player triggers: a played/unplayed filter or
          // an "accessed" sort would otherwise keep showing stale membership,
          // and the history timeline would omit the track until a refetch.
          invalidatePlayedSearches(qc);
          void qc.invalidateQueries({ queryKey: ["history_list"] });
          // The main process consumed the Watch Later entry along with the
          // play; mirror that like the video player does on its first play.
          dropFromWatchLaterCache(qc, workspaceId, file.id);
        })
        .catch((e: unknown) => log.warn("record play failed:", e));
    },
    [qc],
  );

  // Element events are the single source of playback state, so tests can step it
  // deterministically by dispatching events (jsdom decodes nothing and never
  // advances currentTime on its own).
  useEffect(() => {
    const el = ensureEl();
    const onLoaded = () => {
      setDuration(
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
      );
    };
    const onTime = () => setPosition(el.currentTime);
    const onPlay = () => {
      setIsPlaying(true);
      // Fires on every paused→playing edge, so this is exactly "audio starts":
      // a video that is running yields here, once, and nothing reacts to audio
      // that merely keeps playing.
      peers.current.forEach((pauseOther) => pauseOther());
    };
    const onPlaying = () => {
      const track = pendingRecord.current;
      if (!track) return;
      pendingRecord.current = null;
      recordPlay(track);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      // Stop at the end rather than snapping to 0, so the bar shows the track at
      // its final position and stays replayable.
      setPosition(Number.isFinite(el.duration) ? el.duration : el.currentTime);
    };
    const onError = () => {
      setIsPlaying(false);
      needsReload.current = true;
      setError("player.audio.error");
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("durationchange", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("durationchange", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [ensureEl, recordPlay]);

  // Stop playback when the provider itself goes away (app teardown), so no
  // detached element keeps decoding.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    };
  }, []);

  useEffect(() => {
    const el = ensureEl();
    el.volume = volume;
    el.muted = muted;
  }, [ensureEl, volume, muted]);

  const play = useCallback(
    (file: FileRow, workspaceId: string) => {
      const el = ensureEl();
      // The track resolves by workspaceId + fileId, never via the *active*
      // workspace, so playback survives a workspace switch (including to All).
      const src = `${mediaBaseRef.current}/ws/${workspaceId}/media/${file.id}`;
      needsReload.current = false;
      setError(null);
      setDuration(null);
      setPosition(0);
      setCurrent({ file, workspaceId });
      el.src = src;
      el.currentTime = 0;
      // Recorded once the element reports `playing`, not here: play() is only
      // ever reached from an explicit activation (click / Enter / the detail
      // route), but the activation is not the play — the load can still fail.
      pendingRecord.current = { file, workspaceId };
      startPlayback(el);
    },
    [ensureEl, startPlayback],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentRef.current) return;
    if (el.paused) {
      // After a failure the element holds an error state that play() alone
      // cannot clear, so reload the source to give the retry a real chance.
      if (needsReload.current) {
        needsReload.current = false;
        setError(null);
        el.load();
      }
      // After `ended` the element sits at the end; play() alone would be a no-op
      // in some engines, so rewind first to make the control mean "replay".
      else if (
        durationRef.current != null &&
        el.currentTime >= durationRef.current
      )
        el.currentTime = 0;
      startPlayback(el);
    } else {
      pauseEl(el);
    }
  }, [startPlayback, pauseEl]);

  const isCurrent = (fileId: number, workspaceId: string): boolean =>
    currentRef.current?.file.id === fileId &&
    currentRef.current.workspaceId === workspaceId;

  const playOrToggle = useCallback(
    (file: FileRow, workspaceId: string) => {
      if (isCurrent(file.id, workspaceId)) toggle();
      else play(file, workspaceId);
    },
    [play, toggle],
  );

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (el) pauseEl(el);
  }, [pauseEl]);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(sec)) return;
    const max = durationRef.current ?? 0;
    const clamped = Math.min(max, Math.max(0, sec));
    el.currentTime = clamped;
    setPosition(clamped);
  }, []);

  // Dragging the slider is an explicit request to hear something, so the store
  // also unmutes — matching what the video player does on the same interaction.
  const setVolume = useCallback((v: number) => setSharedVolume(v), []);
  const toggleMuted = useCallback(() => toggleSharedMuted(), []);

  const close = useCallback(() => {
    // Invalidates any in-flight play() promise, so its rejection cannot resurrect
    // an error message after the bar is gone.
    requestId.current++;
    needsReload.current = false;
    pendingRecord.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      // Dropping src alone leaves the previously buffered data attached; load()
      // is what actually releases it.
      el.removeAttribute("src");
      el.load();
    }
    setCurrent(null);
    setIsPlaying(false);
    setDuration(null);
    setPosition(0);
    setError(null);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const registerPeer = useCallback((onAudioStart: () => void) => {
    peers.current.add(onAudioStart);
    return () => {
      peers.current.delete(onAudioStart);
    };
  }, []);

  const pauseIfCurrent = useCallback(
    (fileId: number, workspaceId: string) => {
      if (isCurrent(fileId, workspaceId)) pause();
    },
    [pause],
  );

  // Every member is a stable callback (state comes in through refs), so this
  // object is created once and AudioActionsContext never notifies.
  const actions = useMemo<AudioActions>(
    () => ({
      play,
      playOrToggle,
      pauseIfCurrent,
      toggle,
      pause,
      seek,
      setVolume,
      toggleMuted,
      close,
      dismissError,
      registerPeer,
    }),
    [
      play,
      playOrToggle,
      pauseIfCurrent,
      toggle,
      pause,
      seek,
      setVolume,
      toggleMuted,
      close,
      dismissError,
      registerPeer,
    ],
  );

  const value = useMemo<AudioPlayerState>(
    () => ({
      current,
      isPlaying,
      duration,
      volume,
      muted,
      error,
      play,
      toggle,
      pause,
      seek,
      setVolume,
      toggleMuted,
      close,
      dismissError,
    }),
    [
      current,
      isPlaying,
      duration,
      volume,
      muted,
      error,
      play,
      toggle,
      pause,
      seek,
      setVolume,
      toggleMuted,
      close,
      dismissError,
    ],
  );

  return (
    <AudioActionsContext.Provider value={actions}>
      <AudioPlayerContext.Provider value={value}>
        <AudioPositionContext.Provider value={position}>
          {children}
        </AudioPositionContext.Provider>
      </AudioPlayerContext.Provider>
    </AudioActionsContext.Provider>
  );
}
