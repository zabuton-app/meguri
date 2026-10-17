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
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  fitThumbnail,
  thumbnailPosition,
} from "./model/hoverThumbnail";
import type { FileNodeAttrs } from "./model/types";
import { useThumbVersions } from "./useThumbVersions";

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
    // The card's own size: it takes the thumbnail's shape once that is in.
    card.offsetWidth || THUMBNAIL_WIDTH,
    card.offsetHeight || THUMBNAIL_HEIGHT,
  );
  card.style.transform = `translate(${left}px, ${top}px)`;
}

interface Props {
  /** The file node under the pointer (one without a thumbnail shows
   *  nothing, until one is made for it); null hides the card. */
  node: FileNodeAttrs | null;
  /** The positioned box around the canvas, which the card is placed in. */
  box: RefObject<HTMLElement | null>;
}

export function GraphHoverThumbnail({ node, box }: Props) {
  const card = useRef<HTMLDivElement>(null);
  // Where the pointer last was in the box: known before a hover begins, so
  // the card appears in place rather than jumping there on the next move.
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const { thumbOf } = useThumbVersions();
  // Should the thumbnail be gone again by the hover, the picture fails to
  // load and nothing shows.
  const src = (node && thumbOf(node)?.url) ?? null;

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
    // The box changed size under a pointer at rest (the window, the side
    // peek): the card may no longer fit where it is.
    const resize = new ResizeObserver(() =>
      moveCard(el, card.current, pointer.current),
    );
    resize.observe(el);
    return () => {
      el.removeEventListener("pointermove", track, true);
      el.removeEventListener("pointerdown", track, true);
      resize.disconnect();
    };
  }, [box]);

  // The card mounts with the hover, after the move that led to it.
  useLayoutEffect(() => {
    if (src) moveCard(box.current, card.current, pointer.current);
  }, [src, box]);

  // Keyed by URL: each hover starts over, so one node's outcome (loaded, or
  // failed) is not taken for the next's, and a failure gets another try.
  return src ? (
    <Card
      key={src}
      ref={card}
      src={src}
      onResize={() => moveCard(box.current, card.current, pointer.current)}
    />
  ) : null;
}

function Card({
  src,
  ref,
  onResize,
}: {
  src: string;
  ref: RefObject<HTMLDivElement | null>;
  /** The card took the thumbnail's shape, so where it goes changed. */
  onResize: () => void;
}) {
  const [failed, setFailed] = useState(false);
  // The card's size once the picture is in: the picture's own shape, so no
  // margin shows around it.
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const resized = useRef(onResize);
  useEffect(() => {
    resized.current = onResize;
  });
  useLayoutEffect(() => {
    if (size) resized.current();
  }, [size]);
  if (failed) return null;
  return (
    <div
      ref={ref}
      data-slot="graph-hover-thumbnail"
      // Out of sight until the image is in: no empty frame for a thumbnail
      // that is slow, or gone. content-box, so the border goes around the
      // picture rather than into it.
      className="pointer-events-none absolute left-0 top-0 z-10 box-content overflow-hidden rounded-lg border border-border bg-surface shadow-lg transition-opacity"
      style={{
        width: size?.width ?? THUMBNAIL_WIDTH,
        height: size?.height ?? THUMBNAIL_HEIGHT,
        opacity: size ? 1 : 0,
      }}
    >
      {/* Decorative: the canvas already labels the node with the file name. */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) =>
          setSize(
            fitThumbnail(
              e.currentTarget.naturalWidth,
              e.currentTarget.naturalHeight,
            ),
          )
        }
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
