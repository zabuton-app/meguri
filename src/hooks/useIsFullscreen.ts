import { useEffect, useState, type RefObject } from "react";

/** Whether `ref`'s element is the one the document is showing full screen. */
export function useIsFullscreen(ref: RefObject<HTMLElement | null>): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);
  return isFullscreen;
}
