// Full-screen playlist player. /play
//
// Plays the list the user is browsing — a collection, Watch Later, a workspace
// listing or a search result — one item after another with no input required.
// The order comes from MediaNavContext, so whatever sort and filter the list has
// is what plays, and the queue keeps growing as further pages load.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { usePlaybackQueue } from "@/hooks/usePlaybackQueue";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  bumpVolume,
  setVolume,
  toggleMuted,
  useVolume,
  VOLUME_STEP,
} from "@/hooks/useVolume";
import { usePreferences } from "@/settings/PreferencesProvider";
import { useTheme } from "@/themes/ThemeProvider";
import { cn } from "@/lib/utils";
import { NAV_BINDINGS, matchAny } from "@/settings/keybindings";
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
import { SnapshotStage } from "./SnapshotStage";
import { captureStage, type StageSnapshot } from "./stageSnapshot";
import { enteringStyle, leavingStyle, type Leg } from "./transition";
import { PlayerChrome } from "./PlayerChrome";
import { PlayerStage } from "./PlayerStage";

/** Idle time before the control bar fades away. */
const CHROME_IDLE_MS = 2500;

/**
 * Half of one item-to-item transition: the outgoing item fades out over this
 * long, the swap happens at the bottom of the dip, and the incoming item fades
 * back in over the same span. Dipping through the stage's own ground rather than
 * cross-dissolving keeps exactly one video element alive at a time.
 */
