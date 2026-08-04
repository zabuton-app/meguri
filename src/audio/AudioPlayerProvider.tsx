// Single-track audio playback backed by one <audio> element.
//
// Mounted outside RouterProvider (see App.tsx) so navigation never unmounts it and
// playback continues across route changes. One element also makes overlapping audio
// unrepresentable: a second play() necessarily replaces the first track.
import {
  useCallback,
  useEffect,
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
import { invalidatePlayedSearches } from "@/lib/queryCache";
import { loadMuted, loadVolume, saveVolume } from "@/lib/playerVolume";
import { useAppStatus } from "@/hooks/useAppStatus";
import {
  AudioPlayerContext,
  AudioPositionContext,
  type AudioPlayerState,
  type AudioTrack,
} from "./context";

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [volume, setVolumeState] = useState(loadVolume);
  const [muted, setMuted] = useState(loadMuted);
  const [error, setError] = useState<TranslationKey | null>(null);

  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const qc = useQueryClient();

  // Whether the element is sitting on a failed resource. Tracked apart from the
  // displayed `error` because dismissing the message must not also discard the
  // knowledge that a retry has to reload the source first.
  const needsReload = useRef(false);

  const ensureEl = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  // Bumped by every play()/close(). play() returns a promise that can reject
  // long after a newer track replaced the source (an interrupted load rejects
  // with AbortError), so a late rejection must not attach its error to whatever
  // is playing now.
  const requestId = useRef(0);

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
    const onPlay = () => setIsPlaying(true);
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
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("durationchange", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [ensureEl]);

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
      const src = `${mediaBase}/ws/${workspaceId}/media/${file.id}`;
      needsReload.current = false;
      setError(null);
      setDuration(null);
      setPosition(0);
      setCurrent({ file, workspaceId });
      el.src = src;
      el.currentTime = 0;
      startPlayback(el);

      // One entry per activation. play() is only ever reached from an explicit
      // user activation (click / Enter / the detail-route recovery); resuming
      // from pause goes through toggle() and is deliberately not recorded.
      void api
        .fileRecordPlay(file.id, workspaceId, "browser")
        .then(() => {
          // Same refresh the video player triggers: a played/unplayed filter or
          // an "accessed" sort would otherwise keep showing stale membership,
          // and the history timeline would omit the track until a refetch.
          invalidatePlayedSearches(qc);
          void qc.invalidateQueries({ queryKey: ["history_list"] });
        })
        .catch((e: unknown) => log.warn("record play failed:", e));
    },
    [ensureEl, mediaBase, startPlayback, qc],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !current) return;
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
      else if (duration != null && el.currentTime >= duration)
        el.currentTime = 0;
      startPlayback(el);
    } else {
      el.pause();
    }
  }, [current, duration, startPlayback]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seek = useCallback(
    (sec: number) => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(sec)) return;
      const max = duration ?? 0;
      const clamped = Math.min(max, Math.max(0, sec));
      el.currentTime = clamped;
      setPosition(clamped);
    },
    [duration],
  );

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    // Dragging the slider is an explicit request to hear something, so it also
    // unmutes — matching what the video player does on the same interaction.
    setMuted(false);
    saveVolume(clamped, false);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      saveVolume(volume, !m);
      return !m;
    });
  }, [volume]);

  const close = useCallback(() => {
    // Invalidates any in-flight play() promise, so its rejection cannot resurrect
    // an error message after the bar is gone.
    requestId.current++;
    needsReload.current = false;
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
    <AudioPlayerContext.Provider value={value}>
      <AudioPositionContext.Provider value={position}>
        {children}
      </AudioPositionContext.Provider>
    </AudioPlayerContext.Provider>
  );
}
