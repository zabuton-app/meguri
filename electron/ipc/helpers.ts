// Helpers shared by the IPC handler groups: resolving a workspace's Core,
// scoping a query to the active view, and path checks on file operations.
import type { Core } from "../core/index.js";
import { isInsideRoot } from "../core/paths.js";
import type { QueryTarget } from "../core/queryExec.js";
import * as tags from "../core/tags.js";
import type { Workspaces } from "../core/workspaces.js";

/** Worker-side targets for a set of Cores (the worker opens its own read-only handles). */
export function queryTargets(
  cores: { id: string; core: Core }[],
): QueryTarget[] {
  return cores.map(({ id, core }) => ({ id, dbPath: core.dbPath }));
}

// File operations are addressed by (workspaceId, fileId) since file IDs are unique
// only within a workspace. The renderer always supplies the workspace ID.
export function coreById(ws: Workspaces, wsId: string): Core {
  const core = ws.byId(wsId);
  if (!core) throw new Error("unknown workspace");
  return core;
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
