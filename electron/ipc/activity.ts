// Heatmap: per-day counts, a read-only query on the query worker.
import type { ActivityDays } from "../../shared/ipc/activity.js";
import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";
import { queryTargets } from "./helpers.js";

export function registerActivityHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  // Target resolution mirrors files_search, so a day counts exactly the files
  // the list shows for it.
  handle("activity_days", ({ query, metric, from, to }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<ActivityDays>({
          kind: "activity",
          targets: queryTargets(ws.allCores()),
          // A collection spans workspaces and has no folder view (see
          // files_search).
          query: { ...query, folder: undefined },
          refs: collection.items,
          metric,
          from,
          to,
        })
      : queryClient.run<ActivityDays>({
          kind: "activity",
          targets: queryTargets(ws.queryCores()),
          query,
          metric,
          from,
          to,
        });
  });
}
