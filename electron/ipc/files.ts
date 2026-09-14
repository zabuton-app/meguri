import { handle } from "../core/ipcHandler.js";
import * as q from "../core/queries.js";
import type {
  DuplicatesResult,
  FileRow,
  HistoryPage,
  SearchResult,
} from "../core/types.js";
import type { IpcContext } from "./context.js";
import {
  consumeWatchLater,
  coreById,
  queryTargets,
  scopedCores,
} from "./helpers.js";

export function registerFileHandlers(ctx: IpcContext): void {
  const { ws, queryClient, emit } = ctx;

  // List queries can be invalidated by the renderer just as the active workspace
  // disappears (e.g. removing the last workspace). Return empty instead of throwing
  // so a brief race during workspace:changed doesn't surface as an error toast.
  handle("files_search", ({ query }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.allCores()),
          query,
          refs: collection.items,
        })
      : queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.queryCores()),
          query,
        });
  });
  handle("files_random", ({ query }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<FileRow[]>({
          kind: "random",
          targets: queryTargets(ws.allCores()),
          query: query ?? {},
          refs: collection.items,
        })
      : queryClient.run<FileRow[]>({
          kind: "random",
          targets: queryTargets(ws.queryCores()),
          query: query ?? {},
        });
  });
  handle("file_get", ({ id, workspaceId }) => {
    const db = coreById(ws, workspaceId).db;
    q.recordAccess(db, id);
    return q.fileDetail(db, id);
  });
  handle("file_set_rating", ({ id, workspaceId, rating }) =>
    q.setRating(coreById(ws, workspaceId).db, id, rating),
  );
  handle("file_set_favorite", ({ id, workspaceId, favorite }) =>
    q.setFavorite(coreById(ws, workspaceId).db, id, favorite),
  );
  handle("file_delete_from_index", async ({ id, workspaceId }) => {
    const deleted = q.deleteFromIndex(coreById(ws, workspaceId).db, id);
    // Await so the renderer's refetch after this resolves can't race a stale
    // duplicate-refs cache (the scan path awaits for the same reason).
    await queryClient.invalidateCaches();
    // Drop any collection refs to the now-removed file so item counts stay accurate.
    // Only broadcast when a collection actually changed; otherwise the renderer's
    // own cache invalidation after delete already covers it.
    if (ws.removeFileFromAllCollections(workspaceId, id)) {
      emit("workspace:changed", { activeId: ws.activeId });
    }
    return deleted;
  });
  handle("file_record_play", ({ id, workspaceId, via, position }) => {
    q.recordPlay(coreById(ws, workspaceId).db, id, via, position ?? null);
    consumeWatchLater(ws, workspaceId, id);
  });
  // History and duplicates follow the catalog scope rule (see scopedCores):
  // a collection is a file set, not a scope, so the timeline stays meaningful
  // while one is active.
  handle("history_list", ({ query }) =>
    queryClient.run<HistoryPage>({
      kind: "history",
      targets: queryTargets(scopedCores(ws)),
      query: query ?? {},
    }),
  );
  handle("duplicates_list", () =>
    queryClient.run<DuplicatesResult>({
      kind: "duplicates",
      targets: queryTargets(scopedCores(ws)),
    }),
  );
  // Clear scope matches what history_list shows: the active workspace only, or
  // every workspace when All / a collection is active.
  handle("history_clear", () => {
    for (const { core } of scopedCores(ws)) q.clearPlayHistory(core.db);
  });
}
