import { handle } from "../core/ipcHandler.js";
import { isRemuxedVideo } from "../../shared/playbackTracks.js";
import { isInsideRoot } from "../core/paths.js";
import { probePlaybackMetadata } from "../core/playbackMetadata.js";
import * as q from "../core/queries.js";
import type {
  DuplicatesResult,
  FileRow,
  HistoryPage,
  SearchResult,
} from "../core/types.js";
import type { IpcContext } from "./context.js";
import {
  bulkTargetCores,
  coreById,
  queryTargets,
  scopedCores,
} from "./helpers.js";

export function registerFileHandlers(ctx: IpcContext): void {
  const { ws, queryClient, positions, emit } = ctx;

  // List queries can be invalidated by the renderer just as the active workspace
  // disappears (e.g. removing the last workspace). Return empty instead of throwing
  // so a brief race during workspace:changed doesn't surface as an error toast.
  handle("files_search", ({ query }) => {
    const collection = ws.activeCollection();
    return collection
      ? queryClient.run<SearchResult>({
          kind: "search",
          targets: queryTargets(ws.allCores()),
          // Folders belong to one workspace; a collection spans several and
          // has no folder view, so a folder scope has nothing to mean here.
          query: { ...query, folder: undefined },
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
  handle("file_get", async ({ id, workspaceId }) => {
    const { db, root } = coreById(ws, workspaceId);
    q.recordAccess(db, id);
    const file = q.fileDetail(db, id);
    if (
      file?.kind === "video" &&
      file.meta == null &&
      isRemuxedVideo(file.codec, file.ext) &&
      isInsideRoot(file.absPath, root)
    ) {
      // Before the scan stores metadata, opening details may wait up to five
      // seconds for the shared playback probe.
      const meta = await probePlaybackMetadata(file.absPath).catch(() => null);
      return { ...file, meta };
    }
    return file;
  });
  handle("file_set_rating", ({ id, workspaceId, rating }) =>
    q.setRating(coreById(ws, workspaceId).db, id, rating),
  );
  handle("file_set_favorite", ({ id, workspaceId, favorite }) =>
    q.setFavorite(coreById(ws, workspaceId).db, id, favorite),
  );
  // Favorite / rating over a whole selection. One transaction per database; the
  // Cores are resolved before the first write, so an unknown workspace id fails
  // the call rather than leaving the earlier workspaces already changed.
  handle("files_bulk_meta", ({ targets, favorite, rating }) => {
    const groups = bulkTargetCores(ws, targets);
    const total = { files: 0, skipped: 0 };
    for (const { core, fileIds } of groups) {
      const r = q.bulkSetMeta(core.db, fileIds, { favorite, rating });
      total.files += r.files;
      total.skipped += r.skipped;
    }
    return total;
  });
  // The rows a bulk edit was sent for, as they now stand: what the selection
  // reads again afterwards, since a selected row need not be in any list.
  handle("files_by_ids", ({ targets }) => {
    const groups = bulkTargetCores(ws, targets);
    return queryClient.run<FileRow[]>({
      kind: "filesByIds",
      targets: queryTargets(
        groups.map(({ workspaceId, core }) => ({ id: workspaceId, core })),
      ),
      groups: groups.map(({ workspaceId, fileIds }) => ({
        workspaceId,
        fileIds,
      })),
    });
  });
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
    // Played means no longer "to watch later" (see Workspaces.removeFromWatchLater).
    ws.removeFromWatchLater(workspaceId, id);
  });
  // Where playback stands. Resolved at write time, not now: a held write can
  // outlive the workspace, and coreById then throws into the writer's log.
  handle(
    "file_save_position",
    ({ id, workspaceId, position, duration, ended, urgent }) => {
      positions.queue(
        `${workspaceId}:${id}`,
        () =>
          void q.savePlayPosition(coreById(ws, workspaceId).db, id, {
            position,
            duration,
            ended,
          }),
        urgent,
      );
    },
  );
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
  // Clears every workspace's history, whichever view asked: the play history
  // lives in the library they all share.
  handle("history_clear", () => {
    // Positions still held would otherwise land after the clear and bring
    // back the resume points it is meant to remove.
    positions.flush();
    for (const { core } of ws.metadataCores()) {
      q.clearPlayHistory(core.db);
    }
  });
}
