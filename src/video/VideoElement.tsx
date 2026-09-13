// A <video> whose element can be handed from one host to the next (see
// videoHandOff.ts). Renders a hidden anchor and manages the element itself:
// on mount it adopts a parked element for the same source if a hand-off left
// one, and creates a fresh one otherwise; on unmount it parks the element when
// a hand-off is pending and tears it down when not. The element is inserted
// right after the anchor, so its parent and its place among siblings are
// exactly what a JSX <video> in that spot would have. Events are wired as
// native listeners, since React never owns the element.
import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import {
  destroyVideo,
  isSameSource,
  parkVideoForHandOff,
  takeHandedOffVideo,
} from "./videoHandOff";

/** The element events the player listens to, as native listeners. */
export interface VideoElementHandlers {
  onClick?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onVolumeChange?: () => void;
  onLoadedMetadata?: () => void;
  onTimeUpdate?: () => void;
  onSeeked?: () => void;
  onError?: () => void;
}

const EVENT_NAMES: Record<keyof VideoElementHandlers, string> = {
  onClick: "click",
  onPlay: "play",
  onPause: "pause",
  onEnded: "ended",
  onVolumeChange: "volumechange",
  onLoadedMetadata: "loadedmetadata",
  onTimeUpdate: "timeupdate",
  onSeeked: "seeked",
  onError: "error",
};

interface Props extends VideoElementHandlers {
  /** Receives the element while mounted (null once it has left). */
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  src: string;
  autoPlay: boolean;
  className: string;
  /** Called whenever the element is (re)attached, with whether it came from a
   *  hand-off: an adopted element is already loaded and possibly playing, and
   *  the host picks its state up instead of waiting for a load that will not
   *  happen. Stable across StrictMode's re-attach of the same element. */
  onAttach?: (el: HTMLVideoElement, adopted: boolean) => void;
}

type Listener = readonly [string, () => void];

export function VideoElement({
  videoRef,
  src,
  autoPlay,
  className,
  onAttach,
  ...handlers
}: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  // The element of this component instance. Survives StrictMode's effect
  // double-invoke (the cleanup below defers the teardown by a task, and the
  // re-run cancels it), so a mount costs one element and one load, as before.
  const elRef = useRef<HTMLVideoElement | null>(null);
  const listenersRef = useRef<Listener[]>([]);
  // Whether elRef's element was adopted from a hand-off (kept per element, so
  // a re-attach reports the same answer as the first attach did).
  const adoptedRef = useRef(false);
  const pendingTeardown = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest handlers, read at event time; the listeners themselves are attached
  // once per element.
  const handlersRef = useRef<VideoElementHandlers>(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  const classNameRef = useRef(className);
  useLayoutEffect(() => {
    classNameRef.current = className;
  });
  const onAttachRef = useRef(onAttach);
  useLayoutEffect(() => {
    onAttachRef.current = onAttach;
  });

  /** Put `el` in place after the anchor and wire it up as this host's element. */
  const attach = (el: HTMLVideoElement, adopted: boolean) => {
    const anchor = anchorRef.current;
    if (!anchor) {
      // Cannot happen (the anchor is committed before layout effects run),
      // but an adopted element with no host would otherwise play on unseen.
      destroyVideo(el);
      return;
    }
    el.className = classNameRef.current;
    anchor.after(el);
    listenersRef.current = (
      Object.keys(EVENT_NAMES) as (keyof VideoElementHandlers)[]
    ).map((key) => {
      const listener = () => handlersRef.current[key]?.();
      el.addEventListener(EVENT_NAMES[key], listener);
      return [EVENT_NAMES[key], listener] as const;
    });
    elRef.current = el;
    adoptedRef.current = adopted;
    videoRef.current = el;
    onAttachRef.current?.(el, adopted);
  };

  /** Unwire this host's element (it stays wherever it is in the DOM). */
  const detach = (el: HTMLVideoElement) => {
    for (const [name, listener] of listenersRef.current)
      el.removeEventListener(name, listener);
    listenersRef.current = [];
    videoRef.current = null;
  };

  // Mount / unmount. `src` and `autoPlay` are deliberately not dependencies —
  // changing the source of a mounted host is handled by the effect below.
  useLayoutEffect(() => {
    if (pendingTeardown.current != null) {
      clearTimeout(pendingTeardown.current);
      pendingTeardown.current = null;
    }
    let el = elRef.current;
    let adopted = adoptedRef.current;
    if (!el) {
      el = takeHandedOffVideo(src);
      adopted = el != null;
      if (!el) {
        el = document.createElement("video");
        el.autoplay = autoPlay;
        // Never an empty `src` attribute: unlike React (which drops the
        // attribute for ""), assigning "" starts a load that fails with
        // MEDIA_ERR_SRC_NOT_SUPPORTED — fatal to the player.
        if (src) el.src = src;
      }
    }
    attach(el, adopted);
    return () => {
      const current = elRef.current;
      if (!current) return;
      detach(current);
      if (parkVideoForHandOff(current)) {
        elRef.current = null;
        return;
      }
      // Out of the document now (a host that is gone must not leave a video
      // behind); stopped and released a task later, unless this same instance
      // re-attaches first (StrictMode), which re-inserts it in the same task —
      // and an element re-inserted within the task it was removed in never
      // pauses.
      current.remove();
      pendingTeardown.current = setTimeout(() => {
        pendingTeardown.current = null;
        if (elRef.current === current) {
          elRef.current = null;
          destroyVideo(current);
        }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  // Source and autoplay changes on a mounted host.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.autoplay = autoPlay;
    if (isSameSource(el, src)) return;
    // A host that mounted before its media origin was known has an element
    // with nothing in it yet; if the source it now gets is the one a hand-off
    // parked, take that element instead of loading a second copy of the file.
    if (!el.getAttribute("src")) {
      const handed = takeHandedOffVideo(src);
      if (handed) {
        detach(el);
        el.remove();
        attach(handed, true);
        return;
      }
    }
    if (src) el.src = src;
    else el.removeAttribute("src");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay]);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (el) el.className = className;
  }, [className]);

  return <span ref={anchorRef} hidden data-slot="video-anchor" />;
}
