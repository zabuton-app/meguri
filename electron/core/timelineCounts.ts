// Builds the timeline's payload for one query over one or more workspaces:
// per-day file counts, summed across them.
import type {
  TimelineAxis,
  TimelineCounts,
} from "../../shared/ipc/timeline.js";
import type { CoreTarget, FileRef } from "./crossWorkspace.js";
import { timelineCounts } from "./queries.js";
import type { SearchQuery } from "./types.js";

export interface TimelineCountsOptions {
  axis: TimelineAxis;
  /** Restrict to these files (a collection, or the duplicates filter). */
  refs?: FileRef[];
}

export function buildTimelineCounts(
  cores: CoreTarget[],
  query: SearchQuery,
  opts: TimelineCountsOptions,
): TimelineCounts {
  const { axis, refs } = opts;
  let idsByWs: Map<string, number[]> | null = null;
  if (refs) {
    idsByWs = new Map();
    for (const ref of refs) {
      const ids = idsByWs.get(ref.workspaceId) ?? [];
      ids.push(ref.fileId);
      idsByWs.set(ref.workspaceId, ids);
    }
  }
  const totals = new Map<string, number>();
  let undated = 0;
  for (const target of cores) {
    const ids = idsByWs?.get(target.id);
    if (idsByWs && !ids) continue;
    const q = ids ? { ...query, fileIds: ids } : query;
    const counts = timelineCounts(target.core.db, q, axis);
    undated += counts.undated;
    for (const [day, count] of counts.days)
      totals.set(day, (totals.get(day) ?? 0) + count);
  }
  return {
    // "YYYY-MM-DD" sorts as text the way the days do in time.
    days: [...totals]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
    undated,
  };
}