const TRANSITION_MS = 260;

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
  // Plain black or plain white rather than the theme family's own background:
  // this is the ground a transparent image is composited onto, so it wants to be
  // the neutral extreme of the current appearance, not a tinted surface.
  const { mode } = useTheme();
  const ground = mode === "light" ? "bg-white" : "bg-black";
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
  // Shared with the detail view's player, so a level set in either place holds
  // for the other and survives both item switches and restarts.
  const { volume, muted } = useVolume();
  const videoRef = useRef<PlayerHandle>(null);

  const exit = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    void navigate("/");
  }, [navigate]);

  // The player covers the window on its own; going full screen on top of that is
  // the user's call, not something entering playback decides for them. Leaving
  // full screen therefore just leaves full screen — playback carries on.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // Whatever state the player is left in, it must not strand the app full screen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    },
    [],
  );
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

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

  // Without its details there is nothing to render for this item, so a failed
  // fetch would leave the stage blank for good. Treat it like any other
  // unplayable item and move on (FR-015).
  useEffect(() => {
    if (!current || !detail.isError) return;
    skipCurrent();
  }, [current, detail.isError, skipCurrent]);

  // Images have no "play" event of their own, so viewing one is the play record
  // (mirrors the detail view, and is what removes it from Watch Later).
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !isImage) {
      // Once the player settles on a non-image, drop the guard so coming back to
      // the same image records a new view. A playlist reaches image → video →
      // the same image routinely (repeat, shuffle, stepping back), and without
      // this the second visit is never recorded — which also leaves the file
      // sitting in Watch Later. Same fix the detail view already carries.
      if (current) recordedRef.current = null;
      return;
    }
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

  // Any volume change gets an answer on screen. The keys are handled in two
  // places (here for images, the video player for everything else) and the
  // detail view can move the same value, so watching the value itself covers
  // every route without wiring a callback through each one.
  const volumeReady = useRef(false);
  useEffect(() => {
    if (!volumeReady.current) {
      volumeReady.current = true;
      return;
    }
    wake();
  }, [volume, muted, wake]);

  // Decode the next item ahead of time so the swap lands on a warm cache. Only
  // its pixels: file_get records an access server-side, so prefetching the
  // detail would mark items as seen before the user ever reaches them.
  const upcoming = queue.upcoming;
  useEffect(() => {
    if (!upcoming || !mediaBase) return;
    const kind = upcoming.kind === "image" ? "media" : "thumb";
    const img = new Image();
    img.src = `${mediaBase}/ws/${upcoming.workspaceId}/${kind}/${upcoming.fileId}`;
  }, [upcoming, mediaBase]);

  const togglePlay = useCallback(() => {
    if (isImage) {
      setPaused((p) => !p);
      return;
    }
    videoRef.current?.togglePlay();
  }, [isImage]);

  // Item changes animate rather than cut. Two independent effects compose:
  // "fade" dissolves between the two items, "transition" slides one over the
  // other. Both need the outgoing item to stay on screen while the incoming one
  // arrives, so the swap happens immediately and the item that left is held as a
  // frozen still beside the live one — which keeps exactly one media element
  // playing at any moment.
  const [leaving, setLeaving] = useState<{
    snapshot: StageSnapshot;
    dir: 1 | -1;
    leg: Leg;
  } | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapFrame = useRef<number | null>(null);
  // What is on screen right now, read at capture time (the values themselves are
  // derived further down, after the queue has been consulted).
  const currentKeyRef = useRef("");
  const thumbSrcRef = useRef<string | undefined>(undefined);
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
  useEffect(() => clearSwapTimers, [clearSwapTimers]);

  const transitionTo = useCallback(
    (step: () => void, dir: 1 | -1) => {
      clearSwapTimers();
      if (transitionMs === 0) {
        setLeaving(null);
        step();
        return;
      }
      // Freeze what is on screen before the swap replaces it. Nothing to freeze
      // (no media loaded yet) means nothing to animate against, so just swap.
      const snapshot = captureStage(
        rootRef.current,
        currentKeyRef.current,
        thumbSrcRef.current,
      );
      videoRef.current?.pause();
      step();
      if (!snapshot) {
        setLeaving(null);
        return;
      }
      setLeaving({ snapshot, dir, leg: "armed" });
      // One parked frame, then release both layers together.
      swapFrame.current = requestAnimationFrame(() => {
        swapFrame.current = null;
        setLeaving((l) => (l ? { ...l, leg: "running" } : l));
        swapTimer.current = setTimeout(() => {
          swapTimer.current = null;
          setLeaving(null);
        }, transitionMs);
      });
    },
    [transitionMs, clearSwapTimers],
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
    toggleFullscreen,
    exit,
    navBinding,
    wake,
  });
  useEffect(() => {
    keyState.current = {
      isImage,
      togglePlay,
      goNext,
      goPrev,
      toggleShuffle,
      toggleFullscreen,
      exit,
      navBinding,
      wake,
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
      // Space and Enter belong to whatever control has focus. Swallowing them
      // here would stop the control bar's own buttons from ever activating,
      // which is the whole of "usable from the keyboard alone".
      if (
        el &&
        (e.code === "Space" || e.code === "Enter") &&
        (el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.getAttribute("role") === "button")
      )
        return;
      const s = keyState.current;
      // Shortcuts arrive on window, so the root's own onKeyDown never sees them
      // (focus usually sits on <body>). Waking here is what gives a keypress any
      // visible answer at all once the bar has hidden itself.
      s.wake();
      // The preset's paging chords step through the playlist, the same way they
      // page files in the detail view. Checked before the modifier guard because
      // a preset chord may itself carry one, and before the switch because the
      // video player yields these keys expecting someone else to act on them.
      if (matchAny(e, s.navBinding.prev)) {
        e.preventDefault();
        s.goPrev();
        return;
      }
      if (matchAny(e, s.navBinding.next)) {
        e.preventDefault();
        s.goNext();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.code) {
        case "Escape":
          // In full screen the browser's own Esc leaves it; closing the player
          // as well would collapse two steps into one keypress.
          if (document.fullscreenElement) return;
          e.preventDefault();
          s.exit();
          return;
        case "KeyF":
          e.preventDefault();
          s.toggleFullscreen();
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
        // Volume follows the same split as play/pause and seeking: while a video
        // is on screen its own handler owns these keys, and acting here as well
        // would move the level twice per press.
        case "ArrowUp":
          if (!s.isImage) return;
          e.preventDefault();
          bumpVolume(VOLUME_STEP);
          return;
        case "ArrowDown":
          if (!s.isImage) return;
          e.preventDefault();
          bumpVolume(-VOLUME_STEP);
          return;
        case "KeyM":
          if (!s.isImage) return;
          e.preventDefault();
          toggleMuted();
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
    // A pass where nothing could be played ends on the explanation below rather
    // than dropping the user back on the list with no idea why (FR-015).
    if (queue.unplayable) return;
    // Finished a pass with repeat off — hand the user back to their list (FR-006).
    exit();
  }, [queue.ended, queue.total, queue.unplayable, exit]);

  const wsId = current?.workspaceId ?? "";
  // Both URLs are addressable from the queue item alone. Deriving them from the
  // fetched detail instead put an IPC round trip between the swap and the first
  // pixel, which is the gap that showed up on every next/previous. The detail
  // now only enriches what is already on screen (the file's name).
  const thumbSrc =
    mediaBase && current
      ? `${mediaBase}/ws/${wsId}/thumb/${current.fileId}`
      : undefined;
  const mediaSrc =
    mediaBase && current
      ? `${mediaBase}/ws/${wsId}/media/${current.fileId}`
      : "";
  const title = file ? fileNameOf(file.relPath) : "";
  useEffect(() => {
    currentKeyRef.current = current
      ? `${current.workspaceId}:${current.fileId}`
      : "";
    thumbSrcRef.current = thumbSrc;
  });
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
      className={cn("fixed inset-0 z-50 overflow-hidden", ground)}
      onMouseMove={wake}
      onKeyDown={wake}
    >
      {queue.waiting && !current ? (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <p>{t("playlist.loading")}</p>
        </div>
      ) : empty || queue.unplayable ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
          <p>{emptyMessage}</p>
          <p className="text-sm">{t("playlist.emptyHint")}</p>
        </div>
      ) : (
        <>
          {leaving && (
            <div
              key={leaving.snapshot.key}
              data-slot="player-leaving"
              className="absolute inset-0"
              style={leavingStyle(
                leaving.leg,
                leaving.dir,
                transitionMs,
                playlistFade,
                playlistTransition,
              )}
            >
              <SnapshotStage snapshot={leaving.snapshot} ground={ground} />
            </div>
          )}
          <div
            data-slot="player-fade"
            className="absolute inset-0"
            style={enteringStyle(
              leaving?.leg ?? null,
              leaving?.dir ?? 1,
              transitionMs,
              playlistFade,
              playlistTransition,
            )}
          >
            <PlayerStage backdropSrc={thumbSrc} ground={ground}>
              {current && isImage && (
                <ImageStage
                  src={mediaSrc}
                  alt={file?.relPath ?? ""}
                  durationMs={playlistImageSeconds * 1000}
                  paused={paused}
                  motion={imageMotion}
                  onDone={goNext}
                  onError={skipCurrent}
                />
              )}
              {current && !isImage && (
                <VideoPlayer
                  ref={videoRef}
                  key={`${wsId}:${current.fileId}`}
                  id={current.fileId}
                  src={mediaSrc}
                  // Chromeless hides the seek bar and drops the aspect-ratio box,
                  // so these only enrich; the video need not wait for them.
                  duration={file?.duration ?? null}
                  width={file?.width ?? null}
                  height={file?.height ?? null}
                  mediaBase={mediaBase}
                  wsId={wsId}
                  startAt={0}
                  autoplay
                  navKeys={navBinding}
                  fullscreenTargetRef={rootRef}
                  onNativeDuration={() => undefined}
                  onPlayed={() => invalidatePlayedSearches(qc)}
                  chromeless
                  onEnded={goNext}
                  onPlayingChange={(playing) => {
                    setVideoPlaying(playing);
                    // The video draws no chrome of its own here, so a play/pause
                    // from the keyboard would otherwise change nothing on screen.
                    wake();
                  }}
                  onFatalError={skipCurrent}
                  t={t}
                />
              )}
            </PlayerStage>
          </div>
        </>
      )}

      {!empty && !queue.unplayable && (
        <PlayerChrome
          title={title}
          position={queue.position}
          total={queue.total}
          playing={playing}
          shuffle={playlistShuffle}
          repeat={playlistRepeat}
          fullscreen={isFullscreen}
          canPrev={queue.canPrev}
          visible={chromeVisible}
          volume={volume}
          muted={muted}
          audible={!isImage}
          onVolumeChange={setVolume}
          onToggleMute={toggleMuted}
          onTogglePlay={togglePlay}
          onPrev={goPrev}
          onNext={goNext}
          onToggleShuffle={toggleShuffle}
          onToggleRepeat={toggleRepeat}
          onToggleFullscreen={toggleFullscreen}
          onExit={exit}
          t={t}
        />
      )}
    </div>
  );
}
