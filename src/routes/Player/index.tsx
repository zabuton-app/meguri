// Full-screen playlist player. /play
//
// Plays the list the user is browsing — a collection, Watch Later, a workspace
// listing or a search result — one item after another with no input required.
// The order comes from MediaNavContext, so whatever sort and filter the list has
// is what plays, and the queue keeps growing as further pages load.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { usePlaybackQueue } from "@/hooks/usePlaybackQueue";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { usePreferences } from "@/settings/PreferencesProvider";
import { NAV_BINDINGS } from "@/settings/keybindings";
import {
  invalidateCollectionSearches,
  invalidatePlayedSearches,
} from "@/lib/queryCache";
import { fileNameOf } from "@/lib/relPath";
import {
  VideoPlayer,
  type PlayerHandle,
} from "@/routes/MediaDetail/VideoPlayer";
import { ImageStage } from "./ImageStage";
import { PlayerChrome } from "./PlayerChrome";
import { PlayerStage } from "./PlayerStage";

/** Idle time before the control bar fades away. */
const CHROME_IDLE_MS = 2500;

/**
 * Half of one item-to-item transition: the outgoing item fades out over this
 * long, the swap happens at the bottom of the dip, and the incoming item fades
 * back in over the same span. Dipping through the stage's own black rather than
 * cross-dissolving keeps exactly one video element alive at a time.
 */
const TRANSITION_MS = 260;

/**
 * "out" = leaving, "in" = parked at the incoming position with the animation
 * suppressed for one frame, "idle" = settled in place.
 */
type SwapPhase = "idle" | "out" | "in";

/**
 * Inline style for the stage during a switch. The two effects are independent:
 * `fade` contributes the opacity, `slide` the horizontal offset. With both off
 * nothing animates and the swap is a plain cut.
 */
function swapStyle(
  phase: SwapPhase,
  dir: 1 | -1,
  durationMs: number,
  fade: boolean,
  slide: boolean,
): CSSProperties {
  if (durationMs === 0 || (!fade && !slide)) return {};
  // Leaving goes against the travel direction, arriving comes from ahead of it.
  const offset = phase === "out" ? -100 * dir : phase === "in" ? 100 * dir : 0;
  const away = phase !== "idle";
  return {
    opacity: fade && away ? 0 : 1,
    transform: slide ? `translateX(${offset}%)` : undefined,
    // The parked frame must not animate, or the stage would slide back from the
    // far side instead of jumping there.
    transition:
      phase === "in"
        ? "none"
        : `opacity ${durationMs}ms ease-in-out, transform ${durationMs}ms ease-in-out`,
  };
}

