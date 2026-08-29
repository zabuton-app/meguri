import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Bookmark,
  BookmarkCheck,
  Camera,
  ExternalLink,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api } from "@/ipc/client";
import type { SceneBookmark } from "@/ipc/types";
import { findNearestBookmark } from "@/lib/bookmarks";
import log from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bumpVolume,
  setVolume,
  syncFromElement,
  toggleMuted,
  useVolume,
  VOLUME_EPSILON,
  VOLUME_STEP,
} from "@/hooks/useVolume";
import { matchAny, type NavBinding } from "@/settings/keybindings";
import type { TFunc } from "@/i18n/I18nProvider";
import { fmtTime } from "./utils";

// MediaError codes as plain numbers: the MediaError global exists in Chromium
// but not in jsdom, so referencing it would break renderer tests.
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;

// Delay before the one automatic reload after a network error: an immediate
// retry in the same tick would likely hit the same connection-slot starvation
// (frame previews holding the origin's sockets) that caused the failure.
const NETWORK_RETRY_DELAY_MS = 300;

export interface PlayerHandle {
  seek: (t: number) => void;
  pause: () => void;
  /** Play/pause from outside the player's own chrome (the playlist control bar). */
  togglePlay: () => void;
}

export const VideoPlayer = forwardRef<
  PlayerHandle,
  {
    id: number;
    src: string;
    duration: number | null;
    width: number | null;
    height: number | null;
    mediaBase: string;
    wsId: string;
    /** Initial seek position in seconds (0 = start). Applied once on load. */
    startAt: number;
    /** Whether the video should start playing automatically (default true). */
    autoplay?: boolean;
    /** Active paging chords; the player yields these keys so they don't also seek. */
    navKeys: NavBinding;
    /**
     * Element to fullscreen instead of the player itself (e.g. the whole modal,
     * YouTube-style: the video fills the screen and the rest scrolls below it).
     */
    fullscreenTargetRef?: React.RefObject<HTMLDivElement | null>;
    /**
     * User-curated bookmarks for this file (drives the toggle button state).
     * Omitted by the playlist player, which shows no editing affordances; the
     * bookmark button is then not rendered at all.
     */
    bookmarks?: SceneBookmark[];
    /** True while a bookmark mutation is in flight; the toggle button is disabled until it resolves. */
    bookmarkPending?: boolean;
    onAddBookmark?: (sec: number) => void;
    onRemoveBookmark?: (bookmarkId: number) => void;
    /** True while a frame export is in flight; the button is disabled until it resolves. */
    exportPending?: boolean;
    /**
     * Export the frame at `sec` as a still image (opens a native save dialog).
     * Omitted by the playlist player; the export button is then not rendered.
     */
    onExportFrame?: (sec: number) => void;
    onNativeDuration: (d: number | null) => void;
    /** Fired once per loaded file when playback first starts (used to refresh the list order). */
    onPlayed: () => void;
    /** Fired when the media plays through to its end (drives playlist auto-advance). */
    onEnded?: () => void;
    /** Mirrors the play/pause state out to an external control bar. */
    onPlayingChange?: (playing: boolean) => void;
    /**
     * Draw the video only. The playlist player supplies its own control bar, so
     * this suppresses both of this player's own surfaces — the paused-state
     * centre play button and the bottom control bar — which would otherwise
     * appear on top of it the moment playback pauses.
     */
    chromeless?: boolean;
    /**
     * Fired instead of rendering the built-in error panel when playback fails
     * for good. The playlist player uses this to skip to the next item; the
     * panel's "open externally" escape hatch would be a manual affordance the
     * full-screen player must not show.
     */
    onFatalError?: (message: string) => void;
    /**
     * Fired when the error screen hands the file to an external player. That
     * counts as a play main-side (and consumes the Watch Later entry), so the
     * parent gets to keep its caches in step. Optional because a caller that
     * handles failures itself (onFatalError) never renders that screen.
     */
    onOpenExternal?: () => void;
    t: TFunc;
  }
