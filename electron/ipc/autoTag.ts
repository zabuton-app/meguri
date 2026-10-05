import { randomUUID } from "node:crypto";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import {
  applyAutoTags,
  attachAutoTags,
  autoTagFiles,
  detachTagPairs,
  type TagPair,
} from "../core/autoTag.js";
import { handle } from "../core/ipcHandler.js";
import { MAX_AUTO_TAG_FILES, type AutoTagFile } from "../../shared/autoTag.js";
import type { IpcContext } from "./context.js";
import { coreById, scopedCores } from "./helpers.js";

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
    const cores = scopedCores(ws);
    cores.forEach(({ id, core }, i) => {
      // An even share of what is left, so the last workspaces of the "All"
      // view are sampled too instead of the first one taking the whole cap.
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
    const byWorkspace = new Map<
      string,
      { fileIds: number[]; tags: string[] }[]
    >();
    for (const { workspaceId, fileIds, tags } of assignments) {
      coreById(ws, workspaceId);
      const list = byWorkspace.get(workspaceId);
      if (list) list.push({ fileIds, tags });
      else byWorkspace.set(workspaceId, [{ fileIds, tags }]);
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
    if (added === 0) return { files, added, undoId: null };
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
    return { files, added, undoId };
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
      for (const { core } of scopedCores(ws)) {
        const result = await applyAutoTags(core.db, {
          engine,
          derive: ctx.deriveAutoTags,
        });
        files += result.files;
        added += result.added;
      }
      if (added > 0) await queryClient.invalidateCaches();
      return { files, added };
    } finally {
      reapplying = false;
    }
  });
}
