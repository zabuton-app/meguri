// Draws one pet state: steps through its frames and renders the current one
// as SVG rects (the same grid → rect conversion the preview page uses).
import { useEffect, useEffectEvent, useState } from "react";
import { useTheme } from "@/themes/ThemeProvider";
import { frameToRects, petRoleColor, type PetRect } from "./petRender";
import {
  PET_ANIMATIONS,
  PET_HEIGHT,
  PET_WIDTH,
  type PetFrame,
  type PetState,
} from "./petSprites";

// The frames are module constants, so each one is converted once.
const rectCache = new WeakMap<PetFrame, PetRect[]>();
function rectsOf(frame: PetFrame): PetRect[] {
  let rects = rectCache.get(frame);
  if (!rects) {
    rects = frameToRects(frame);
    rectCache.set(frame, rects);
  }
  return rects;
}

export interface PetSpriteProps {
  state: PetState;
  /** CSS px per sprite pixel. */
  scale: number;
  /** Hold the current frame (the pet is covered by a modal). */
  paused: boolean;
  /**
   * Reduced motion: show one frame per state instead of animating. A one-shot
   * state still reports done after the time its frames would have taken, so
   * whatever follows it keeps its timing.
   */
  still: boolean;
  /** A one-shot state played through. Never called for looping states. */
  onDone: () => void;
}

/**
 * Mount with a `key` that changes whenever the state (re)starts, so the
 * frames begin from the first one.
 */
export function PetSprite({
  state,
  scale,
  paused,
  still,
  onDone,
}: PetSpriteProps) {
  const { mode } = useTheme();
  const anim = PET_ANIMATIONS[state];
  const count = anim.frames.length;
  const [index, setIndex] = useState(0);
  const done = useEffectEvent(onDone);

  useEffect(() => {
    if (paused) return;
    if (anim.loop) {
      if (still) return;
      const id = setTimeout(() => setIndex((index + 1) % count), anim.frameMs);
      return () => clearTimeout(id);
    }
    if (still) {
      const id = setTimeout(done, count * anim.frameMs);
      return () => clearTimeout(id);
    }
    const id = setTimeout(
      () => (index === count - 1 ? done() : setIndex(index + 1)),
      anim.frameMs,
    );
    return () => clearTimeout(id);
  }, [anim, count, index, paused, still]);

  // Standing still, a one-shot shows where it ends up; a loop its first frame.
  const shown = still ? (anim.loop ? 0 : count - 1) : index;
  return (
    <svg
      viewBox={`0 0 ${PET_WIDTH} ${PET_HEIGHT}`}
      width={PET_WIDTH * scale}
      height={PET_HEIGHT * scale}
      shapeRendering="crispEdges"
      aria-hidden
      data-pet-state={state}
      data-pet-frame={shown}
      className="block"
    >
      {rectsOf(anim.frames[shown]).map((r) => (
        <rect
          key={`${r.x}:${r.y}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={1}
          fill={petRoleColor(r.role, mode)}
        />
      ))}
    </svg>
  );
}
