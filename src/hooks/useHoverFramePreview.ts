// Hover scrub preview for video thumbnails: the pointer's horizontal position
// maps onto the video timeline and the frame at that time is shown
// (YouTube-seekbar-like).
//
// Frames come from the media server's `frame` endpoint and are requested
// sequentially (one in-flight image per hovered card) so a single hover never
// occupies more than one slot of the server-side ffmpeg semaphore.
import { useEffect, useRef, useState } from "react";

/** Delay before the first frame request, so sweeping the cursor across the list stays free. */
const DEFAULT_START_DELAY_MS = 300;
/** Approximate number of distinct timestamps across the video (cache-friendly quantization). */
const SCRUB_POINTS = 20;
/** Consecutive load failures before giving up until the next hover. */
const SCRUB_MAX_FAILURES = 5;
/** Videos shorter than this have no meaningful scrub range (always frame 0). */
const MIN_SCRUB_DURATION_SEC = 2;

/**
 * Map a 0..1 horizontal fraction to a quantized timestamp (seconds).
 * Quantizing to ~SCRUB_POINTS steps keeps repeated hovers hitting the
 * server's frame cache. Returns null for unusable durations.
 */
export function computeScrubTime(
  duration: number,
  fraction: number,
): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const f = Math.min(1, Math.max(0, fraction));
  const step = Math.max(1, Math.round(duration / SCRUB_POINTS));
  const t = Math.round((f * duration) / step) * step;
  // Stay strictly inside the video — seeking to the exact end yields no frame.
  return Math.min(Math.max(0, Math.floor(duration - 1)), t);
}

interface Options {
  enabled: boolean;
  /** Builds the media-server frame URL for a given time in seconds. */
  frameUrl: (t: number) => string;
  duration: number | null;
  /** Reset key — virtualized rows reuse mounted cards for different files. */
  fileId: number;
  startDelayMs?: number;
}

interface HoverFramePreview {
  /** Frame to overlay on the base thumbnail, or null to show the thumbnail as-is. */
  previewSrc: string | null;
  /** 0..1 pointer position for the seekbar-style indicator, or null while inactive. */
  scrubFraction: number | null;
  onMouseEnter: (e?: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

export function useHoverFramePreview({
  enabled,
  frameUrl,
  duration,
  fileId,
  startDelayMs = DEFAULT_START_DELAY_MS,
}: Options): HoverFramePreview {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef<HTMLImageElement | null>(null);
  // Latest wanted / currently displayed timestamps.
  const desiredRef = useRef<number | null>(null);
  const shownRef = useRef<number | null>(null);
  // Whether the start delay has elapsed for the current hover.
  const activeRef = useRef(false);
  const failuresRef = useRef(0);
  // Latest values readable from timer/onload callbacks without re-subscribing.
  const optsRef = useRef({ enabled, frameUrl, duration });
  optsRef.current = { enabled, frameUrl, duration };

  const stop = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (loadingRef.current) {
      loadingRef.current.onload = null;
      loadingRef.current.onerror = null;
      // Abort the in-flight load without hitting the network ("" would
      // resolve relative to the document URL and trigger a request).
      loadingRef.current.src = "data:,";
      loadingRef.current = null;
    }
    desiredRef.current = null;
    shownRef.current = null;
    activeRef.current = false;
    failuresRef.current = 0;
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Reset when the card is reused for another file, the feature is toggled
  // off, or the component unmounts.
  useEffect(() => {
    return () => {
      stopRef.current();
      setPreviewSrc(null);
      setScrubFraction(null);
    };
  }, [fileId, enabled]);

  /** Load the desired frame unless one is already in flight; chain until caught up. */
  const pump = () => {
    if (loadingRef.current) return;
    if (failuresRef.current >= SCRUB_MAX_FAILURES) return;
    const t = desiredRef.current;
    if (t == null || t === shownRef.current) return;
    const img = new Image();
    loadingRef.current = img;
    img.onload = () => {
      if (loadingRef.current !== img) return;
      loadingRef.current = null;
      failuresRef.current = 0;
      shownRef.current = t;
      setPreviewSrc(img.src);
      pump(); // the pointer may have moved on while this frame loaded
    };
    img.onerror = () => {
      // Give up on this timestamp; a later mousemove picks a new one.
      if (loadingRef.current !== img) return;
      loadingRef.current = null;
      failuresRef.current += 1;
    };
    img.src = optsRef.current.frameUrl(t);
  };

  /** Track the pointer: remember the wanted timestamp and the indicator fraction. */
  const updateScrub = (e: React.MouseEvent) => {
    const dur = optsRef.current.duration;
    if (dur == null || dur < MIN_SCRUB_DURATION_SEC) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    const t = computeScrubTime(dur, fraction);
    if (t == null) return;
    desiredRef.current = t;
    setScrubFraction(fraction);
  };

  const onMouseEnter = (e?: React.MouseEvent) => {
    const { enabled: on, duration: dur } = optsRef.current;
    if (!on || dur == null || dur < MIN_SCRUB_DURATION_SEC) return;
    stop();
    if (e) updateScrub(e);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      activeRef.current = true;
      pump();
    }, startDelayMs);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!optsRef.current.enabled) return;
    updateScrub(e);
    if (activeRef.current) pump();
  };

  const onMouseLeave = () => {
    stop();
    setPreviewSrc(null);
    setScrubFraction(null);
  };

  return { previewSrc, scrubFraction, onMouseEnter, onMouseMove, onMouseLeave };
}