>(function VideoPlayer(
  {
    id,
    src,
    duration,
    width,
    height,
    mediaBase,
    wsId,
    startAt,
    autoplay = true,
    navKeys,
    fullscreenTargetRef,
    bookmarks,
    bookmarkPending,
    onAddBookmark,
    onRemoveBookmark,
    exportPending,
    onExportFrame,
    onNativeDuration,
    onPlayed,
    onEnded,
    onPlayingChange,
    onFatalError,
    onOpenExternal,
    chromeless = false,
    t,
  },
  handleRef,
) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // For stream playback, the start second begun on the server side via ?t.
  const [offset, setOffset] = useState(0);
  // Current playback position for display (seconds).
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Whether this player is currently the fullscreen element (used to drop the max-height cap).
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Volume lives outside this component so the playlist chrome and the detail
  // view stay in step (see hooks/useVolume.ts).
  const { volume, muted } = useVolume();
  // Total duration obtained natively (only when finite).
  const [nativeDur, setNativeDur] = useState<number | null>(null);
  // Hover position on the seek bar {ratio: 0..1, t: seconds}. Positioning uses % to be invariant to CSS zoom.
  const [hover, setHover] = useState<{ ratio: number; t: number } | null>(null);
  // Temporary display position while dragging (seconds).
  const [scrub, setScrub] = useState<number | null>(null);

  // Total duration: prefer the DB duration (valid even for streams), otherwise the native value.
  const total = duration && duration > 0 ? duration : (nativeDur ?? undefined);
  // Display position (scrub while dragging).
  const displayPos = scrub ?? position;

  // Keep the latest values for keyboard handling (referenced through the listener's closure).
  const posRef = useRef(0);
  const totalRef = useRef<number | undefined>(undefined);
  // Sync the latest values into refs (written after commit, not during render). Syncing every commit is equivalent to before.
  useEffect(() => {
    posRef.current = displayPos;
    totalRef.current = total;
  });

  // Push the shared volume onto the element. Assigning only when the value
  // actually differs is what stops this from ping-ponging with the
  // `volumechange` handler below, which feeds the element's value back in.
  // This covers changes to the value; a *new* element (the error screen's
  // reload swaps one in) is caught by onLoadedMetadata instead.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Math.abs(v.volume - volume) > VOLUME_EPSILON) v.volume = volume;
    if (v.muted !== muted) v.muted = muted;
  }, [volume, muted]);

  // Throttle preview fetching (limit ffmpeg launches to ~10 times/sec).
  const desiredRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const [previewT, setPreviewT] = useState<number | null>(null);
  // Ensures the initial seek (startAt) is applied only once per loaded file.
  const appliedStartRef = useRef(false);
  // One automatic reload per loaded file after a network error (transient
  // starvation right after opening; see onError).
  const netRetriedRef = useRef(false);
  // Pending automatic-reload timer, so unmount/file switch can cancel it.
  const retryTimerRef = useRef<number | null>(null);
  // Fire onPlayed only on the first play of each loaded file (not on every pause/resume).
  const playedRef = useRef(false);

  // Quantize frame times (round to at most ~200 distinct values across the bar for cache efficiency).
  const step = total ? Math.max(1, Math.round(total / 200)) : 1;
  const quantize = (t: number) => Math.round(t / step) * step;

  const startTimer = () => {
    if (timerRef.current != null) return;
    timerRef.current = window.setInterval(() => {
      if (desiredRef.current != null) setPreviewT(desiredRef.current);
    }, 100);
  };
  const stopTimer = () => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Reset all per-file playback state. Shared by the [id, src] change effect
  // and the reload button on the error screen. Deliberately leaves `playedRef`
  // alone: reloading the same file must not re-fire onPlayed.
  const resetPlaybackState = () => {
    setError(null);
    setOffset(0);
    setPosition(0);
    setPlaying(false);
    setLoaded(false);
    setNativeDur(null);
    setHover(null);
    setScrub(null);
    appliedStartRef.current = false;
    netRetriedRef.current = false;
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  useEffect(() => {
    // Resetting playback state when the file (id/src) changes is a legitimate prop-change initialization, so synchronous setState is allowed here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetPlaybackState();
    playedRef.current = false;
  }, [id, src]);

  useEffect(
    () => () => {
      stopTimer();
      if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  // Seek operation. Use currentTime if the target falls within a seekable range,
  // otherwise re-stream via ?t. Remuxed containers (mkv/avi/wmv/flv/ts) are piped
  // without Range support, so seekable only covers the buffered portion — checking
  // length > 0 isn't enough; the target time must actually be inside one of the ranges.
  const seek = (t: number) => {
    const v = ref.current;
    if (!v) return;
    let inSeekable = false;
    for (let i = 0; i < v.seekable.length; i++) {
      if (t >= v.seekable.start(i) && t <= v.seekable.end(i)) {
        inSeekable = true;
        break;
      }
    }
    if (isFinite(v.duration) && inSeekable) {
      v.currentTime = t;
    } else {
      // Stream: re-serve from the specified second.
      setOffset(t);
      setPosition(t);
      v.src = `${src}?t=${Math.floor(t)}`;
      v.load();
      void v.play().catch(() => {});
    }
  };

  // Expose seek so the parent (scene click) can call it. Via ref for closure freshness.
  const seekRef = useRef(seek);
  // Sync the latest seek into a ref (written after commit, not during render). Syncing every commit is equivalent to before.
  useEffect(() => {
    seekRef.current = seek;
  });
  // Stable, so the imperative handle below can just close over it.
  const togglePlay = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      seek: (t) => seekRef.current(t),
      pause: () => {
        ref.current?.pause();
      },
      togglePlay,
    }),
    [togglePlay],
  );

  // Mirror the play/pause state out so an external control bar can render it.
  // Read through a ref (the convention in this file) so a caller passing an
  // inline closure does not make this fire on each of its own renders — the
  // playlist player wakes its control bar from here, and that turned into a bar
  // that could never stay hidden.
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  });
  useEffect(() => {
    onPlayingChangeRef.current?.(playing);
  }, [playing]);

  // Relative skip (±seconds). Clamped to the total duration, based on the current position.
  const skip = (delta: number) => {
    const base = posRef.current;
    const max = totalRef.current;
    let t = base + delta;
    if (t < 0) t = 0;
    if (max && t > max) t = max;
    seekRef.current(t);
  };

  const toggleFullscreen = () => {
    const el = fullscreenTargetRef?.current ?? wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  };

  // Track fullscreen state so the video can fill the screen (the default max-h cap would otherwise leave black bars).
  // The fullscreen element may be an ancestor (fullscreenTargetRef), so containment is the check.
  useEffect(() => {
    const onFsChange = () => {
      const fs = document.fullscreenElement;
      setIsFullscreen(
        fs != null && wrapRef.current != null && fs.contains(wrapRef.current),
      );
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Keep paging chords fresh for the keydown closure (registered once).
  const navKeysRef = useRef(navKeys);
  // Sync the latest navKeys into a ref (written after commit, not during render). Syncing every commit is equivalent to before.
  useEffect(() => {
    navKeysRef.current = navKeys;
  });

  // Keyboard shortcuts. Disabled while a tag input or similar is focused.
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
      // Ignore modified combos (browser / Emacs-style shortcuts).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Yield keys claimed by file paging (e.g. Vim's "l") so they don't also seek.
      const nk = navKeysRef.current;
      if (matchAny(e, nk.prev) || matchAny(e, nk.next)) return;
      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(5);
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-5);
          break;
        case "KeyL":
          e.preventDefault();
          skip(10);
          break;
        case "KeyJ":
          e.preventDefault();
          skip(-10);
          break;
        case "KeyF":
          // Chromeless means the caller owns the frame, its fullscreen control
          // and therefore this key too; acting here as well would cancel it out.
          if (!chromeless) toggleFullscreen();
          break;
        case "KeyM":
          toggleMuted();
          break;
        case "ArrowUp":
          e.preventDefault();
          bumpVolume(VOLUME_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          bumpVolume(-VOLUME_STEP);
          break;
        case "Home":
        case "Digit0":
          e.preventDefault();
          seekRef.current(0);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // All handlers go through refs / stable references, so registering once is
    // enough; `chromeless` is a prop the handler reads directly, so it re-binds
    // on the rare occasion that changes.
  }, [togglePlay, chromeless]);

  // Event coordinates on the seek bar → {ratio, t}.
  // ratio is computed from getBoundingClientRect+clientX (consistent even under CSS zoom). Positioning
  // is done with % rather than px to avoid double-scaling from zoom.
  const posFromEvent = (
    e: React.PointerEvent,
  ): { ratio: number; t: number } | null => {
    const el = trackRef.current;
    if (!el || !total) return null;
    const r = el.getBoundingClientRect();
    const ratio = r.width
      ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      : 0;
    return { ratio, t: ratio * total };
  };

  const onTrackMove = (e: React.PointerEvent) => {
    const p = posFromEvent(e);
    if (!p) return;
    setHover(p);
    desiredRef.current = quantize(p.t);
    startTimer();
    if (draggingRef.current) setScrub(p.t);
  };

  const onTrackDown = (e: React.PointerEvent) => {
    const p = posFromEvent(e);
    if (!p) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrub(p.t);
    setHover(p);
    desiredRef.current = quantize(p.t);
    startTimer();
  };

  const onTrackUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const p = posFromEvent(e);
    if (p) seek(p.t);
    setScrub(null);
  };

  const onTrackLeave = () => {
    if (draggingRef.current) return;
    setHover(null);
    stopTimer();
  };

  // A caller that handles failures itself (the playlist player skips the item)
  // gets the message through onFatalError instead of the built-in panel. The
  // effect sits above the early return so the hook order stays unconditional.
  useEffect(() => {
    if (error && onFatalError) onFatalError(error);
  }, [error, onFatalError]);

  if (error && onFatalError) return null;

  if (error) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-surface p-8 text-center text-muted">
        <p>{t("player.playFailed")}</p>
        {/* Selectable: the raw codec / MediaError string belongs in bug reports. */}
        <p className="select-text text-xs">{error}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Remount the <video> (the error return unmounts it) with fully
              // reset per-file state and let autoplay kick in again.
              resetPlaybackState();
            }}
          >
            <RotateCcw />
            {t("player.reload")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            // Only report the launch once the main process confirms it: it
            // records the play (and consumes the Watch Later entry) there, and
            // can refuse for a file that has gone missing under the root.
            onClick={() =>
              void api
                .openExternal(id, wsId)
                .then(() => onOpenExternal?.())
                .catch((e: unknown) => log.error("open external", e))
            }
          >
            <ExternalLink />
            {t("player.openExternal")}
          </Button>
        </div>
      </div>
    );
  }

  const pct = total ? `${Math.min(100, (displayPos / total) * 100)}%` : "0%";
  const controlsVisible = !chromeless && loaded && (!playing || hover != null);
  const aspectRatio =
    width && height && width > 0 && height > 0
      ? `${width} / ${height}`
      : "16 / 9";

  // Bookmark toggle. If a bookmark exists within BOOKMARK_NEAR_EPS of the current display
  // position, the button removes it; otherwise it adds one at the current position.
  const showBookmarkButton = !!onAddBookmark && !!onRemoveBookmark;
  const nearBookmark = findNearestBookmark(bookmarks ?? [], displayPos);
  const onBookmarkToggle = () => {
    if (nearBookmark) onRemoveBookmark?.(nearBookmark.id);
    else onAddBookmark?.(Math.max(0, displayPos));
  };

  // Freeze playback before opening the save dialog: the exported position is
  // captured here, but letting the video run on behind the dialog would drift
  // away from the frame the user chose.
  const onExportClick = () => {
    ref.current?.pause();
    onExportFrame?.(Math.max(0, displayPos));
  };

  // The detail view boxes the video to its aspect ratio and caps it at 78vh so
  // the metadata below it stays on screen. Neither applies when the video is the
  // whole screen: the playlist player hands it the entire stage, and letterboxing
  // is the blurred backdrop's job, not a gap in the layout.
  const fillsParent = chromeless || isFullscreen;

  return (
    <div
      ref={wrapRef}
      className={`group relative flex w-full items-center justify-center overflow-hidden ${
        // Opaque on its own, but not in the playlist player: the stage there
        // already paints a blurred cover of this very file behind it, and black
        // here would hide it and turn the letterbox bars into flat gaps.
        chromeless ? "bg-transparent" : "bg-black"
      } ${
        fillsParent
          ? `${chromeless ? "h-full" : "h-screen"} rounded-none`
          : "max-h-[78vh] rounded-xl"
      }`}
      style={fillsParent ? undefined : { aspectRatio }}
    >
      {/* Skipped in the playlist player: the stage's blurred cover of this very
          file is already the placeholder, and a grey sheet over it would flash
          on every item change. */}
      {!loaded && !chromeless && (
        <Skeleton
          className="absolute inset-0 z-10 rounded-none bg-overlay"
          aria-hidden="true"
        />
      )}
      <video
        ref={ref}
        src={src}
        autoPlay={autoplay}
        className={`h-full w-full object-contain transition-opacity ${
          chromeless
            ? "max-h-full"
            : isFullscreen
              ? "max-h-screen"
              : "max-h-[78vh]"
        } ${loaded ? "opacity-100" : "opacity-0"}`}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          void api.fileRecordPlay(id, wsId, "browser", position);
          if (!playedRef.current) {
            playedRef.current = true;
            onPlayed();
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
        onVolumeChange={() => {
          const v = ref.current;
          if (v) syncFromElement(v.volume, v.muted);
        }}
        onLoadedMetadata={() => {
          const v = ref.current;
          if (!v) return;
          setLoaded(true);
          // Apply the shared volume/mute to this freshly-loaded element. The
          // effect above only fires when the value changes, so this is what
          // covers an element that is new rather than a value that is new.
          v.volume = volume;
          v.muted = muted;
          if (isFinite(v.duration)) {
            setNativeDur(v.duration);
            onNativeDuration(v.duration);
          }
          // Apply the initial seek (e.g. from a Discovery scene click) once.
          if (startAt > 0 && !appliedStartRef.current) {
            appliedStartRef.current = true;
            seekRef.current(startAt);
          }
        }}
        onTimeUpdate={() => {
          const v = ref.current;
          if (v) setPosition(offset + v.currentTime);
        }}
        onError={() => {
          const v = ref.current;
          const code = v?.error?.code;
          // MEDIA_ERR_ABORTED fires on normal load interruptions (src swap /
          // load() during seek), not on unplayable media — never fatal, and
          // not worth an error-level log entry either.
          if (code === MEDIA_ERR_ABORTED) {
            log.debug("video load aborted", { src });
            return;
          }
          log.error("video error", {
            src,
            currentSrc: v?.currentSrc,
            networkState: v?.networkState,
            code,
          });
          // A network error right after opening is often transient (the media
          // request can be starved while frame previews hold the origin's
          // connection slots) — reload once before surfacing the error. Only
          // before metadata has loaded: a mid-playback load() would silently
          // rewind Range-served files to the start.
          if (
            code === MEDIA_ERR_NETWORK &&
            v &&
            !loaded &&
            !netRetriedRef.current
          ) {
            netRetriedRef.current = true;
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              const cur = ref.current;
              if (!cur) return;
              // The element may have recovered on its own while the delay
              // elapsed — a forced load() would needlessly restart playback.
              if (cur.readyState >= cur.HAVE_METADATA) return;
              cur.load();
              // Reloading must not change playback intent: only resume when
              // the player was asked to autoplay in the first place.
              if (autoplay) void cur.play().catch(() => {});
            }, NETWORK_RETRY_DELAY_MS);
            return;
          }
          const map: Record<number, string> = {
            1: t("player.errAborted"),
            2: t("player.errNetwork"),
            3: t("player.errDecode"),
            4: t("player.errSrcNotSupported"),
          };
          setError(
            code
              ? (map[code] ?? t("player.errCode", { code }))
              : t("player.errUnknown"),
          );
        }}
      />

      {/* Center play/pause indicator (shown large while paused). */}
      {!chromeless && loaded && !playing && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
          title={t("player.play")}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70">
            <Play size={30} className="translate-x-0.5" />
          </span>
        </button>
      )}

      {/*
        Custom controls (with a frame preview at the hover position).
        Not rendered at all when chromeless: leaving it in the tree at
        opacity 0 would keep its buttons clickable and tab-reachable.
      */}
      {!chromeless && (
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-8 text-white transition-opacity ${
            controlsVisible ? "opacity-100" : "opacity-0"
          } group-hover:opacity-100`}
        >
          {/* Seek bar + preview. */}
          {/*
            The track doubles as the "measurement" surface and the positioning reference (offsetParent) for the thumb/preview.
            To widen the hit area, the track is made tall, while the visual bar is drawn thin in the center.
          */}
          <div
            ref={trackRef}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerLeave={onTrackLeave}
            className="group/bar relative flex h-5 w-full cursor-pointer items-center"
            title={total ? t("player.seek") : undefined}
          >
            {/* Visual bar + playback-position fill (thicker on hover) */}
            <div className="pointer-events-none h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/bar:h-1.5">
              <div
                className="h-full rounded-full bg-[var(--c-primary)]"
                style={{ width: pct }}
              />
            </div>
            {/* Thumb (relative to the track, % positioning is zoom-invariant) */}
            <div
              className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity ${
                hover || scrub != null ? "opacity-100" : "opacity-0"
              }`}
              style={{ left: hover ? `${hover.ratio * 100}%` : pct }}
            />
            {/* Frame preview at the hover position (relative to the track, shown above) */}
            {hover && total && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-3 flex -translate-x-1/2 flex-col items-center"
                // Clamp the preview overflow using the track's actual width. The DOM measurement
                // must be read during render, and turning it into state would shift the measurement
                // timing and change behavior, so the rule is suppressed here.
                style={{
                  // eslint-disable-next-line react-hooks/refs
                  left: `${clampPreview(hover.ratio, trackRef.current?.clientWidth ?? 0) * 100}%`,
                }}
              >
                <img
                  src={`${mediaBase}/ws/${wsId}/frame/${id}?t=${previewT ?? quantize(hover.t)}`}
                  alt=""
                  // max-w-none: cancels Tailwind preflight's img{max-width:100%}.
                  // Prevents the image from being squashed horizontally when the containing block's available width shrinks at later positions.
                  className="h-28 w-auto max-w-none rounded-md border border-white/30 bg-black shadow-lg"
                />
                <span className="mt-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums">
                  {fmtTime(hover.t)}
                </span>
              </div>
            )}
          </div>

          {/* Controls row. */}
          <div className="flex items-center gap-1 text-xs">
            <CtrlButton onClick={() => skip(-10)} title={t("player.back10")}>
              <SkipBack size={18} />
            </CtrlButton>
            <CtrlButton
              onClick={togglePlay}
              title={playing ? t("player.pauseKey") : t("player.playKey")}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </CtrlButton>
            <CtrlButton onClick={() => skip(10)} title={t("player.forward10")}>
              <SkipForward size={18} />
            </CtrlButton>
            {showBookmarkButton && (
              <CtrlButton
                onClick={onBookmarkToggle}
                disabled={bookmarkPending}
                title={
                  nearBookmark
                    ? t("player.bookmarkRemove", {
                        time: fmtTime(nearBookmark.sec),
                      })
                    : t("player.bookmarkAdd")
                }
              >
                {nearBookmark ? (
                  <BookmarkCheck
                    size={18}
                    className="fill-current text-[var(--c-primary)]"
                  />
                ) : (
                  <Bookmark size={18} />
                )}
              </CtrlButton>
            )}
            {onExportFrame && (
              <CtrlButton
                onClick={onExportClick}
                disabled={exportPending}
                title={t("player.exportFrame")}
              >
                <Camera size={18} />
              </CtrlButton>
            )}
            <span className="ml-1 tabular-nums">{fmtTime(displayPos)}</span>
            <span className="opacity-50">/</span>
            <span className="tabular-nums opacity-80">
              {total ? fmtTime(total) : "--:--"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <div className="group/vol flex items-center">
                <CtrlButton
                  onClick={toggleMuted}
                  title={muted ? t("player.unmute") : t("player.mute")}
                >
                  {muted || volume === 0 ? (
                    <VolumeX size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </CtrlButton>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={VOLUME_STEP}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-0 accent-[var(--c-primary)] opacity-0 transition-all group-hover/vol:ml-1 group-hover/vol:w-20 group-hover/vol:opacity-100"
                  title={t("player.volume")}
                />
              </div>
              <CtrlButton
                onClick={toggleFullscreen}
                title={t("player.fullscreen")}
              >
                <Maximize size={18} />
              </CtrlButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function CtrlButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center justify-center rounded-full p-1.5 text-white/90 transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white/90"
    >
      {children}
    </button>
  );
}

// Round the ratio with about 80px (layout) of margin so the preview doesn't overflow the bar edges too much.
function clampPreview(ratio: number, width: number): number {
  if (!width) return ratio;
  const margin = Math.min(0.45, 80 / width);
  return Math.min(1 - margin, Math.max(margin, ratio));
}
