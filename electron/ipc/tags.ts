import { loadConfig, saveAutoTag } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import log from "../core/logger.js";
import * as tagAdmin from "../core/tagAdmin.js";
import * as tags from "../core/tags.js";
import type { TagList } from "../core/types.js";
import { retagConditions } from "../../shared/autoTagConditions.js";
import { AutoTagConfigSchema, type TagRef } from "../../shared/ipc/schema.js";
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
  // (see scopedCores), except a mutation the auto-tagging conditions reach
  // (see withAutoTagConditions).

  /** Cores for a catalog mutation: the view's, or every workspace's. allCores()
   *  silently skips workspaces whose DB could not be opened, which for a rename
   *  means that workspace keeps the old name while the others move on — worth a
   *  line in the log when it happens. */
  const tagMutationCores = (everyWorkspace: boolean) => {
    const cores = everyWorkspace ? ws.allCores() : scopedCores(ws);
    const expected =
      everyWorkspace || ws.isCollection() || ws.isAll()
        ? ws.rootCount()
        : cores.length;
    if (cores.length < expected) {
      log.warn(
        `tag mutation covers ${cores.length}/${expected} workspaces; the rest could not be opened`,
      );
    }
    return cores;
  };

  handle("tags_list_all", (input) =>
    queryClient.run<TagList>(
      input?.allWorkspaces
        ? {
            kind: "tagsList",
            targets: queryTargets(ws.allCores()),
            // Past the cap, the view's own tags are the ones not to lose. Only
            // a single workspace's view is narrower than every workspace;
            // for All and collections this is all of them.
            prefer: scopedCores(ws).map(({ id }) => id),
          }
        : { kind: "tagsList", targets: queryTargets(scopedCores(ws)) },
    ),
  );
  // Mutations are addressed by name, so fanning them across every database in
  // scope converges on the same end state even when one of them has a collision
  // (rename there escalates to a merge) and another does not.
  //
  // A tag an auto-tagging condition names is the app's, not a workspace's: the
  // operation then runs in every workspace, whichever is in view, and the
  // conditions are rewritten after it so the next scan does not put the old
  // name back (see retagConditions). A name the conditions cannot hold stops
  // the operation before anything changes. A failure partway leaves the
  // conditions as they were; doing it again finishes both.
  const withAutoTagConditions = <T>(
    from: readonly TagRef[],
    to: string | null,
    run: (cores: ReturnType<typeof tagMutationCores>) => T,
  ): T => {
    const before = loadConfig().autoTag;
    const names = from.filter((ref) => ref.namespace === "").map((r) => r.name);
    const after = retagConditions(before, names, to);
    if (after === before) return run(tagMutationCores(false));
    AutoTagConfigSchema.parse(after);
    const result = run(tagMutationCores(true));
    saveAutoTag(after);
    return result;
  };
  handle("tag_rename", ({ from, to }) =>
    // Trimmed as renameTag trims it, so both get the same name.
    withAutoTagConditions([from], to.trim(), (cores) => {
      let merged = false;
      let affectedFiles = 0;
      for (const { core } of cores) {
        const r = tagAdmin.renameTag(core.db, from, to);
        merged ||= r.merged;
        affectedFiles += r.affectedFiles;
      }
      return { merged, affectedFiles };
    }),
  );
  handle("tag_merge", ({ from, into }) =>
    withAutoTagConditions(from, into.name, (cores) => {
      let affectedFiles = 0;
      for (const { core } of cores) {
        affectedFiles += tagAdmin.mergeTags(core.db, from, into).affectedFiles;
      }
      return { affectedFiles };
    }),
  );
  handle("tag_delete", ({ tags: refs }) =>
    withAutoTagConditions(refs, null, (cores) => {
      let removedTags = 0;
      let affectedFiles = 0;
      for (const { core } of cores) {
        const r = tagAdmin.deleteTags(core.db, refs);
        removedTags += r.removedTags;
        affectedFiles += r.affectedFiles;
      }
      return { removedTags, affectedFiles };
    }),
  );
}
