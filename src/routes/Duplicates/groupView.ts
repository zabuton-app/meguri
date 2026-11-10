// Filtering, ordering and per-group figures for the duplicates view. The
// server returns the groups sorted by reclaimable bytes; everything here runs
// on that list in the renderer.
import type { DuplicateGroup, FileRow, Kind } from "@/ipc/types";
import { fileNameOf } from "@/lib/relPath";

export type DuplicateKindFilter = "all" | Kind;
export type DuplicateSort = "reclaimable" | "size" | "count" | "added";

export const DUPLICATE_SORTS: readonly DuplicateSort[] = [
  "reclaimable",
  "size",
  "count",
  "added",
];

export function groupKey(group: DuplicateGroup): string {
  return `${group.contentHash}:${group.size}`;
}

/** Bytes freed by keeping one copy and removing the rest. */
export function reclaimableBytes(group: DuplicateGroup): number {
  return group.size * (group.files.length - 1);
}

/**
 * Width of a group's reclaimable-size bar, as a percentage of the largest
 * group's. Any group that frees space gets at least a sliver; one that frees
 * nothing (copies of an empty file) gets no bar.
 */
export function reclaimBarPercent(reclaim: number, max: number): number {
  if (reclaim <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((reclaim / max) * 100));
}

/** The name the group is shown under: its first copy's file name. */
export function groupName(group: DuplicateGroup): string {
  return fileNameOf(group.files[0].relPath);
}

function latestAdded(group: DuplicateGroup): number {
  return Math.max(...group.files.map((f) => f.addedAt));
}

export function visibleGroups(
  groups: readonly DuplicateGroup[],
  opts: { query: string; kind: DuplicateKindFilter; sort: DuplicateSort },
): DuplicateGroup[] {
  // Whitespace separates words that must all appear in one copy's path, in any
  // order, as in the main search box ("beach 2020" finds 2020/beach.mp4).
  const words = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = groups.filter(
    (g) =>
      // Grouping ignores the kind, so one group can hold an .mp4 and an .m4a
      // of the same bytes: match when any copy is of the kind.
      (opts.kind === "all" || g.files.some((f) => f.kind === opts.kind)) &&
      (words.length === 0 ||
        g.files.some((f) => {
          const path = f.relPath.toLowerCase();
          return words.every((w) => path.includes(w));
        })),
  );
  // Array.prototype.sort is stable, so ties keep the server's order.
  switch (opts.sort) {
    case "reclaimable":
      return list;
    case "size":
      return list.sort((a, b) => b.size - a.size);
    case "count":
      return list.sort((a, b) => b.files.length - a.files.length);
    case "added":
      return list.sort((a, b) => latestAdded(b) - latestAdded(a));
  }
}

/**
 * The copy that entered the index first, or null when no single copy did
 * (copies indexed by the same scan share their added time).
 */
export function oldestCopy(files: readonly FileRow[]): FileRow | null {
  let oldest: FileRow | null = null;
  let tie = false;
  for (const f of files) {
    if (!oldest || f.addedAt < oldest.addedAt) {
      oldest = f;
      tie = false;
    } else if (f.addedAt === oldest.addedAt) {
      tie = true;
    }
  }
  return tie ? null : oldest;
}
