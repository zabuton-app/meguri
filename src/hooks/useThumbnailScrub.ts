import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHoverFramePreview } from "@/hooks/useHoverFramePreview";
import { scrubPreviewBounds } from "@/lib/scrubPreviewBounds";

type Mode = "normal" | "clean" | "enlarged";

function scrubMode(e: {
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Mode {
  return e.altKey ? (e.metaKey || e.ctrlKey ? "enlarged" : "clean") : "normal";
}

/**
 * Bind to the whole thumbnail, including its sibling controls. Key listeners
 * exist only while this surface is hovered, not once per mounted grid card.
 * Both views share the original, sequential frame loader.
 */
export function useThumbnailScrub(
  options: Parameters<typeof useHoverFramePreview>[0],
) {
  const ref = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<{
    fileId: number | string;
    mode: Mode;
    bounds: ReturnType<typeof scrubPreviewBounds>;
  } | null>(null);
  const isEnlarged =
    view?.fileId === options.fileId && view.mode === "enlarged";
  const frames = useHoverFramePreview({
    ...options,
    frameUrl: (t) => {
      const source = options.frameUrl(t);
      if (!isEnlarged) return source;
      const url = new URL(source, window.location.href);
      if (url.searchParams.get("q") !== "high")
        url.searchParams.set("q", "enlarged");
      return url.toString();
    },
  });
  const handlers = useRef(frames);
  useLayoutEffect(() => {
    handlers.current = frames;
  });
  const { enabled, fileId } = options;

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    const surface = node.closest<HTMLElement>("[data-scrub-surface]") ?? node;
    let hovering = false;
    let mode: Mode = "normal";
    const updateMode = (e: MouseEvent | KeyboardEvent) => {
      const next = scrubMode(e);
      if (next === mode) return;
      mode = next;
      setView({
        fileId,
        mode,
        bounds:
          mode === "enlarged"
            ? scrubPreviewBounds(surface.getBoundingClientRect(), {
                width: window.innerWidth,
                height: window.innerHeight,
              })
            : null,
      });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
      else updateMode(e);
    };
    const visibility = () => {
      if (document.hidden) leave();
    };
    const enter = (e: MouseEvent) => {
      hovering = true;
      updateMode(e);
      handlers.current.onMouseEnter({
        clientX: e.clientX,
        currentTarget: surface,
      });
      window.addEventListener("keydown", key);
      window.addEventListener("keyup", key);
      window.addEventListener("blur", leave);
      window.addEventListener("resize", leave);
      window.addEventListener("scroll", leave, true);
      document.addEventListener("visibilitychange", visibility);
    };
    const move = (e: MouseEvent) => {
      if (!hovering) return;
      updateMode(e);
      handlers.current.onMouseMove({
        clientX: e.clientX,
        currentTarget: surface,
      });
    };
    function leave() {
      hovering = false;
      mode = "normal";
      setView(null);
      handlers.current.onMouseLeave();
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
      window.removeEventListener("scroll", leave, true);
      document.removeEventListener("visibilitychange", visibility);
    }
    surface.addEventListener("mouseenter", enter);
    surface.addEventListener("mousemove", move);
    surface.addEventListener("mouseleave", leave);
    return () => {
      leave();
      surface.removeEventListener("mouseenter", enter);
      surface.removeEventListener("mousemove", move);
      surface.removeEventListener("mouseleave", leave);
    };
  }, [enabled, fileId]);

  const current = view?.fileId === fileId && enabled ? view : null;
  return {
    ref,
    previewSrc: frames.previewSrc,
    scrubFraction: frames.scrubFraction,
    clean: current != null && current.mode !== "normal",
    enlargedBounds: current?.bounds ?? null,
  };
}
