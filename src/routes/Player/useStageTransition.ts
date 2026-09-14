import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PlayerHandle } from "@/routes/MediaDetail/VideoPlayer";
import { captureStage, type StageSnapshot } from "./stageSnapshot";
import type { Leg } from "./transition";

interface LeavingStage {
  snapshot: StageSnapshot;
  dir: 1 | -1;
  leg: Leg;
}

/**
 * Item changes animate rather than cut. Two independent effects compose:
 * "fade" dissolves between the two items, "transition" slides one over the
 * other. Both need the outgoing item to stay on screen while the incoming one
 * arrives, so the swap happens immediately and the item that left is held as a
 * frozen still beside the live one — which keeps exactly one media element
 * playing at any moment.
 *
 * `stageKey` and `thumbSrc` describe what is on screen right now; they are
 * read at capture time through refs so the swap callback never goes stale.
 */
export function useStageTransition({
  rootRef,
  videoRef,
  transitionMs,
  stageKey,
  thumbSrc,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<PlayerHandle | null>;
  /** 0 disables the animation: the swap is a plain cut. */
  transitionMs: number;
  stageKey: string;
  thumbSrc: string | undefined;
}): {
  leaving: LeavingStage | null;
  transitionTo: (step: () => void, dir: 1 | -1) => void;
} {
  const [leaving, setLeaving] = useState<LeavingStage | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapFrame = useRef<number | null>(null);
  const stageKeyRef = useRef("");
  const thumbSrcRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    stageKeyRef.current = stageKey;
    thumbSrcRef.current = thumbSrc;
  });
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
        stageKeyRef.current,
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
    [transitionMs, clearSwapTimers, rootRef, videoRef],
  );

  return { leaving, transitionTo };
}
