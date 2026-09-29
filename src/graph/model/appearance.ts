// How big nodes are and how faded things look, as in Obsidian's graph view.
import type { MediaGraph } from "./types";
import type { Visibility } from "./visibility";

/** What a node's size grows with: its links (Obsidian's default) or how
 *  often it was played or viewed (a tag: the plays of its files). */
export type SizeBy = "links" | "plays";

/**
 * The weight each visible node's size grows with: its visible links, or how
 * often it was played or viewed (a tag: the plays of the visible files it
 * links to), as Obsidian lets a caller weigh nodes by something else.
 */
export function nodeWeights(
  graph: MediaGraph,
  visibility: Visibility,
  by: SizeBy,
): Map<string, number> {
  switch (by) {
    case "links":
      return visibility.degree;
    case "plays":
      return playWeights(graph, visibility);
    default: {
      const never: never = by;
      return never;
    }
  }
}

function playWeights(
  graph: MediaGraph,
  visibility: Visibility,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of visibility.nodes) {
    const a = graph.getNodeAttributes(key);
    if (a.type === "file") {
      out.set(key, a.plays);
      continue;
    }
    let sum = 0;
    graph.forEachEdge(key, (edge, _attrs, s, t) => {
      if (!visibility.edges.has(edge)) return;
      const other = graph.getNodeAttributes(s === key ? t : s);
      if (other.type === "file") sum += other.plays;
    });
    out.set(key, sum);
  }
  return out;
}

/** Opacity of what is not next to the focused node. */
export const FADED = 0.2;
/** Gap between a node and the label under it, in graph units (drawn at
 *  √scale like the node). */
export const LABEL_GAP = 5;
/** How far the focused node's label moves down, in pixels. */
export const FOCUS_LABEL_DROP = 15;

/** A node's fill: files by kind, tags by whether they are generated. */
export function nodeFill(
  a: { type: "file"; fileKind: string } | { type: "tag"; auto: boolean },
  c: {
    video: string;
    image: string;
    audio: string;
    tag: string;
    autoTag: string;
  },
): string {
  if (a.type === "tag") return a.auto ? c.autoTag : c.tag;
  if (a.fileKind === "image") return c.image;
  if (a.fileKind === "audio") return c.audio;
  return c.video;
}

/** Label font size (px) for a node drawn `radiusPx` wide at `scale`:
 *  Obsidian's 14 + radius / 4 graph units, at √scale. */
export function labelFontPx(scale: number, radiusPx: number): number {
  return 14 * Math.sqrt(scale) + radiusPx / 4;
}

/** The focused node's label size: the same, but never smaller than at scale 1,
 *  so it stays readable however far out the view is. */
export function focusLabelFontPx(scale: number, radiusPx: number): number {
  const root = Math.sqrt(scale);
  return (14 + radiusPx / root / 4) * (scale < 1 ? 1 : root);
}

/** Label opacity at `scale` pixels per graph unit, as Obsidian fades labels:
 *  log2(scale) + 1 − the text fade setting, clamped to 0..1. */
export function textAlpha(scale: number, textFade: number): number {
  return Math.min(1, Math.max(0, Math.log2(scale) + 1 - textFade));
}

/** The node radius in graph units for a node with `links` visible links. */
export function nodeRadius(links: number, multiplier = 1): number {
  return multiplier * Math.min(30, Math.max(8, 3 * Math.sqrt(links + 1)));
}

/** [r, g, b] (0-255) of a hex or rgb() colour, or null. */
function rgbOf(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const h =
      hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).map(Number);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b];
  }
  return null;
}

/**
 * `color` drawn at `opacity` over `background`, as one opaque colour. WebGL
 * blends sigma's colours as premultiplied, so a translucent colour would
 * brighten rather than fade; on the view's solid background this is the
 * same picture. Colours it cannot read are returned as they are.
 */
export function fade(
  color: string,
  background: string,
  opacity: number,
): string {
  const fg = rgbOf(color);
  const bg = rgbOf(background);
  if (!fg || !bg) return color;
  const mix = fg.map((v, i) => Math.round(v * opacity + bg[i] * (1 - opacity)));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