export default function Player() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useI18n();
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const {
    playlistImageSeconds,
    playlistShuffle,
    playlistRepeat,
    playlistImageMotion,
    playlistFade,
    playlistTransition,
    keybindingPreset,
    setPlaylistShuffle,
    setPlaylistRepeat,
  } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  const navBinding = NAV_BINDINGS[keybindingPreset];

  const queue = usePlaybackQueue({
    shuffle: playlistShuffle,
    repeat: playlistRepeat,
  });
  const { current, next, prev, skipCurrent } = queue;

  // Reduced motion turns switching effects off outright rather than merely
  // shortening them, as does turning both effects off by hand. Either way the
  // player still advances on exactly the same schedule.
  const animateSwap = !reducedMotion && (playlistFade || playlistTransition);
  const transitionMs = animateSwap ? TRANSITION_MS : 0;

  const [paused, setPaused] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<PlayerHandle>(null);

  const exit = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    void navigate("/");
  }, [navigate]);

  // Take over the screen for as long as the player is open, and treat leaving
  // full screen by any route (Esc, the OS chrome) as ending playback (FR-006).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);
  const enteredFullscreen = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) {
        enteredFullscreen.current = true;
        return;
      }
      // Only a real exit counts; the initial "not yet full screen" state must not
      // close the player before the request resolves.
      if (enteredFullscreen.current) exit();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [exit]);

  // Playing an item drops it from Watch Later in the main process, which stays
  // quiet about it so the list does not shift mid-playback. Flush the affected
  // caches once, on the way out — the same contract the detail view follows.
  useEffect(() => {
    return () => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      invalidateCollectionSearches(qc);
    };
  }, [qc]);

  // Details for the item on screen (dimensions, duration, path).
  const detail = useQuery({
    queryKey: ["file_get", current?.workspaceId, current?.fileId],
    queryFn: () => api.fileGet(current!.fileId, current!.workspaceId),
    enabled: !!current,
  });
  const file = detail.data ?? null;
  const isImage = current?.kind === "image";

  // Images have no "play" event of their own, so viewing one is the play record
  // (mirrors the detail view, and is what removes it from Watch Later).
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !isImage) return;
    const key = `${current.workspaceId}:${current.fileId}`;
    if (recordedRef.current === key) return;
    recordedRef.current = key;
    api
      .fileRecordPlay(current.fileId, current.workspaceId, "browser")
      .then(() => invalidatePlayedSearches(qc))
      .catch(() => {
        if (recordedRef.current === key) recordedRef.current = null;
      });
  }, [current, isImage, qc]);

  // Control bar: visible on activity, out of the way once the user settles.
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(
      () => setChromeVisible(false),
      CHROME_IDLE_MS,
    );
  }, []);
  // The bar starts visible, so mounting only has to arm the hide timer — calling
  // wake() here would set state that is already set.
  useEffect(() => {
    idleTimer.current = setTimeout(
      () => setChromeVisible(false),
      CHROME_IDLE_MS,
    );
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (isImage) {
      setPaused((p) => !p);
      return;
    }
    videoRef.current?.togglePlay();
  }, [isImage]);

  // Item changes animate rather than cut. Two independent effects compose:
  // "fade" dims the stage through black, "transition" pushes it sideways. The
  // swap happens at the far end of the outgoing leg — with one media element on
  // screen at a time there is nothing to cross-dissolve against, so the switch
  // has to happen while the stage is out of view.
  //
  // "in" is the one frame where the stage is parked at the incoming position
  // with animation off, so returning to "idle" animates instead of jumping.
  const [swap, setSwap] = useState<{ phase: SwapPhase; dir: 1 | -1 }>({
    phase: "idle",
    dir: 1,
  });
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapFrame = useRef<number | null>(null);
  const pendingStep = useRef<(() => void) | null>(null);
  const clearSwapTimers = useCallback(() => {
    if (swapTimer.current) {
      clearTimeout(swapTimer.current);
      swapTimer.current = null;
    }
    if (swapFrame.current != null) {
      cancelAnimationFrame(swapFrame.current);
      swapFrame.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      clearSwapTimers();
      pendingStep.current = null;
    },
    [clearSwapTimers],
  );

  /**
   * Apply a swap that is still waiting out its animation. Pressing next twice
   * in quick succession has to move two items, so the queued step is run rather
   * than dropped when the second transition starts.
   */
  const flushPending = useCallback(() => {
    clearSwapTimers();
    const step = pendingStep.current;
    pendingStep.current = null;
    step?.();
  }, [clearSwapTimers]);

  const transitionTo = useCallback(
    (step: () => void, dir: 1 | -1) => {
      flushPending();
      if (transitionMs === 0) {
        setSwap({ phase: "idle", dir });
        step();
        return;
      }
      videoRef.current?.pause();
      setSwap({ phase: "out", dir });
      pendingStep.current = step;
      swapTimer.current = setTimeout(() => {
        swapTimer.current = null;
        const queued = pendingStep.current;
        pendingStep.current = null;
        queued?.();
        setSwap({ phase: "in", dir });
        // Park for one frame with the animation off, then release: that is what
        // turns the jump back to centre into the incoming leg.
        swapFrame.current = requestAnimationFrame(() => {
          swapFrame.current = null;
          setSwap({ phase: "idle", dir });
        });
      }, transitionMs);
    },
    [transitionMs, flushPending],
  );

  const goNext = useCallback(
    () =>
      transitionTo(() => {
        setPaused(false);
        next();
      }, 1),
    [next, transitionTo],
  );
  const goPrev = useCallback(
    () =>
      transitionTo(() => {
        setPaused(false);
        prev();
      }, -1),
    [prev, transitionTo],
  );

  const toggleShuffle = useCallback(
    () => setPlaylistShuffle(!playlistShuffle),
    [playlistShuffle, setPlaylistShuffle],
  );
  const toggleRepeat = useCallback(
    () => setPlaylistRepeat(!playlistRepeat),
    [playlistRepeat, setPlaylistRepeat],
  );

  // Keyboard control, so the whole session can run without a mouse (FR-020).
  // Space and the arrows are left to the video player while a video is on
  // screen: it owns play/pause and seeking there.
  const keyState = useRef({
    isImage,
    togglePlay,
    goNext,
    goPrev,
    toggleShuffle,
    exit,
  });
  useEffect(() => {
    keyState.current = {
      isImage,
      togglePlay,
      goNext,
      goPrev,
      toggleShuffle,
      exit,
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = keyState.current;
      switch (e.code) {
        case "Escape":
          e.preventDefault();
          s.exit();
          return;
        case "KeyN":
          e.preventDefault();
          s.goNext();
          return;
        case "KeyP":
          e.preventDefault();
          s.goPrev();
          return;
        case "KeyS":
          e.preventDefault();
          s.toggleShuffle();
          return;
        case "Space":
          if (!s.isImage) return;
          e.preventDefault();
          s.togglePlay();
          return;
        case "ArrowRight":
          if (!s.isImage) return;
          e.preventDefault();
          s.goNext();
          return;
        case "ArrowLeft":
          if (!s.isImage) return;
          e.preventDefault();
          s.goPrev();
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Nothing playable: say so rather than sitting on a black screen (FR-016).
  const empty = queue.ended && queue.total === 0;
  useEffect(() => {
    if (!queue.ended || queue.total === 0) return;
    // Finished a pass with repeat off — hand the user back to their list (FR-006).
    exit();
  }, [queue.ended, queue.total, exit]);

  const wsId = current?.workspaceId ?? "";
  const thumbSrc =
    file?.thumbStatus === "done" && mediaBase && wsId
      ? `${mediaBase}/ws/${wsId}/thumb/${file.id}`
      : undefined;
  const mediaSrc =
    mediaBase && wsId && current
      ? `${mediaBase}/ws/${wsId}/media/${current.fileId}`
      : "";
  const title = file ? fileNameOf(file.relPath) : "";
  const imageMotion = playlistImageMotion && !reducedMotion;
  const playing = isImage ? !paused : videoPlaying;

  const emptyMessage = queue.unplayable
    ? t("playlist.unplayable")
    : t("playlist.empty");

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("playlist.start")}
      className="fixed inset-0 z-50 overflow-hidden bg-black"
      onMouseMove={wake}
      onKeyDown={wake}
    >
      {empty || queue.unplayable ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
          <p>{emptyMessage}</p>
          <p className="text-sm">{t("playlist.emptyHint")}</p>
        </div>
      ) : (
        <div
          data-slot="player-fade"
          className="absolute inset-0"
          style={swapStyle(
            swap.phase,
            swap.dir,
            transitionMs,
            playlistFade,
            playlistTransition,
          )}
        >
          <PlayerStage backdropSrc={thumbSrc}>
            {current && isImage && file && (
              <ImageStage
                src={mediaSrc}
                alt={file.relPath}
                durationMs={playlistImageSeconds * 1000}
                paused={paused}
                motion={imageMotion}
                onDone={goNext}
                onError={skipCurrent}
              />
            )}
            {current && !isImage && file && (
              <VideoPlayer
                ref={videoRef}
                key={`${wsId}:${current.fileId}`}
                id={current.fileId}
                src={mediaSrc}
                duration={file.duration}
                width={file.width}
                height={file.height}
                mediaBase={mediaBase}
                wsId={wsId}
                startAt={0}
                autoplay
                navKeys={navBinding}
                fullscreenTargetRef={rootRef}
                onNativeDuration={() => undefined}
                onPlayed={() => invalidatePlayedSearches(qc)}
                onEnded={goNext}
                onPlayingChange={setVideoPlaying}
                onFatalError={skipCurrent}
                t={t}
              />
            )}
          </PlayerStage>
        </div>
      )}

      {!empty && !queue.unplayable && (
        <PlayerChrome
          title={title}
          position={queue.position}
          total={queue.total}
          playing={playing}
          shuffle={playlistShuffle}
          repeat={playlistRepeat}
          canPrev={queue.canPrev}
          visible={chromeVisible}
          onTogglePlay={togglePlay}
          onPrev={goPrev}
          onNext={goNext}
          onToggleShuffle={toggleShuffle}
          onToggleRepeat={toggleRepeat}
          onExit={exit}
          t={t}
        />
      )}
    </div>
  );
}
