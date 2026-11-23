// Two images, one over the other, to see what differs between them (#638).
//
// B is placed where the alignment found it in A (align.worker.ts), so a crop
// or a resized copy lines up instead of turning the whole picture into
// "changed". The ways to look are in modes.ts. Zoom and pan are shared, so the
// same pixel of both stays under the cursor; they behave as the detail view's
// (usePanZoom.ts).
//
// The stage draws three layers at one transform: both whole images dimmed,
// then A and B each cut to where they overlap — the part the modes compare —
// and styled per mode.
//
// Not a route: it opens over the list from the selection bar and keeps the
// pair it opened with. Its frame is Discover's immersive modal.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowLeftRight,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePanZoom } from "@/hooks/usePanZoom";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { formatSize } from "@/lib/format";
import { mediaSrcOf } from "@/lib/mediaSrc";
import { fileNameOf } from "@/lib/relPath";
import { cn } from "@/lib/utils";
import type { FileRow } from "@/ipc/types";
import { ExperimentalBadge } from "@/components/ExperimentalBadge";
import { DiscoverModal } from "@/routes/Discover/DiscoverModal";
import {
  MODAL_SIZE_KEY,
  type ModalSize,
} from "@/routes/MediaDetail/MediaModal";
import {
  invert,
  overlapOf,
  placedSize,
  spanOf,
  UNPLACED,
  type Placement,
  type Rect,
  type Size,
} from "./geometry";
import { layerStyles, MODES, type CompareMode } from "./modes";
import { SplitHandle } from "./SplitHandle";
import { useAlignment, type AlignState } from "./useAlignment";
import { useCompareKeys } from "./useCompareKeys";

/** How bright the parts of the images outside their overlap are drawn. */
const CONTEXT_OPACITY = 0.35;
/** Below this match score the alignment is flagged as unreliable. */
const LOW_SCORE = 0.7;
/** How long each image shows in the blink mode. */
const BLINK_MS = 500;

const sizeOfRow = (row: FileRow): Size => ({
  width: row.width ?? 0,
  height: row.height ?? 0,
});

