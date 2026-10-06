import { handle } from "../core/ipcHandler.js";
import log from "../core/logger.js";
import * as tagAdmin from "../core/tagAdmin.js";
import * as tags from "../core/tags.js";
import type { TagList } from "../core/types.js";
import type { IpcContext } from "./context.js";
import {
  bulkTargetCores,
  coreById,
  queryTargets,
  scopedCores,
} from "./helpers.js";

export function registerTagHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  handle("file_add_tag", ({ id, workspaceId, name }) => {
    const db = coreById(ws, workspaceId).db;
    const tagId = tags.addManualTag(db, id, name.trim());
    tags.syncFts(db, id);
    return tagId;
  });
  handle("file_remove_tag", ({ id, workspaceId, tagId }) => {
    const db = coreById(ws, workspaceId).db;
    tags.removeManualTag(db, id, tagId);
    tags.syncFts(db, id);
  });
  // One edit over a multi-workspace selection.
  //
  // Rejections all happen before the first write: the groups are merged and
  // every Core resolved up front, so an unknown workspace id fails the call
  // rather than leaving the workspaces ahead of it in the list already edited,
  // and bulkEditManualTags checks the names before it opens its transaction —
  // every database gets the same names, so a reserved one stops the first Core
  // having written nothing.
  //
  // What is NOT covered is a database error partway through: each workspace
  // commits its own transaction, so a failure in the third one leaves the first
  // two applied while the renderer sees a rejected call. Cross-database atomicity
  // would mean one connection with the others ATTACHed, which is a bigger change
  // than this screen justifies; the renderer refetches either way.
  handle("files_bulk_tag", ({ targets, add, remove }) => {
    const groups = bulkTargetCores(ws, targets);
    const total = { files: 0, skipped: 0, added: 0, removed: 0 };
    for (const { core, fileIds } of groups) {
      const r = tags.bulkEditManualTags(core.db, fileIds, add, remove);
      total.files += r.files;
      total.skipped += r.skipped;
      total.added += r.added;
      total.removed += r.removed;
    }
    return total;
  });
  handle("tags_list", ({ workspaceId, prefix, limit }) =>
    tags.listTagNames(coreById(ws, workspaceId).db, prefix, limit ?? 20),
  );

  // The catalog channels take no workspaceId: coreById(ALL_ID) throws by design,
  // and a tag id means nothing across databases. Scope follows the active view
  // (see scopedCores).

  /** Cores for a catalog mutation. allCores() silently skips workspaces whose DB
   *  could not be opened, which for a rename means that workspace keeps the old
   *  name while the others move on — worth a line in the log when it happens. */
  const tagMutationCores = () => {
    const cores = scopedCores(ws);
    const expected =
      ws.isCollection() || ws.isAll() ? ws.rootCount() : cores.length;
    if (cores.length < expected) {
      log.warn(
        `tag mutation covers ${cores.length}/${expected} workspaces; the rest could not be opened`,
      );
    }
    return cores;
  };

  handle("tags_list_all", (input) =>
    queryClient.run<TagList>({
      kind: "tagsList",
      targets: queryTargets(
        input?.allWorkspaces ? ws.allCores() : scopedCores(ws),
      ),
    }),
  );
  // Mutations are addressed by name, so fanning them across every database in
  // scope converges on the same end state even when one of them has a collision
  // (rename there escalates to a merge) and another does not.
  handle("tag_rename", ({ from, to }) => {
    let merged = false;
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      const r = tagAdmin.renameTag(core.db, from, to);
      merged ||= r.merged;
      affectedFiles += r.affectedFiles;
    }
    return { merged, affectedFiles };
  });
  handle("tag_merge", ({ from, into }) => {
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      affectedFiles += tagAdmin.mergeTags(core.db, from, into).affectedFiles;
    }
    return { affectedFiles };
  });
  handle("tag_delete", ({ tags: refs }) => {
    let removedTags = 0;
    let affectedFiles = 0;
    for (const { core } of tagMutationCores()) {
      const r = tagAdmin.deleteTags(core.db, refs);
      removedTags += r.removedTags;
      affectedFiles += r.affectedFiles;
    }
    return { removedTags, affectedFiles };
  });
}
