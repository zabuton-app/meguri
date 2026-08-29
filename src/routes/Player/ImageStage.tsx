import { useEffect, useRef } from "react";
import {
  createKenBurnsSpec,
  kenBurnsKeyframes,
  staticTransform,
} from "./kenBurns";

// A still image on the playlist stage, with its own advance clock.
//
// With motion on, the clock IS the animation: the pan/zoom animation's own
// finish event advances the player, so the motion can never end early and leave
// a frozen image sitting there (spec SC-008), and pausing pauses that same
// object. With motion off — the user's choice, the OS reduce-motion setting, or
// an environment without the Web Animations API such as jsdom under test — a
// pausable timer takes over and keeps the timing contract identical.
export function ImageStage({
  src,
  alt,
  durationMs,
  paused,
  motion,
  onDone,
  onError,
}: {
  src: string;
  alt: string;
  durationMs: number;
  paused: boolean;
  /** False when the user or the OS asked for reduced motion (FR-025). */
  motion: boolean;
  onDone: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const animRef = useRef<Animation | null>(null);
  const timerRef = useRef<{
    id: ReturnType<typeof setTimeout> | null;
    remaining: number;
    startedAt: number;
  }>({ id: null, remaining: 0, startedAt: 0 });

  // Latest callback without restarting the clock when the parent re-renders.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // One clock per image. Keyed on src so each item gets a fresh draw.
  useEffect(() => {
    const el = ref.current;
    const timer = timerRef.current;
    const finish = () => onDoneRef.current();

    if (el && motion && typeof el.animate === "function") {
      const spec = createKenBurnsSpec(durationMs);
      const anim = el.animate(kenBurnsKeyframes(spec), {
        duration: spec.durationMs,
        easing: "linear",
        fill: "both",
      });
      anim.onfinish = finish;
      animRef.current = anim;
      return () => {
        anim.onfinish = null;
        anim.cancel();
        animRef.current = null;
      };
    }

    animRef.current = null;
    timer.remaining = durationMs;
    timer.startedAt = Date.now();
    timer.id = setTimeout(finish, durationMs);
    return () => {
      if (timer.id) clearTimeout(timer.id);
      timer.id = null;
    };
  }, [src, durationMs, motion]);

  // Pause and resume the one clock that is running.
  useEffect(() => {
    const anim = animRef.current;
    if (anim) {
      if (paused) anim.pause();
      else void anim.play();
      return;
    }
    const timer = timerRef.current;
    if (paused) {
      if (timer.id) {
        clearTimeout(timer.id);
        timer.id = null;
        timer.remaining = Math.max(
          0,
          timer.remaining - (Date.now() - timer.startedAt),
        );
      }
      return;
    }
    if (!timer.id && timer.remaining > 0) {
      timer.startedAt = Date.now();
      timer.id = setTimeout(() => onDoneRef.current(), timer.remaining);
    }
  }, [paused]);

  return (
    <img
      ref={ref}
      key={src}
      src={src}
      alt={alt}
      onError={onError}
      className="h-full w-full object-contain will-change-transform"
      style={{ transform: staticTransform() }}
    />
  );
}
