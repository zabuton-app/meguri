// The thumbnail that follows the pointer while it rests on a file node (a
// video's poster frame, an image, an audio track's cover art). It sits over
// either canvas, so it tracks the pointer on the box around them rather than
// asking the canvas where the node is drawn.
//
// Not the `hoverPreview` preference's business: that one is the scrub
// preview over a video's thumbnail in the lists.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useAppStatus } from "@/hooks/useAppStatus";
import { events } from "@/ipc/client";
import { thumbUrl } from "@/lib/thumbUrl";
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  thumbnailPosition,
} from "./model/hoverThumbnail";
import type { FileNodeAttrs } from "./model/types";

function moveCard(
  box: HTMLElement | null,
  card: HTMLElement | null,
  pointer: { x: number; y: number } | null,
): void {
  if (!box || !card || !pointer) return;
  const { left, top } = thumbnailPosition(
    pointer.x,
    pointer.y,
    box.clientWidth,
    box.clientHeight,
  );
  card.style.transform = `translate(${left}px, ${top}px)`;
}

/** `thumb:done` events are gathered this long before they re-render the card. */
const VERSION_FLUSH_MS = 100;
const NO_VERSIONS: ReadonlyMap<string, number> = new Map();

/**
 * How many times each file's thumbnail was regenerated while the graph has
 * been open, keyed "<workspaceId>:<fileId>" (or the id alone when the event
 * names no workspace). The WebP is rewritten in place and served with a
 * max-age, so without a new URL a later hover would show the old picture.
 * Kept here rather than taken from Home's counter: only the card re-renders,
 * not the graph view, on every thumbnail a scan finishes.
 */
function useThumbVersions(): ReadonlyMap<string, number> {
  const [versions, setVersions] = useState(NO_VERSIONS);
  useEffect(() => {
    let pending = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The unlisten arrives a microtask after the subscription is live; a
    // cleanup that runs first must still take the subscription down.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        const key = event.workspaceId
          ? `${event.workspaceId}:${event.id}`
          : String(event.id);
        pending.set(key, (pending.get(key) ?? 0) + 1);
        // Dozens arrive per second during a scan: one update per window.
        timer ??= setTimeout(() => {
          timer = null;
          const batch = pending;
          pending = new Map();
          setVersions((prev) => {
            const next = new Map(prev);
            for (const [k, n] of batch) next.set(k, (next.get(k) ?? 0) + n);
            return next;
          });
        }, VERSION_FLUSH_MS);
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return versions;
}

interface Props {
  /** The file node under the pointer (one without a thumbnail shows
   *  nothing); null hides the card. */
  node: FileNodeAttrs | null;
  /** The positioned box around the canvas, which the card is placed in. */
  box: RefObject<HTMLElement | null>;
}

export function GraphHoverThumbnail({ node, box }: Props) {
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const card = useRef<HTMLDivElement>(null);
  // Where the pointer last was in the box: known before a hover begins, so
  // the card appears in place rather than jumping there on the next move.
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const versions = useThumbVersions();
  const src =
    node?.hasThumb === true
      ? thumbUrl(
          mediaBase,
          node.workspaceId,
          node.fileId,
          versions.get(`${node.workspaceId}:${node.fileId}`) ??
            versions.get(String(node.fileId)),
        )
      : null;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const track = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      moveCard(el, card.current, pointer.current);
    };
    // Capture phase, so it holds whatever a canvas does with the event on
    // its way up. A press too: a tap hovers a node without a move before it.
    el.addEventListener("pointermove", track, true);
    el.addEventListener("pointerdown", track, true);
    return () => {
      el.removeEventListener("pointermove", track, true);
      el.removeEventListener("pointerdown", track, true);
    };
  }, [box]);

  // The card mounts with the hover, after the move that led to it.
  useLayoutEffect(() => {
    if (src) moveCard(box.current, card.current, pointer.current);
  }, [src, box]);

  // Keyed by URL: each hover starts over, so one node's outcome (loaded, or
  // failed) is not taken for the next's, and a failure gets another try.
  return src ? <Card key={src} ref={card} src={src} /> : null;
}

function Card({
  src,
  ref,
}: {
  src: string;
  ref: RefObject<HTMLDivElement | null>;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  if (state === "failed") return null;
  return (
    <div
      ref={ref}
      data-slot="graph-hover-thumbnail"
      // Out of sight until the image is in: no empty frame for a thumbnail
      // that is slow, or gone.
      className="pointer-events-none absolute left-0 top-0 z-10 overflow-hidden rounded-lg border border-border bg-surface shadow-lg transition-opacity"
      style={{
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        opacity: state === "loaded" ? 1 : 0,
      }}
    >
      {/* Decorative: the canvas already labels the node with the file name. */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
