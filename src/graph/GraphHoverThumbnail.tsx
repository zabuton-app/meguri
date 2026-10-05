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
  fitThumbnail,
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
    // The card's own size: it takes the thumbnail's shape once that is in.
    card.offsetWidth || THUMBNAIL_WIDTH,
    card.offsetHeight || THUMBNAIL_HEIGHT,
  );
  card.style.transform = `translate(${left}px, ${top}px)`;
}

/** `thumb:done` events are gathered this long before they re-render the card. */
const VERSION_FLUSH_MS = 100;

// The last cache buster handed out. Each is larger than any before it, in
// this run of the app or an earlier one (the HTTP cache outlives both a
// remount of the view and a restart).
let lastVersion = 0;
function nextVersion(): number {
  lastVersion = Math.max(lastVersion + 1, Date.now());
  return lastVersion;
}

interface ThumbVersions {
  /** The cache buster for a file's thumbnail URL. */
  versionOf: (workspaceId: string, fileId: number) => number;
  /** A `thumb:done` came in for the file since the view was mounted. */
  generated: (workspaceId: string, fileId: number) => boolean;
}

/**
 * The WebP is rewritten in place when a thumbnail is regenerated, and served
 * with a max-age, so the URL has to change for the new picture to show.
 * Every mount starts from a version of its own: the view cannot know what
 * was regenerated while it was away (a 2D / 3D switch remounts it, and so
 * does a visit to the list). A file regenerated since then, by `thumb:done`,
 * gets a newer one, keyed "<workspaceId>:<fileId>" (or the id alone when the
 * event names no workspace). The event also means a file now exists behind
 * the slot: the graph's payload is not read again as a scan fills
 * thumbnails in, so a file drawn before its thumbnail was made would
 * otherwise never show one.
 * Kept here rather than taken from Home's counter: only the card re-renders,
 * not the graph view, on every thumbnail a scan finishes.
 */
function useThumbVersions(): ThumbVersions {
  const [mounted] = useState(nextVersion);
  const [regenerated, setRegenerated] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  useEffect(() => {
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The unlisten arrives a microtask after the subscription is live; a
    // cleanup that runs first must still take the subscription down.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        pending.add(
          event.workspaceId
            ? `${event.workspaceId}:${event.id}`
            : String(event.id),
        );
        // Dozens arrive per second during a scan: one update per window.
        timer ??= setTimeout(() => {
          timer = null;
          const batch = pending;
          pending = new Set();
          const version = nextVersion();
          setRegenerated((prev) => {
            const next = new Map(prev);
            for (const key of batch) next.set(key, version);
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
  // The newer of the two: an event may name the workspace or not.
  const since = (workspaceId: string, fileId: number) =>
    Math.max(
      regenerated.get(`${workspaceId}:${fileId}`) ?? 0,
      regenerated.get(String(fileId)) ?? 0,
    );
  return {
    versionOf: (workspaceId, fileId) =>
      Math.max(mounted, since(workspaceId, fileId)),
    generated: (workspaceId, fileId) => since(workspaceId, fileId) > 0,
  };
}

interface Props {
  /** The file node under the pointer (one without a thumbnail shows
   *  nothing, until one is made for it); null hides the card. */
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

  const { versionOf, generated } = useThumbVersions();
  // `thumb:done` is only sent once a thumbnail file was written. Should it
  // be gone again by the hover, the picture fails to load and nothing shows.
  const src =
    node && (node.hasThumb || generated(node.workspaceId, node.fileId))
      ? thumbUrl(
          mediaBase,
          node.workspaceId,
          node.fileId,
          versionOf(node.workspaceId, node.fileId),
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
