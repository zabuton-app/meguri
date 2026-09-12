// One-shot radial particle burst for favorite/rating micro-interactions.
// Purely decorative: aria-hidden, pointer-events-none, absolutely positioned so
// it never affects layout or the accessibility tree. The parent element must be
// position:relative. Restart is handled by the caller remounting via `key`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Fixed angles (no randomness) keep the effect deterministic for tests.
const PARTICLE_ANGLES = [0, 60, 120, 180, 240, 300];
// Safety net in case animationend never fires (e.g. reduced-motion CSS layer).
const FALLBACK_MS = 1000;

interface Props {
  /** Tailwind text color class the particles inherit via currentColor. */
  colorClass?: string;
  /** Icon size the burst scales around (particle travel ≈ 1.2×). */
  sizePx?: number;
  /** Delay before the burst starts (used to sync with a star's staggered pop). */
  delayMs?: number;
  /** Called once when the burst has finished (animationend or timeout). */
  onDone?: () => void;
}

export function BurstEffect({
  colorClass,
  sizePx = 16,
  delayMs = 0,
  onDone,
}: Props) {
  const [visible, setVisible] = useState(true);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setVisible(false);
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    const t = setTimeout(finish, delayMs + FALLBACK_MS);
    return () => clearTimeout(t);
  }, [finish, delayMs]);

  if (!visible) return null;

  const particleSize = Math.max(3, Math.round(sizePx * 0.2));
  const radius = Math.round(sizePx * 1.2);

  return (
    <span
      aria-hidden="true"
      data-testid="fx-burst"
      onAnimationEnd={finish}
      className={cn(
        "fx-overlay pointer-events-none absolute inset-0 flex items-center justify-center",
        colorClass,
      )}
    >
      {PARTICLE_ANGLES.map((angle) => (
        <span
          key={angle}
          className="fx-particle absolute rounded-full bg-current"
          style={
            {
              width: particleSize,
              height: particleSize,
              animationDelay: delayMs > 0 ? `${delayMs}ms` : undefined,
              "--fx-angle": `${angle}deg`,
              "--fx-radius": `${radius}px`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
