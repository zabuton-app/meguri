// The picture that follows the pointer while files are dragged out of the
// media views: the file's own thumbnail on a small card with its name, and a
// stack with a count when a whole selection is being carried.
//
// Without it Chromium draws its default for a dragged link — the title and
// URL in a chip — which says nothing about the file. Drawn on a canvas rather
// than built from DOM: setDragImage snapshots its element at once, and an
// <img> created for the occasion would not have decoded yet, whereas the
// card's already-loaded thumbnail can be painted straight away.

/** Thumbnail area of the card, CSS px (16:9, like the grid's tiles). */
const THUMB_W = 160;
const THUMB_H = 90;
/** Strip under the thumbnail that carries the file name. */
const CAPTION_H = 28;
const RADIUS = 8;
/** How far each card behind the front one peeks out, and how many do. */
const STACK_STEP = 5;
const STACK_MAX = 2;
/** Room around the card for the badge, which overhangs its corner. */
const MARGIN = 10;
const BADGE_H = 22;
const FONT_SIZE = 12;

export interface FileDragImage {
  /** The card's loaded thumbnail, or null when there is none to show. */
  thumb: HTMLImageElement | null;
  /** File name shown under the thumbnail. */
  name: string;
  /** Shown in place of a missing thumbnail (the extension, e.g. "MP3"). */
  placeholder: string;
  /** How many files the drag carries. */
  count: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a `width` × `height` source that fills a `boxW` × `boxH` box
 * without distortion (CSS `object-fit: cover`), centred.
 */
export function coverRect(
  width: number,
  height: number,
  boxW: number,
  boxH: number,
): Rect {
  const scale = Math.max(boxW / width, boxH / height);
  const w = boxW / scale;
  const h = boxH / scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/**
 * `text` cut to fit `maxWidth`, keeping the end as well as the start: the
 * tail of a file name (episode number, extension) is what tells files apart.
 */
export function ellipsizeMiddle(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  // Fewest characters dropped from the middle that makes it fit.
  for (let keep = chars.length - 1; keep >= 2; keep--) {
    const head = Math.ceil(keep / 2);
    const candidate = `${chars.slice(0, head).join("")}…${chars
      .slice(chars.length - (keep - head))
      .join("")}`;
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return "…";
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  { x, y, width, height }: Rect,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

/**
 * Draw the drag image, or null where a canvas cannot be drawn on (the caller
 * then leaves the browser's default in place).
 */
export function drawFileDragImage(
  image: FileDragImage,
): HTMLCanvasElement | null {
  const behind = Math.min(STACK_MAX, Math.max(0, image.count - 1));
  const cardW = THUMB_W;
  const cardH = THUMB_H + CAPTION_H;
  const width = cardW + behind * STACK_STEP + MARGIN * 2;
  const height = cardH + behind * STACK_STEP + MARGIN * 2;

  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    // No canvas support (some test environments throw rather than return null).
  }
  if (!ctx || typeof ctx.roundRect !== "function") return null;
  ctx.scale(ratio, ratio);

  const surface = token("--c-surface", "#2a2a2a");
  const overlay = token("--c-overlay", "#3a3a3a");
  const border = token("--c-border", "#555555");
  const fg = token("--c-fg", "#eeeeee");
  const muted = token("--c-muted", "#999999");
  const primary = token("--c-primary", "#7fa694");
  const onPrimary = token("--c-bg", "#1d2021");
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  // The cards behind, furthest first, so a selection reads as a stack.
  for (let i = behind; i >= 1; i--) {
    const rect = {
      x: MARGIN + i * STACK_STEP,
      y: MARGIN + i * STACK_STEP,
      width: cardW,
      height: cardH,
    };
    roundedRect(ctx, rect, RADIUS);
    ctx.fillStyle = overlay;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const card = { x: MARGIN, y: MARGIN, width: cardW, height: cardH };
  ctx.save();
  roundedRect(ctx, card, RADIUS);
  ctx.clip();
  ctx.fillStyle = surface;
  ctx.fillRect(card.x, card.y, card.width, card.height);
  const thumb = image.thumb;
  if (thumb && thumb.complete && thumb.naturalWidth > 0) {
    const src = coverRect(
      thumb.naturalWidth,
      thumb.naturalHeight,
      THUMB_W,
      THUMB_H,
    );
    ctx.drawImage(
      thumb,
      src.x,
      src.y,
      src.width,
      src.height,
      card.x,
      card.y,
      THUMB_W,
      THUMB_H,
    );
  } else {
    ctx.fillStyle = overlay;
    ctx.fillRect(card.x, card.y, THUMB_W, THUMB_H);
    ctx.fillStyle = muted;
    ctx.font = `600 20px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      image.placeholder,
      card.x + THUMB_W / 2,
      card.y + THUMB_H / 2,
      THUMB_W - 16,
    );
  }
  ctx.restore();

  ctx.fillStyle = fg;
  ctx.font = `500 ${FONT_SIZE}px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.fillText(
    ellipsizeMiddle(image.name, cardW - 16, measure),
    card.x + 8,
    card.y + THUMB_H + CAPTION_H / 2 + 1,
  );

  roundedRect(ctx, card, RADIUS);
  ctx.strokeStyle = primary;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (image.count > 1) {
    const label = String(image.count);
    ctx.font = `700 ${FONT_SIZE}px ${font}`;
    const badgeW = Math.max(BADGE_H, measure(label) + 12);
    const badge = {
      x: card.x + cardW - badgeW + MARGIN - 3,
      y: card.y - MARGIN + 3,
      width: badgeW,
      height: BADGE_H,
    };
    roundedRect(ctx, badge, BADGE_H / 2);
    ctx.fillStyle = primary;
    ctx.fill();
    ctx.fillStyle = onPrimary;
    ctx.textAlign = "center";
    ctx.fillText(
      label,
      badge.x + badge.width / 2,
      badge.y + badge.height / 2 + 1,
    );
  }
  return canvas;
}

/**
 * Use the drawn card as the drag image. Returns false when it could not be
 * drawn, so the caller can fall back.
 */
export function setFileDragImage(
  dt: DataTransfer,
  image: FileDragImage,
): boolean {
  const canvas = drawFileDragImage(image);
  if (!canvas) return false;
  // setDragImage needs the element in the document at the moment it is
  // called; it is snapshotted then and can be removed right after.
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  canvas.style.top = "0";
  document.body.appendChild(canvas);
  dt.setDragImage(canvas, 20, 20);
  setTimeout(() => canvas.remove(), 0);
  return true;
}
