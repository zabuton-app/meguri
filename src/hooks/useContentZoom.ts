// Zoom the in-window content with Ctrl+wheel / Ctrl +,-,0.
// Uses Electron's webFrame native zoom (unlike CSS zoom, it doesn't break coordinate
// calculations such as getBoundingClientRect, pointer coordinates, or Radix popup positions). The factor is persisted to localStorage.
import { useEffect } from "react";

const LS_KEY = "meguri.zoom";
const MIN = 0.5;
const MAX = 3.0;
const STEP = 1.1;

function clamp(z: number): number {
  return Math.min(MAX, Math.max(MIN, z));
}

function apply(z: number) {
  window.api?.setZoomFactor?.(z);
}

export function useContentZoom() {
  useEffect(() => {
    // Reading localStorage can throw (private browsing / disabled storage), not
    // just return a bad value; guard it so the wheel/key listeners still register.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LS_KEY);
    } catch {
      // ignore
    }
    let zoom = clamp(parseFloat(stored || "1") || 1);
    apply(zoom);

    const save = () => {
      try {
        localStorage.setItem(LS_KEY, String(zoom));
      } catch {
        // ignore
      }
    };

    const setZoom = (z: number) => {
      zoom = clamp(z);
      apply(zoom);
      save();
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Suppress the webview's default page zoom and unify on our own zoom.
      e.preventDefault();
      setZoom(e.deltaY < 0 ? zoom * STEP : zoom / STEP);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom(zoom * STEP);
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom(zoom / STEP);
      }
    };

    // passive:false to allow preventDefault.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
