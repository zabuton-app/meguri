import { AUTO_META_NAMESPACES } from "@shared/tags";
import type { TagSummary } from "@/ipc/types";

export type TagSort = "name" | "count";

export function isTagSort(raw: string | null): raw is TagSort {
  return raw === "name" || raw === "count";
}

/** Case-insensitive match against the qualified name and the human-readable label. */
export function filterTags(
  tags: TagSummary[],
  query: string,
  label: (tag: TagSummary) => string,
): TagSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return tags;
  return tags.filter(
    (tag) =>
      tag.qualified.toLowerCase().includes(q) ||
      label(tag).toLowerCase().includes(q),
  );
}

export function sortTags(tags: TagSummary[], sort: TagSort): TagSummary[] {
  const byName = (a: TagSummary, b: TagSummary) =>
    a.qualified.toLowerCase().localeCompare(b.qualified.toLowerCase());
  return [...tags].sort(
    sort === "name"
      ? byName
      : (a, b) => b.fileCount - a.fileCount || byName(a, b),
  );
}

export interface TagGroup {
  namespace: string;
  tags: TagSummary[];
}

/**
 * Group by namespace: the user's own tags first, then the namespaces the
 * metadata classifier emits in their canonical order, then anything else
 * alphabetically. The trailing bucket matters — the namespace set is open, so a
 * group this build has never heard of must still land somewhere sensible.
 */
export function groupTagsByNamespace(tags: TagSummary[]): TagGroup[] {
  const byNs = new Map<string, TagSummary[]>();
  for (const tag of tags) {
    const arr = byNs.get(tag.namespace);
    if (arr) arr.push(tag);
    else byNs.set(tag.namespace, [tag]);
  }

  const order = ["", ...AUTO_META_NAMESPACES];
  const rest = [...byNs.keys()]
    .filter((ns) => !order.includes(ns))
    .sort((a, b) => a.localeCompare(b));

  return [...order, ...rest]
    .filter((ns) => byNs.has(ns))
    .map((ns) => ({ namespace: ns, tags: byNs.get(ns)! }));
}
