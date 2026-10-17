import { randomUUID } from "node:crypto";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import {
  applyAutoTags,
  attachAutoTags,
  autoTagFiles,
  detachTagPairs,
  keepStillAt,
  type TagPair,
} from "../core/autoTag.js";
import { bulkEditManualTags } from "../core/tags.js";
import { handle } from "../core/ipcHandler.js";
import { MAX_AUTO_TAG_FILES, type AutoTagFile } from "../../shared/autoTag.js";
import type { IpcContext } from "./context.js";
import { coreById } from "./helpers.js";

/** Rollback handles kept at a time; the oldest go first. */
const MAX_UNDO_ENTRIES = 256;
/** Pairs those handles may hold together, so a long session stays bounded. */
const MAX_UNDO_PAIRS = 500_000;

export function registerAutoTagHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;
  // What each apply attached, so it can be taken back exactly — nothing the
  // files already had. The screen sends one apply as several calls when it is
  // large, and when a later one fails it takes the earlier ones back with
  // these, rather than leave the files half tagged. That is their only use:
  // in memory on purpose, a rollback, not a history.
  const undo = new Map<string, { workspaceId: string; pairs: TagPair[] }[]>();
  let undoPairs = 0;
  const forget = (undoId: string) => {
    const entry = undo.get(undoId);
    if (!entry) return undefined;
    undo.delete(undoId);
    for (const { pairs } of entry) undoPairs -= pairs.length;
    return entry;
  };
  let reapplying = false;

  // App-wide, not per workspace: the same rules tag every library.
  handle("auto_tag_get", () => loadConfig().autoTag);
  handle("auto_tag_set", ({ config }) => {
    updateConfig((c) => ({ ...c, autoTag: config }));
    // saveConfig logs a failed write instead of throwing; read back so a full
    // disk is not reported as a successful save.
    if (JSON.stringify(loadConfig().autoTag) !== JSON.stringify(config)) {
      throw new Error("auto-tagging settings could not be saved");
    }
  });

  handle("auto_tag_files", () => {
    const files: AutoTagFile[] = [];
    const existing = new Set<string>();
    let total = 0;
    // Every workspace, whichever one is being looked at: the rules are the
    // app's, not a workspace's, and a folder rule may be for any of them.
    const cores = ws.allCores();
    cores.forEach(({ id, core }, i) => {
      // An even share of what is left, so the last workspaces are sampled
      // too instead of the first one taking the whole cap.
      const share = Math.ceil(
        (MAX_AUTO_TAG_FILES - files.length) / (cores.length - i),
      );
      const part = autoTagFiles(core.db, id, share);
      files.push(...part.files);
      total += part.total;
      for (const name of part.existingTags) existing.add(name);
    });
    return { files, total, existingTags: [...existing] };
  });

  handle("auto_tag_apply", async ({ assignments }) => {
    // Every Core is resolved before the first write, so an unknown workspace
    // fails the call rather than leaving the ones ahead of it already tagged.
    // Only the files still where the screen read them (see keepStillAt):
    // checked here, with nothing awaited before the writes below.
    let moved = 0;
    const byWorkspace = new Map<
      string,
      { fileIds: number[]; tags: string[] }[]
    >();
    for (const { workspaceId, fileIds, places, tags } of assignments) {
      const still = keepStillAt(coreById(ws, workspaceId).db, fileIds, places);
      moved += still.moved;
      const { kept } = still;
      if (kept.length === 0) continue;
      const list = byWorkspace.get(workspaceId);
      if (list) list.push({ fileIds: kept, tags });
      else byWorkspace.set(workspaceId, [{ fileIds: kept, tags }]);
    }
    let files = 0;
    let added = 0;
    const entry: { workspaceId: string; pairs: TagPair[] }[] = [];
    try {
      for (const [workspaceId, list] of byWorkspace) {
        const result = attachAutoTags(coreById(ws, workspaceId).db, list);
        files += result.files;
        added += result.pairs.length;
        if (result.pairs.length > 0) {
          entry.push({ workspaceId, pairs: result.pairs });
        }
      }
    } catch (err) {
      // Each workspace commits on its own. A failure partway must not leave
      // the ones before it tagged with no handle to take that back.
      for (const { workspaceId, pairs } of entry) {
        detachTagPairs(coreById(ws, workspaceId).db, pairs);
      }
      throw err;
    }
    if (added === 0) return { files, added, moved, undoId: null };
    const undoId = randomUUID();
    undo.set(undoId, entry);
    undoPairs += added;
    while (
      undo.size > 1 &&
      (undo.size > MAX_UNDO_ENTRIES || undoPairs > MAX_UNDO_PAIRS)
    ) {
      forget(undo.keys().next().value as string);
    }
    await queryClient.invalidateCaches();
    return { files, added, moved, undoId };
  });

  handle("auto_tag_edit", ({ targets, add, remove }) => {
    // Every Core is resolved, and every file checked (see keepStillAt), before
    // the first write, with nothing awaited in between; then one edit a
    // workspace, as files_bulk_tag makes.
    const total = { files: 0, skipped: 0, moved: 0, added: 0, removed: 0 };
    const byWorkspace = new Map<string, number[]>();
    for (const { workspaceId, fileIds, places } of targets) {
      const { kept, moved } = keepStillAt(
        coreById(ws, workspaceId).db,
        fileIds,
        places,
      );
      total.moved += moved;
      total.skipped += moved;
      const ids = byWorkspace.get(workspaceId);
      if (ids) ids.push(...kept);
      else byWorkspace.set(workspaceId, kept);
    }
    for (const [workspaceId, ids] of byWorkspace) {
      if (ids.length === 0) continue;
      const r = bulkEditManualTags(
        coreById(ws, workspaceId).db,
        ids,
        add,
        remove,
      );
      total.files += r.files;
      total.skipped += r.skipped;
      total.added += r.added;
      total.removed += r.removed;
    }
    return total;
  });

  handle("auto_tag_undo", async ({ undoIds }) => {
    let removed = 0;
    for (const undoId of undoIds) {
      const entry = forget(undoId);
      if (!entry) continue;
      for (const { workspaceId, pairs } of entry) {
        const core = ws.byId(workspaceId);
        if (core) removed += detachTagPairs(core.db, pairs);
      }
    }
    if (removed > 0) await queryClient.invalidateCaches();
    return removed;
  });

  handle("auto_tag_reapply", async () => {
    if (reapplying) throw new Error("auto-tagging is already running");
    reapplying = true;
    try {
      const engine = loadConfig().autoTag;
      let files = 0;
      let added = 0;
      // As the screen that asked: every workspace (see auto_tag_files). One
      // removed meanwhile is stopped (its database is about to close) or
      // skipped, and the others are still done.
      await ctx.passes.forEachWorkspace(
        () => ws.allCores(),
        async ({ id, core }, signal) => {
          const result = await applyAutoTags(core.db, {
            engine,
            workspaceId: id,
            derive: ctx.deriveAutoTags,
            signal,
          });
          files += result.files;
          added += result.added;
        },
      );
      if (added > 0) await queryClient.invalidateCaches();
      return { files, added };
    } catch (error) {
      // Each chunk is written as it is done: the ones before the failure
      // stay, and every view of the files has to see them.
      await queryClient.invalidateCaches().catch(() => {});
      throw error;
    } finally {
      reapplying = false;
    }
  });
}
