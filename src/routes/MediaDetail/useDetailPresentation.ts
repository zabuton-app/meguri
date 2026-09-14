import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  MODAL_SIZE_KEY,
  PRESENTATION_KEY,
  type ModalSize,
  type Presentation,
} from "./MediaModal";

/**
 * How the detail view is shown: modal or side peek, the modal's size, and
 * whether its panel is full screen.
 *
 * Both the presentation and the modal size are remembered, so the view
 * reopens the way it was last left, and going peek → modal lands on the modal
 * size that was last chosen. The modal panel is the fullscreen target
 * (YouTube-style: video fills the screen, the rest of the detail content
 * scrolls below it).
 */
export function useDetailPresentation({
  kind,
}: {
  /** The file's kind once known; leaving full screen keys on it. */
  kind: string | undefined;
}) {
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "large",
    (raw) => (raw === "small" ? "small" : "large"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );
  const [presentation, setPresentation] = useLocalStorage<Presentation>(
    PRESENTATION_KEY,
    "modal",
    (raw) => (raw === "peek" ? "peek" : "modal"),
  );

  const modalRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () =>
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  // Exit fullscreen when prev/next lands on anything but a video: only the
  // video player has a fullscreen toggle, so staying fullscreen on an image or
  // an audio track would strand the user (Esc only). Keyed on the resolved
  // kind, not on !video alone, so the transient undefined while the next file
  // loads doesn't drop video→video fullscreen.
  useEffect(() => {
    if (
      kind != null &&
      kind !== "video" &&
      document.fullscreenElement === modalRef.current
    ) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [kind]);

  return {
    modalSize,
    toggleModalSize,
    presentation,
    setPresentation,
    isPeek: presentation === "peek",
    modalRef,
    isFullscreen,
  };
}
