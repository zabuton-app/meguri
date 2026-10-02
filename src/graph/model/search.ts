// Candidates for the graph's own search box.
import type { MediaGraph } from "./types";

export interface SearchHit {
  key: string;
  label: string;
  type: "file" | "tag";
}

/** Width- and case-folded, so "ＭＵＧＩ" finds "mugi". */
export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

export function searchNodes(
  graph: MediaGraph,
  text: string,
  visible: Set<string>,
  degree: Map<string, number>,
  limit = 20,
): SearchHit[] {
  const needle = normalize(text.trim());
  if (!needle) return [];
  const hits: { hit: SearchHit; prefix: boolean; degree: number }[] = [];
  for (const key of visible) {
    const attrs = graph.getNodeAttributes(key);
    const label = normalize(attrs.label);
    const at = label.indexOf(needle);
    if (at < 0) continue;
    hits.push({
      hit: { key, label: attrs.label, type: attrs.type },
      prefix: at === 0,
      degree: degree.get(key) ?? 0,
    });
  }
  return hits
    .sort(
      (a, b) =>
        Number(b.prefix) - Number(a.prefix) ||
        b.degree - a.degree ||
        a.hit.label.localeCompare(b.hit.label),
    )
    .slice(0, limit)
    .map((h) => h.hit);
}
