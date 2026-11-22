import { useRef, useState, type RefObject } from "react";
import {
  readSubtitlePosition,
  saveSubtitlePosition,
  type SubtitlePosition,
} from "@/lib/subtitlePreference";
import { DRAG_THRESHOLD_PX } from "./useVideoZoom";

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
        e.currentTarget.setPointerCapture(e.pointerId);
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

// An offset as a fraction of the room to move in; centred when there is none.
function along(offset: number, room: number): number {
  return room > 0 ? Math.min(1, Math.max(0, offset / room)) : 0.5;
}
