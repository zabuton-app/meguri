// What the inspector lists for a selected node.
import type { MediaGraph } from "./types";

export interface RelatedFile {
  key: string;
  label: string;
  /** Labels of the tags shared with the selection. */
  shared: string[];
  /** Strength shown as the bar: shared tags, plus the weight of direct links. */
  score: number;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function byScoreThenLabel(a: RelatedFile, b: RelatedFile): number {
  return b.score - a.score || collator.compare(a.label, b.label);
}

/**
 * Files that share a visible tag (or a direct visible link) with `fileKey`,
 * strongest first. Walks tag → files once per shared tag, so the cost is the
 * size of the neighbourhood, not of the graph — a hub tag costs its fan-out.
 */
export function relatedFiles(
  graph: MediaGraph,
  fileKey: string,
  visibleEdges: Set<string>,
): RelatedFile[] {
  const out = new Map<string, RelatedFile>();
  const entry = (key: string): RelatedFile => {
    let r = out.get(key);
    if (!r) {
      r = {
        key,
        label: graph.getNodeAttribute(key, "label"),
        shared: [],
        score: 0,
      };
      out.set(key, r);
    }
    return r;
  };
  graph.forEachEdge(fileKey, (edge, attrs, a, b) => {
    if (!visibleEdges.has(edge)) return;
    const other = a === fileKey ? b : a;
    const node = graph.getNodeAttributes(other);
    if (node.type === "file") {
      entry(other).score += attrs.weight;
      return;
    }
    graph.forEachEdge(other, (tagEdge, _attrs, ta, tb) => {
      if (!visibleEdges.has(tagEdge)) return;
      const file = ta === other ? tb : ta;
      if (file === fileKey) return;
      const r = entry(file);
      r.shared.push(node.label);
      r.score += 1;
    });
  });
  return [...out.values()].sort(byScoreThenLabel);
}

/** Files carrying a tag, by name. */
export function tagFiles(
  graph: MediaGraph,
  tagKey: string,
  visibleEdges: Set<string>,
): RelatedFile[] {
  const out: RelatedFile[] = [];
  graph.forEachEdge(tagKey, (edge, _attrs, a, b) => {
    if (!visibleEdges.has(edge)) return;
    const file = a === tagKey ? b : a;
    out.push({
      key: file,
      label: graph.getNodeAttribute(file, "label"),
      shared: [],
      score: 1,
    });
  });
  return out.sort((x, y) => collator.compare(x.label, y.label));
}

/** The most connected visible nodes. */
export function topHubs(
  visibleNodes: Set<string>,
  degree: Map<string, number>,
  n: number,
): { key: string; degree: number }[] {
  return [...visibleNodes]
    .map((key) => ({ key, degree: degree.get(key) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || (a.key < b.key ? -1 : 1))
    .slice(0, n);
}
