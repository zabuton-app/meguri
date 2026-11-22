// The comparison's keys. Esc is the frame's (DiscoverModal).
import { useEffect, useEffectEvent } from "react";
import { isTyping } from "@/lib/keyTarget";
import { MODES, type CompareMode } from "./modes";

export interface CompareKeyActions {
  setMode: (mode: CompareMode) => void;
  swap: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Space: switch the blink by hand; null when not blinking. */
  flip: (() => void) | null;
}

export function useCompareKeys(actions: CompareKeyActions) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    // The opacity slider keeps the focus after a drag; it takes no letters,
    // so the view's keys stay live over it.
    const range =
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === "range";
    if (isTyping() && !range) return;
    // 1, 2, ...: the modes in order.
    const mode = /^[1-9]$/.test(e.key) ? MODES[Number(e.key) - 1] : undefined;
    if (mode) actions.setMode(mode);
    else if (e.key === "s" || e.key === "S") actions.swap();
    else if (e.key === "0") actions.fit();
    else if (e.key === "+" || e.key === "=") actions.zoomIn();
    else if (e.key === "-") actions.zoomOut();
    else if (e.key === " " && actions.flip) actions.flip();
    else return;
    e.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
