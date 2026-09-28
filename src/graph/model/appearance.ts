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
