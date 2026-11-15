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
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import {
  endedSample,
  POSITION_SEEK_INTERVAL_MS,
  type PositionSample,
} from "@/lib/positionReporter";
import { resolveStartAt } from "@shared/resume";
import { useOptionalPreferences } from "@/settings/PreferencesProvider";
import { attachAnalyser } from "./analyser";
import { NORMAL_SPEED } from "@/lib/playbackSpeed";
import {
  AudioActionsContext,
  AudioPlayerContext,
  AudioPositionContext,
  type AudioActions,
  type AudioPlayerState,
  type AudioTrack,
  type PlayOpts,
  type SpeedUpdate,
} from "./context";

/** The media URL of a track (see play()). */
function srcOf(mediaBase: string, { file, workspaceId }: AudioTrack): string {
  return `${mediaBase}/ws/${workspaceId}/media/${file.id}`;
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  // One volume for every player surface: the detail view, the playlist player
  // and this bar all read and write the same store (hooks/useVolume.ts), so a
  // level set in one place holds for the others within the session, not just
  // after a restart.
  const { volume, muted } = useVolume();
  const [error, setError] = useState<TranslationKey | null>(null);
  // Playback speed, for the loaded track only (#280). The ref is what a load
  // reapplies: a new source starts the element at normal speed.
  const [playbackRate, setRateState] = useState(NORMAL_SPEED);
  const rateRef = useRef(NORMAL_SPEED);

  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const qc = useQueryClient();
  // Optional: this provider sits above the router and is rendered on its own
  // in tests. Without preferences, resuming stays on (the default).
  const resumePlayback = useOptionalPreferences()?.resumePlayback ?? true;
  // Where the loaded track stands, for its resume point.
  const playbackPosition = usePlaybackPosition(
    current?.workspaceId,
    current?.file.id,
  );

  // Live copies for the actions below, which must keep one identity for the
  // provider's lifetime (see AudioActionsContext) and so cannot close over the
  // state they were created with.
  const currentRef = useRef<AudioTrack | null>(null);
  const durationRef = useRef<number | null>(null);
  const mediaBaseRef = useRef("");
  const resumePlaybackRef = useRef(resumePlayback);
  // The source play() last assigned, and the one belonging to the track the
  // render has caught up with. Position samples are taken only while the
  // element still holds the latter (see sampleOf).
  const assignedSrcRef = useRef<string | null>(null);
  const committedSrcRef = useRef<string | null>(null);
  // Synced before paint, so a click handled in the same frame sees the state
  // that produced what is on screen (the rules-of-hooks lint forbids writing
  // a ref during render itself).
  useLayoutEffect(() => {
    currentRef.current = current;
    committedSrcRef.current = current ? assignedSrcRef.current : null;
    durationRef.current = duration;
    mediaBaseRef.current = mediaBase;
    resumePlaybackRef.current = resumePlayback;
  }, [current, duration, mediaBase, resumePlayback]);

  /**
   * Where the element stands in the loaded track, or null when that cannot be
   * said: nothing loaded, or the element already switched to another source
   * (play() swaps it before the render that makes the new track current, and
   * an event in between belongs to neither).
   */
  const sampleOf = useCallback(
    (el: HTMLAudioElement): PositionSample | null => {
      // Compared with the source the committed track was actually given, not
      // one rebuilt from the media origin now: that origin may have resolved
      // after the track started.
      const src = committedSrcRef.current;
      if (!src || el.readyState < 1) return null;
      if (el.getAttribute("src") !== src) return null;
      const duration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      // An element sitting at its end reports that: the flush on leaving a
      // finished track (play() of the next, close()) must say "ended" too, or
      // a track of unknown length would store its end as the resume point.
      if (el.ended) return endedSample({ position: el.currentTime, duration });
      return { position: el.currentTime, duration };
    },
    [],
  );

  // Whether the element is sitting on a failed resource. Tracked apart from the
  // displayed `error` because dismissing the message must not also discard the
  // knowledge that a retry has to reload the source first.
  const needsReload = useRef(false);

  const ensureEl = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      // Loaded with CORS so the spectrum analyser (analyser.ts) can read the
      // samples: an opaque cross-origin source feeds it silence. Set before
      // any src, as the mode is fixed when the load starts.
      el.crossOrigin = "anonymous";
      audioRef.current = el;
    }
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
  // Told when a track plays to its end (see subscribeEnded).
  const endedListeners = useRef(new Set<(track: AudioTrack) => void>());

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
      el.playbackRate = rateRef.current;
      setDuration(
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
      );
    };
    const onTime = () => {
      setPosition(el.currentTime);
      const sample = el.paused ? null : sampleOf(el);
      if (sample) playbackPosition.tick(sample);
    };
    const onPlay = () => {
      setIsPlaying(true);
      setEnded(false);
      // Fires on every paused→playing edge, so this is exactly "audio starts":
      // a video that is running yields here, once, and nothing reacts to audio
      // that merely keeps playing.
      peers.current.forEach((pauseOther) => pauseOther());
    };
    const onPlaying = () => {
      // Every start, not only the recorded one: a track whose first start was
      // not recorded yet is picked up by the same event below.
      if (sampleOf(el)) playbackPosition.markPlayed();
      const track = pendingRecord.current;
      if (!track) return;
      pendingRecord.current = null;
      recordPlay(track);
    };
    const onPause = () => {
      setIsPlaying(false);
      const sample = sampleOf(el);
      if (sample) playbackPosition.flush(sample);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setEnded(true);
      const sample = sampleOf(el);
      if (sample) playbackPosition.flush(endedSample(sample));
      // Stop at the end rather than snapping to 0, so the bar shows the track at
      // its final position and stays replayable.
      setPosition(Number.isFinite(el.duration) ? el.duration : el.currentTime);
      const track = currentRef.current;
      if (track) endedListeners.current.forEach((l) => l(track));
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
  }, [ensureEl, recordPlay, sampleOf, playbackPosition]);

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
    (file: FileRow, workspaceId: string, opts: PlayOpts = {}) => {
      const el = ensureEl();
      // No start given (a play button in a list): where the track was left
      // last time, unless resuming is turned off. Callers that decide the start
      // themselves (the detail view, the playlist) always pass one.
      const { startAt } = resolveStartAt({
        explicit: opts.startAt,
        resume: opts.startAt == null ? file.resumePosition : null,
        enabled: resumePlaybackRef.current,
      });
      // The outgoing track's last position, read before its source is gone.
      const outgoing = sampleOf(el);
      if (outgoing) playbackPosition.flush(outgoing);
      // The track resolves by workspaceId + fileId, never via the *active*
      // workspace, so playback survives a workspace switch (including to All).
      const src = srcOf(mediaBaseRef.current, { file, workspaceId });
      assignedSrcRef.current = src;
      needsReload.current = false;
      setError(null);
      setDuration(null);
      setPosition(startAt);
      setEnded(false);
      setCurrent({ file, workspaceId });
      rateRef.current = NORMAL_SPEED;
      setRateState(NORMAL_SPEED);
      el.src = src;
      // Assigned before any data has arrived, which the element honours as the
      // position to begin at once it can (it is not a seek that could be lost).
      el.currentTime = startAt;
      // Recorded once the element reports `playing`, not here: play() is only
      // ever reached from an explicit activation (click / Enter / the detail
      // route), but the activation is not the play — the load can still fail.
      pendingRecord.current = { file, workspaceId };
      startPlayback(el);
    },
    [ensureEl, startPlayback, sampleOf, playbackPosition],
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

  const isCurrent = useCallback(
    (fileId: number, workspaceId: string): boolean =>
      currentRef.current?.file.id === fileId &&
      currentRef.current.workspaceId === workspaceId,
    [],
  );

  const playOrToggle = useCallback(
    (file: FileRow, workspaceId: string) => {
      if (isCurrent(file.id, workspaceId)) toggle();
      else play(file, workspaceId);
    },
    [isCurrent, play, toggle],
  );

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (el) pauseEl(el);
  }, [pauseEl]);

  const seek = useCallback(
    (sec: number) => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(sec)) return;
      const max = durationRef.current ?? 0;
      const clamped = Math.min(max, Math.max(0, sec));
      el.currentTime = clamped;
      setEnded(false);
      setPosition(clamped);
      const sample = sampleOf(el);
      if (sample)
        playbackPosition.tick(
          { ...sample, position: clamped },
          POSITION_SEEK_INTERVAL_MS,
        );
    },
    [sampleOf, playbackPosition],
  );

  // Dragging the slider is an explicit request to hear something, so the store
  // also unmutes — matching what the video player does on the same interaction.
  const setVolume = useCallback((v: number) => setSharedVolume(v), []);
  const setPlaybackRate = useCallback((next: SpeedUpdate) => {
    const rate = typeof next === "function" ? next(rateRef.current) : next;
    rateRef.current = rate;
    setRateState(rate);
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, []);
  const toggleMuted = useCallback(() => toggleSharedMuted(), []);

  const close = useCallback(() => {
    // Invalidates any in-flight play() promise, so its rejection cannot resurrect
    // an error message after the bar is gone.
    requestId.current++;
    needsReload.current = false;
    pendingRecord.current = null;
    const el = audioRef.current;
    if (el) {
      const sample = sampleOf(el);
      if (sample) playbackPosition.flush(sample);
      el.pause();
      // Dropping src alone leaves the previously buffered data attached; load()
      // is what actually releases it.
      el.removeAttribute("src");
      el.load();
    }
    setCurrent(null);
    setIsPlaying(false);
    setEnded(false);
    setDuration(null);
    setPosition(0);
    setError(null);
  }, [sampleOf, playbackPosition]);

  const dismissError = useCallback(() => setError(null), []);

  const subscribeEnded = useCallback(
    (listener: (track: AudioTrack) => void) => {
      endedListeners.current.add(listener);
      return () => {
        endedListeners.current.delete(listener);
      };
    },
    [],
  );

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
    [isCurrent, pause],
  );

  const ensureAnalyser = useCallback(
    () => attachAnalyser(ensureEl()),
    [ensureEl],
  );

  // Every member is a stable callback (state comes in through refs), so this
  // object is created once and AudioActionsContext never notifies.
  const actions = useMemo<AudioActions>(
    () => ({
      play,
      playOrToggle,
      isCurrent,
      pauseIfCurrent,
      toggle,
      pause,
      seek,
      setVolume,
      setPlaybackRate,
      toggleMuted,
      close,
      dismissError,
      subscribeEnded,
      registerPeer,
      ensureAnalyser,
    }),
    [
      play,
      playOrToggle,
      isCurrent,
      pauseIfCurrent,
      toggle,
      pause,
      seek,
      setVolume,
      setPlaybackRate,
      toggleMuted,
      close,
      dismissError,
      subscribeEnded,
      registerPeer,
      ensureAnalyser,
    ],
  );

  const value = useMemo<AudioPlayerState>(
    () => ({
      current,
      isPlaying,
      ended,
      duration,
      volume,
      muted,
      playbackRate,
      error,
      play,
      toggle,
      pause,
      seek,
      setVolume,
      setPlaybackRate,
      toggleMuted,
      close,
      dismissError,
    }),
    [
      current,
      isPlaying,
      ended,
      duration,
      volume,
      muted,
      playbackRate,
      error,
      play,
      toggle,
      pause,
      seek,
      setVolume,
      setPlaybackRate,
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
