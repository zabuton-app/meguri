import { useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  readSubtitlePosition,
  saveSubtitlePosition,
  type SubtitlePosition,
} from "@/lib/subtitlePreference";
// The same threshold as panning a zoomed video: a press on the captions that
// hardly moves still plays or pauses, as one on the picture does.
import { DRAG_THRESHOLD_PX } from "@/hooks/usePanZoom";

// Dragging the captions to another place in the player (#377). The position is
// a fraction of the room left around them in `areaRef`, so they stay inside it
// whatever its size and theirs; see SubtitlePosition.
export function useSubtitleDrag(areaRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState(readSubtitlePosition);
  const positionRef = useRef(position);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    // Where the captions' box started, in client pixels.
    left: number;
    top: number;
    dragging: boolean;
  } | null>(null);
  // Whether the last press dragged, so the click it ends in does not also
  // play or pause. Cleared by the next press.
  const draggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const place = (next: SubtitlePosition | null) => {
    positionRef.current = next;
    setPosition(next);
  };

  const endDrag = () => {
    if (press.current?.dragging) saveSubtitlePosition(positionRef.current);
    press.current = null;
    setDragging(false);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      draggedRef.current = false;
      if (e.button !== 0) return;
      // No text selection while dragging. The click still arrives.
      e.preventDefault();
      // Captured from the press on: the box is small, and a quick move can
      // leave it before the threshold is crossed.
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = e.currentTarget.getBoundingClientRect();
      press.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: box.left,
        top: box.top,
        dragging: false,
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = press.current;
      if (!d || d.id !== e.pointerId) return;
      // The button is up although no pointerup arrived here.
      if (!(e.buttons & 1)) {
        endDrag();
        return;
      }
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.dragging) {
        // Below the threshold it is still a click, which plays or pauses.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        d.dragging = true;
        draggedRef.current = true;
        setDragging(true);
      }
      const area = areaRef.current?.getBoundingClientRect();
      if (!area?.width || !area.height) return;
      const box = e.currentTarget.getBoundingClientRect();
      place({
        x: along(d.left + dx - area.left, area.width - box.width),
        y: along(d.top + dy - area.top, area.height - box.height),
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id === e.pointerId) endDrag();
    },
    onLostPointerCapture: endDrag,
    onPointerCancel: endDrag,
  };

  return {
    /** Null at the default place above the control bar. */
    position,
    /** Places the captions' box at `position` inside the area. */
    style: captionStyle(position ?? DEFAULT_PLACE),
    /** While true, the captions' box must stay mounted, even between cues:
     *  it holds the pointer capture. */
    dragging,
    /** Whether the click that ends the current press was a drag. */
    dragged: () => draggedRef.current,
    reset: () => {
      place(null);
      saveSubtitlePosition(null);
    },
    handlers,
  };
}

// Centred along the bottom of the area, where the captions start out.
const DEFAULT_PLACE = { x: 0.5, y: 1 };

// Moving the box by its own size as well as the area's keeps it inside the
// area at every fraction, without measuring either. `along` is the inverse.
function captionStyle({ x, y }: SubtitlePosition): CSSProperties {
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: `translate(${-x * 100}%, ${-y * 100}%)`,
  };
}

// An offset as a fraction of the room to move in; centred when there is none.
function along(offset: number, room: number): number {
  return room > 0 ? Math.min(1, Math.max(0, offset / room)) : 0.5;
}
