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
  return cores.map(({ id, core }) => ({
    id,
    dbPath: core.dbPath,
    libraryPath: core.libraryPath,
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
 * Resolve a bulk edit's targets into one entry per workspace, with its Core.
 *
 * Groups repeating a workspace are merged, so a payload that does not group its
 * files the way the renderer does still costs one transaction per database. Every
 * Core is resolved before this returns, so an unknown workspace id fails the call
 * before anything is written rather than partway through the list.
 */
export function bulkTargetCores(
  ws: Workspaces,
  targets: { workspaceId: string; fileIds: number[] }[],
): { workspaceId: string; core: Core; fileIds: number[] }[] {
  const byWorkspace = new Map<string, number[]>();
  for (const target of targets) {
    const ids = byWorkspace.get(target.workspaceId);
    if (ids) ids.push(...target.fileIds);
    else byWorkspace.set(target.workspaceId, [...target.fileIds]);
  }
  return [...byWorkspace].map(([workspaceId, fileIds]) => ({
    workspaceId,
    core: coreById(ws, workspaceId),
    fileIds,
  }));
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