export function CompareView({
  rows,
  onClose,
}: {
  /** The two images, in the order they were selected. */
  rows: readonly [FileRow, FileRow];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const mediaBase = useAppStatus().data?.mediaBase ?? "";
  const srcs = rows.map((row) =>
    mediaBase ? mediaSrcOf(mediaBase, row.workspaceId, row.id) : "",
  );
  // Aligned once, in the selected order; a swap inverts the placement.
  const alignment = useAlignment(srcs[0], srcs[1]);

  // "large" fills the window; "small" is the centred panel. The size the
  // other immersive views (Discover, the player, the file details) share.
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "large",
    (raw) => (raw === "small" ? "small" : "large"),
  );
  const isSmall = modalSize === "small";

  const [mode, setMode] = useState<CompareMode>("slider");
  const [swapped, setSwapped] = useState(false);
  // Null until the user turns Align on or off: until then it follows the
  // match, on unless the score says the placement is likely wrong — a view
  // shifted by a bad offset hides the comparison it was opened for.
  const [alignChoice, setAlignChoice] = useState<boolean | null>(null);
  const [split, setSplit] = useState(0.5);
  const [opacity, setOpacity] = useState(0.5);
  const [blinkB, setBlinkB] = useState(false);
  // The decoded sizes, EXIF orientation applied — the row's may be the
  // sensor's. The row's stand in until the image has loaded.
  const [natural, setNatural] = useState<(Size | null)[]>([null, null]);

  const sizeOf = (i: number) => natural[i] ?? sizeOfRow(rows[i]);
  const onSize = (i: number) => (size: Size) =>
    setNatural((prev) => prev.map((s, j) => (j === i ? size : s)));

  const done = alignment.status === "done" ? alignment : null;
  // The placement found, for the A and B shown.
  const found: Placement | null = done
    ? swapped
      ? invert(done)
      : { dx: done.dx, dy: done.dy, scale: done.scale }
    : null;
  const lowScore = !!done && done.score < LOW_SCORE;
  const aligned = alignChoice ?? !lowScore;
  const placement = (aligned && found) || UNPLACED;

  const [ai, bi] = swapped ? [1, 0] : [0, 1];
  const sizeA = sizeOf(ai);
  const sizeB = sizeOf(bi);
  const box = spanOf(sizeA, sizeB, placement);
  const overlap = overlapOf(sizeA, sizeB, placement);
  // The box, zoomed and panned like the detail view's image: 100% is actual
  // pixels of A, and fit is the whole box.
  const zoom = usePanZoom({
    stageRef,
    content: { w: box.width, h: box.height },
  });
  const placed = zoom.placed;
  // Swapping makes the other image A, whose pixels the zoom counts in: with a
  // placement that scales B, the same zoom would show another magnification,
  // so the swap goes back to fit.
  const swap = () => {
    setSwapped((v) => !v);
    zoom.fit();
  };
  // Where each image is drawn, in A's pixels.
  const rectA: Rect = { x: 0, y: 0, ...sizeA };
  const rectB: Rect = {
    x: placement.dx,
    y: placement.dy,
    ...placedSize(sizeB, placement),
  };

  useEffect(() => {
    if (mode !== "blink" || reducedMotion) return;
    const id = setInterval(() => setBlinkB((v) => !v), BLINK_MS);
    return () => clearInterval(id);
  }, [mode, reducedMotion]);

  useCompareKeys({
    setMode,
    swap,
    fit: zoom.fit,
    zoomIn: zoom.zoomIn,
    zoomOut: zoom.zoomOut,
    flip: mode === "blink" ? () => setBlinkB((v) => !v) : null,
  });

  // The box where the view places it, at the shared zoom. Hidden until the
  // stage and the box have sizes, though its images still load.
  const boxStyle: CSSProperties = {
    width: box.width,
    height: box.height,
    transformOrigin: "0 0",
    transform: placed
      ? `translate(${placed.left}px, ${placed.top}px) scale(${zoom.zoom})`
      : undefined,
    visibility: placed ? undefined : "hidden",
    // Past 2x, show the pixels rather than smoothing them: a one-pixel
    // difference is what this view is for.
    imageRendering: zoom.zoom >= 2 ? "pixelated" : undefined,
  };
  const layers = layerStyles(mode, { split, opacity, blinkB });
  const image = (i: number, rect: Rect, toOverlap: boolean) => (
    <PlacedImage
      src={srcs[i]}
      rect={rect}
      box={box}
      clipPath={toOverlap ? clipTo(rect, overlap) : undefined}
      onSize={onSize(i)}
    />
  );
  const status = statusOf(t, alignment, found);

  return (
    <DiscoverModal onClose={onClose} size={modalSize} titleId={titleId}>
      <div data-slot="compare-panel" className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <h2
            id={titleId}
            className="mr-2 flex items-center gap-1.5 text-sm font-bold text-fg"
          >
            {t("compare.title")}
            <ExperimentalBadge />
          </h2>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            label={t("compare.mode")}
            slot="compare-mode"
            options={MODES.map((value) => ({
              value,
              label: t(`compare.mode.${value}`),
            }))}
          />
          {mode === "onion" && (
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              aria-label={t("compare.opacity")}
              title={t("compare.opacity")}
              className="w-32 accent-primary"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={swap}
            title={t("compare.swap")}
          >
            <ArrowLeftRight />
            {t("compare.swap")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={aligned}
            disabled={!done}
            onClick={() => setAlignChoice(!aligned)}
            className={cn(aligned && done && "bg-primary/15")}
            title={t("compare.alignHint")}
          >
            {t("compare.align")}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label={t("compare.zoomOut")} onClick={zoom.zoomOut}>
              <Minus />
            </IconButton>
            <span className="w-12 text-center text-xs tabular-nums text-muted">
              {zoom.percent}%
            </span>
            <IconButton label={t("compare.zoomIn")} onClick={zoom.zoomIn}>
              <Plus />
            </IconButton>
            <IconButton label={t("compare.fit")} onClick={zoom.fit}>
              <Maximize />
            </IconButton>
            <IconButton
              label={
                isSmall ? t("media.modalMaximize") : t("media.modalMinimize")
              }
              onClick={() => setModalSize(isSmall ? "large" : "small")}
            >
              {isSmall ? <Maximize2 /> : <Minimize2 />}
            </IconButton>
            <IconButton label={t("common.close")} onClick={onClose}>
              <X />
            </IconButton>
          </div>
        </div>

        <div
          ref={stageRef}
          data-slot="compare-stage"
          className={cn(
            "relative min-h-0 flex-1 touch-none overflow-hidden bg-black [isolation:isolate]",
            zoom.zoomed && (zoom.dragging ? "cursor-grabbing" : "cursor-grab"),
          )}
          {...zoom.panHandlers}
          onDoubleClick={(e) => zoom.toggle({ x: e.clientX, y: e.clientY })}
        >
          <StageLayer
            slot="compare-context"
            style={{ opacity: CONTEXT_OPACITY }}
            boxStyle={boxStyle}
          >
            {image(ai, rectA, false)}
            {image(bi, rectB, false)}
          </StageLayer>
          <StageLayer
            slot="compare-layer-a"
            style={layers.a}
            boxStyle={boxStyle}
          >
            {image(ai, rectA, true)}
          </StageLayer>
          <StageLayer
            slot="compare-layer-b"
            style={layers.b}
            boxStyle={boxStyle}
          >
            {image(bi, rectB, true)}
          </StageLayer>

          {mode === "slider" && (
            <SplitHandle split={split} onSplit={setSplit} stageRef={stageRef} />
          )}
          {(mode === "slider" || mode === "blink") && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-between text-xs font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
              {mode === "slider" ? (
                <>
                  <span>A</span>
                  <span>B</span>
                </>
              ) : (
                <span data-slot="compare-blink-label">
                  {blinkB ? "B" : "A"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border px-3 py-2">
          <ImageInfo label="A" row={rows[ai]} size={sizeA} />
          <ImageInfo label="B" row={rows[bi]} size={sizeB} />
          <span
            data-slot="compare-status"
            className={cn(
              "ml-auto text-xs tabular-nums",
              lowScore || alignment.status === "error"
                ? "text-warn"
                : "text-muted",
            )}
          >
            {status}
            {lowScore && ` — ${t("compare.lowScore")}`}
          </span>
        </div>
      </div>
    </DiscoverModal>
  );
}

/**
 * A clip-path that cuts an image drawn at `rect` to `keep`: nothing is left
 * when there is no overlap, and nothing is cut while the size is unknown.
 */
function clipTo(rect: Rect, keep: Rect | null): string | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  if (!keep) return "inset(50%)";
  const top = keep.y - rect.y;
  const right = rect.x + rect.width - (keep.x + keep.width);
  const bottom = rect.y + rect.height - (keep.y + keep.height);
  const left = keep.x - rect.x;
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The status line: the placement and its score, or how the search is going. */
function statusOf(
  t: TFunc,
  alignment: AlignState,
  found: Placement | null,
): string {
  if (alignment.status === "done" && found) {
    const result = t("compare.alignResult", {
      dx: signed(found.dx),
      dy: signed(found.dy),
      // A correlation of the two images' edges, not their colours; below 0
      // (edges where the other has none) is no match at all.
      score: Math.round(Math.max(0, alignment.score) * 100),
    });
    return found.scale === 1
      ? result
      : `${result} · ${t("compare.alignScale", { scale: found.scale.toFixed(2) })}`;
  }
  if (alignment.status === "error") return t("compare.alignFailed");
  return t("compare.aligning", {
    percent:
      alignment.status === "matching"
        ? Math.round(alignment.fraction * 100)
        : 0,
  });
}

/** One image at `rect` in A's pixels, inside the stage's box. */
function PlacedImage({
  src,
  rect,
  box,
  clipPath,
  onSize,
}: {
  src: string;
  rect: Rect;
  box: Rect;
  clipPath?: string;
  /** Hears the decoded size. */
  onSize: (size: Size) => void;
}) {
  return (
    <img
      src={src || undefined}
      alt=""
      draggable={false}
      onLoad={(e) =>
        onSize({
          width: e.currentTarget.naturalWidth,
          height: e.currentTarget.naturalHeight,
        })
      }
      className="absolute max-w-none select-none"
      style={{
        left: rect.x - box.x,
        top: rect.y - box.y,
        width: rect.width || undefined,
        height: rect.height || undefined,
        clipPath,
      }}
    />
  );
}

/** A layer of the stage: the box at the shared transform, styled per mode. */
function StageLayer({
  slot,
  style,
  boxStyle,
  children,
}: {
  slot: string;
  style: CSSProperties;
  boxStyle: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0" data-slot={slot} style={style}>
      <div className="absolute left-0 top-0" style={boxStyle}>
        {children}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

/** A file's name, size and pixel size, under its letter. */
function ImageInfo({
  label,
  row,
  size,
}: {
  label: string;
  row: FileRow;
  size: Size;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-item bg-primary text-2xs font-bold text-primary-foreground">
        {label}
      </span>
      <span className="truncate text-fg" title={row.relPath}>
        {fileNameOf(row.relPath)}
      </span>
      <span className="shrink-0 tabular-nums text-muted">
        {[
          formatSize(row.size),
          size.width && size.height ? `${size.width}×${size.height}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}
