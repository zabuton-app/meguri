// Timeline: per-day counts, a read-only query on the query worker.
import type { TimelineCounts } from "../../shared/ipc/timeline.js";
import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";
import { queryTargets } from "./helpers.js";

export function registerTimelineHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  // Target resolution mirrors files_search, so the days add up to exactly
  // the files the list shows.
  handle("timeline_counts", ({ query, axis }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<TimelineCounts>({
          kind: "timeline",
          targets: queryTargets(ws.allCores()),
          // A collection spans workspaces and has no folder view (see
          // files_search).
          query: { ...query, folder: undefined },
          refs: collection.items,
          axis,
        })
      : queryClient.run<TimelineCounts>({
          kind: "timeline",
          targets: queryTargets(ws.queryCores()),
          query,
          axis,
        });
  });
}
