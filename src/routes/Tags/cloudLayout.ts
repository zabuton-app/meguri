import type { TagSummary } from "@/ipc/types";
import { sortTags } from "./utils";

/** Tags drawn at once. Past this the small ones are unreadable specks anyway. */
export const CLOUD_MAX_TAGS = 150;
export const CLOUD_MIN_FONT = 12;
export const CLOUD_MAX_FONT = 46;

/**
 * The tags the cloud draws, most used first: pipeline-owned ones only on
 * request (every file carries a few, so they would drown the user's own), and
 * never one no live file carries.
 */
export function pickCloudTags(
  tags: TagSummary[],
  includeAuto: boolean,
): { tags: TagSummary[]; limited: boolean } {
  const candidates = sortTags(
    tags.filter(
      (tag) => tag.fileCount > 0 && (includeAuto || !tag.pipelineOwned),
    ),
    "count",
  );
  return {
    tags: candidates.slice(0, CLOUD_MAX_TAGS),
    limited: candidates.length > CLOUD_MAX_TAGS,
  };
}

/** Longest label drawn in full; the tooltip always carries the whole name. */
export const CLOUD_MAX_LABEL = 32;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The text drawn for a tag. Cut short because one very long name (names that
 * predate the length cap can run to a kilobyte) would otherwise set the width
 * of the whole cloud and shrink every other word with it.
 */
export function cloudLabel(qualified: string): string {
  // Cheap way out for nearly every name: graphemes never outnumber code units.
  if (qualified.length <= CLOUD_MAX_LABEL) return qualified;
  // By grapheme, not code point: a flag, a ZWJ emoji or a letter with combining
  // marks is one glyph on screen and must not be cut in the middle.
  const glyphs = Array.from(graphemes.segment(qualified), (g) => g.segment);
  return glyphs.length > CLOUD_MAX_LABEL
    ? `${glyphs.slice(0, CLOUD_MAX_LABEL - 1).join("")}…`
    : qualified;
}

/**
 * 0..1 position of `count` between the least and most used tag. Logarithmic:
 * usage is long-tailed, and a linear scale would leave one giant tag among
 * dozens pinned at the minimum size.
 */
export function cloudWeight(count: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  const lo = Math.log(min + 1);
  const w = (Math.log(count + 1) - lo) / (Math.log(max + 1) - lo);
  return Math.min(1, Math.max(0, w));
}

export function cloudFontSize(weight: number): number {
  return Math.round(
    CLOUD_MIN_FONT + (CLOUD_MAX_FONT - CLOUD_MIN_FONT) * weight,
  );
}

export interface CloudBox {
  width: number;
  height: number;
}

export interface CloudLayout {
  /** Top-left corner of each box, in input order, inside `width` x `height`. */
  positions: { x: number; y: number }[];
  width: number;
  height: number;
}

/** Breathing room kept between two words. */
const GAP = 2;
/** Radius gained per radian; the spiral's arms sit 2π times this apart. */
const SPIRAL_GAIN = 3;
/** Shortest distance walked along the spiral between two attempts. */
const SPIRAL_STEP = 6;

/**
 * Pack boxes around a centre, word-cloud style: each one walks an Archimedean
 * spiral outwards from the middle and settles on the first spot where it
 * touches nothing already placed. Pass the boxes largest first so the big words
 * take the middle. `aspect` (width / height) stretches the spiral so the cloud
 * roughly follows the shape of the area it is drawn in.
 */
export function layoutCloud(boxes: CloudBox[], aspect = 1): CloudLayout {
  const stretch = Math.min(3, Math.max(1, aspect));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (const box of boxes) {
    // A tall box cannot slot into a gap much smaller than itself, so it strides
    // further between attempts; without this a cloud of long, equally used
    // names costs several hundred milliseconds.
    const step = Math.max(SPIRAL_STEP, box.height / 2);
    let theta = 0;
    for (;;) {
      const r = SPIRAL_GAIN * theta;
      const x = r * Math.cos(theta) * stretch - box.width / 2;
      const y = r * Math.sin(theta) - box.height / 2;
      const free = placed.every(
        (p) =>
          x + box.width + GAP <= p.x ||
          p.x + p.w + GAP <= x ||
          y + box.height + GAP <= p.y ||
          p.y + p.h + GAP <= y,
      );
      if (free) {
        placed.push({ x, y, w: box.width, h: box.height });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + box.width);
        maxY = Math.max(maxY, y + box.height);
        break;
      }
      // Constant arc length per step, so the outer turns are searched as
      // densely as the inner ones.
      theta += step / Math.max(r, step);
    }
  }

  return {
    positions: placed.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    width: maxX - minX,
    height: maxY - minY,
  };
}
