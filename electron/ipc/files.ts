import type { SearchAllowList } from "../core/ai/aiService.js";
import { metaKeysForIds } from "../core/ai/embeddings.js";
import type { FileRef } from "../core/crossWorkspace.js";
import { handle } from "../core/ipcHandler.js";
import * as q from "../core/queries.js";
import type {
  DuplicatesResult,
  FileRow,
  HistoryPage,
  SearchResult,
} from "../core/types.js";
import type { Workspaces } from "../core/workspaces.js";
import type { IpcContext } from "./context.js";
import { coreById, queryTargets, scopedCores } from "./helpers.js";

export function registerFileHandlers(ctx: IpcContext): void {
  const { ws, queryClient, emit } = ctx;

  /**
   * A semantic query resolved to file refs: the nearest files by embedding,
   * which the worker then filters and sorts like any other ref set. The worker
   * never sees `semantic` — it is resolved here, where the model lives. Within a
   * collection only its members are candidates.
   */
  const semanticRefs = async (
    semantic: string,
    collection: ReturnType<Workspaces["activeCollection"]>,
  ): Promise<FileRef[]> => {
    const scope = scopedCores(ws);
    let allow: SearchAllowList | undefined;
    if (collection) {
      const idsByWs = new Map<string, number[]>();
      for (const item of collection.items) {
        const ids = idsByWs.get(item.workspaceId) ?? [];
        ids.push(item.fileId);
        idsByWs.set(item.workspaceId, ids);
      }
      allow = new Map();
      for (const { id, core } of scope) {
        const ids = idsByWs.get(id);
        if (ids) allow.set(id, metaKeysForIds(core.db, ids));
      }
    }
    const hits = await ctx.ai.search(semantic, scope, undefined, allow);
    let refs = hits.map((h) => ({ workspaceId: h.workspaceId, fileId: h.id }));
    if (collection) {
      // Duplicates expand to every copy; keep only the copies it holds.
      const member = new Set(
        collection.items.map((i) => `${i.workspaceId}:${i.fileId}`),
      );
      refs = refs.filter((r) => member.has(`${r.workspaceId}:${r.fileId}`));
    }
    return refs;
  };

  // List queries can be invalidated by the renderer just as the active workspace
  // disappears (e.g. removing the last workspace). Return empty instead of throwing
  // so a brief race during workspace:changed doesn't surface as an error toast.
  handle("files_search", async ({ query }) => {
    const collection = ws.activeCollection();
    // A semantic query narrows the candidate set to the nearest files first;
    // the regular filters and sort then apply to that set. The worker never
    // sees `semantic` — it is resolved here, where the model lives.
    const { semantic, ...rest } = query;
    // Without a model there is nothing to narrow by, and the condition is
    // dropped rather than turned into an always-empty result.
    if (semantic?.trim() && ctx.ai.activeModelId) {
      const refs = await semanticRefs(semantic, collection);
      if (refs.length === 0) return { items: [], nextCursor: null };
      return queryClient.run<SearchResult>({
        kind: "search",
        targets: queryTargets(scopedCores(ws)),
        query: rest,
        refs,
      });
    }
    return collection
      ? queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.allCores()),
          query: rest,
          refs: collection.items,
        })
      : queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.queryCores()),
          query: rest,
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
    // Its vector would otherwise keep taking a place in the nearest results.
    ctx.ai.invalidate(workspaceId);
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
    // Played means no longer "to watch later" (see Workspaces.removeFromWatchLater).
    ws.removeFromWatchLater(workspaceId, id);
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
