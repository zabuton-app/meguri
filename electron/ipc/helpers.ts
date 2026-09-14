// Helpers shared by the IPC handler groups: resolving a workspace's Core,
// scoping a query to the active view, and path checks on file operations.
import path from "node:path";
import type { Core } from "../core/index.js";
import { isInsideRoot } from "../core/paths.js";
import type { QueryTarget } from "../core/queryExec.js";
import * as tags from "../core/tags.js";
import type { Workspaces } from "../core/workspaces.js";

/** Worker-side targets for a set of Cores (the worker opens its own read-only handles). */
export function queryTargets(
  cores: { id: string; core: Core }[],
): QueryTarget[] {
  return cores.map(({ id, core }) => ({
    id,
    dbPath: path.join(core.dataDir, "db.sqlite"),
  }));
}

// File operations are addressed by (workspaceId, fileId) since file IDs are unique
// only within a workspace. The renderer always supplies the workspace ID.
export function coreById(ws: Workspaces, wsId: string): Core {
  const core = ws.byId(wsId);
  if (!core) throw new Error("unknown workspace");
  return core;
}

/**
 * Take a file off Watch Later because it has now been played. Called wherever a
 * play is recorded — the in-app player's first `play` event, opening in an
 * external player, and an image's detail view (images have no player, so the
 * app already counts a view as a play). Merely opening the detail view of a
 * video does not reach here, so queueing something and peeking at its metadata
 * leaves it on the list.
 *
 * Deliberately no workspace:changed broadcast: that would refetch the list
 * behind the open detail view, dropping the very file being viewed out of the
 * prev/next navigation order mid-session. The renderer refreshes the affected
 * lists when the detail view closes instead (see MediaDetail).
 */
export function consumeWatchLater(
  ws: Workspaces,
  workspaceId: string,
  id: number,
): void {
  ws.removeFromWatchLater(workspaceId, id);
}

/**
 * Cores a catalog-wide query covers. A collection is a file set, not a query
 * scope (history, duplicates, the tag catalog): while one is active,
 * `queryCores()` returns nothing, so fall back to every workspace. Otherwise
 * the active workspace, or every workspace under the virtual "All" view.
 */
export function scopedCores(ws: Workspaces): { id: string; core: Core }[] {
  return ws.isCollection() ? ws.allCores() : ws.queryCores();
}

/**
 * Resolve a file's absolute path and verify it lives under the workspace root.
 * Every handler that hands a path to the OS (open, reveal, copy, export) must
 * go through this: `abs_path` in the DB was written at scan time and can point
 * outside the root after a symlink or root change.
 */
export function ensureFileInsideRoot(c: Core, id: number): string {
  const abs = tags.absPathOf(c.db, id);
  if (!abs) throw new Error("file not found");
  if (!isInsideRoot(abs, c.root)) throw new Error("path is outside scan root");
  return abs;
}
