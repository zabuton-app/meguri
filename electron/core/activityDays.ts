// Builds the heatmap's payload for one query over one or more
// workspaces: per-day file counts, summed across them.
import type {
  ActivityDays,
  ActivityMetric,
} from "../../shared/ipc/activity.js";
import type { CoreTarget, FileRef } from "./crossWorkspace.js";
import { activityDays } from "./queries.js";
import type { SearchQuery } from "./types.js";

export interface ActivityDaysOptions {
  metric: ActivityMetric;
  /** First and last day of the range, "YYYY-MM-DD", both included. */
  from: string;
  to: string;
  /** Restrict to these files (a collection, or the duplicates filter). */
  refs?: FileRef[];
}

export function buildActivityDays(
  cores: CoreTarget[],
  query: SearchQuery,
  opts: ActivityDaysOptions,
): ActivityDays {
  const { metric, from, to, refs } = opts;
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
  for (const target of cores) {
    const ids = idsByWs?.get(target.id);
    if (idsByWs && !ids) continue;
    const q = ids ? { ...query, fileIds: ids } : query;
    for (const [day, count] of activityDays(
      target.core.db,
      q,
      metric,
      from,
      to,
    ))
      totals.set(day, (totals.get(day) ?? 0) + count);
  }
  return {
    days: [...totals]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}
