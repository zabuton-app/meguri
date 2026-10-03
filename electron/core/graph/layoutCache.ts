// Cached node positions of the graph view, one JSON file per scope. Positions
// are derived data — losing them only costs a re-layout — so they live beside
// the DB rather than in it, and anything malformed is ignored, not repaired.
//
// A real workspace keeps its file in its own data directory, which is deleted
// with the workspace. "All" and collections have no data directory, so theirs
// go under <userData>/graph-layouts/, named by a hash of the scope string.
// The 2D and 3D views lay a graph out differently, so each has its own file.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_LAYOUT_MAX_NODES,
  workspaceOfNodeKey,
  type GraphDims,
} from "../../../shared/ipc/graph.js";
import { ALL_ID, COLLECTION_ID_PREFIX } from "../../../shared/workspaceIds.js";

function fileName(dims: GraphDims): string {
  return dims === 3 ? "graph-layout-3d.json" : "graph-layout.json";
}
const SHARED_DIR = "graph-layouts";

export interface LayoutPositions {
  keys: string[];
  /** The coordinates, one per dimension for each key ([x0, y0, x1, y1, ...]
   *  in 2D, [x0, y0, z0, ...] in 3D). */
  xy: number[];
}

interface LayoutFile extends LayoutPositions {
  v: 1;
  /** Absent in files written before the 3D view: those are 2D. */
  dims?: GraphDims;
  savedAt: number;
}

/** What the store needs to know about the scopes that exist right now. */
export interface LayoutScopes {
  /** <userData>. */
  baseDir: string;
  /** Data directory of a registered workspace, or null for an unknown id. */
  workspaceDataDir(id: string): string | null;
  /** Whether a collection with this id exists. */
  hasCollection(id: string): boolean;
  /** Ids of the registered workspaces (to drop stale nodes from All's file). */
  workspaceIds(): Set<string>;
}

function sharedFile(baseDir: string, scope: string, dims: GraphDims): string {
  const key = dims === 3 ? `${scope}#3d` : scope;
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return path.join(baseDir, SHARED_DIR, `${hash}.json`);
}

/** Where a scope's positions live, or null when the scope does not exist
 *  (a removed workspace or collection must not get its file back). */
export function layoutPathFor(
  scope: string,
  scopes: LayoutScopes,
  dims: GraphDims = 2,
): string | null {
  if (scope === ALL_ID) return sharedFile(scopes.baseDir, scope, dims);
  if (scope.startsWith(COLLECTION_ID_PREFIX)) {
    const id = scope.slice(COLLECTION_ID_PREFIX.length);
    return scopes.hasCollection(id)
      ? sharedFile(scopes.baseDir, scope, dims)
      : null;
  }
  const dir = scopes.workspaceDataDir(scope);
  return dir ? path.join(dir, fileName(dims)) : null;
}

/** Paths a collection's files had (2D and 3D), for deleting them with it. */
export function collectionLayoutPaths(baseDir: string, id: string): string[] {
  const scope = `${COLLECTION_ID_PREFIX}${id}`;
  return [sharedFile(baseDir, scope, 2), sharedFile(baseDir, scope, 3)];
}

function isLayoutFile(v: unknown, dims: GraphDims): v is LayoutFile {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Partial<LayoutFile>;
  return (
    f.v === 1 &&
    (f.dims ?? 2) === dims &&
    Array.isArray(f.keys) &&
    Array.isArray(f.xy) &&
    f.keys.length <= GRAPH_LAYOUT_MAX_NODES &&
    f.xy.length === f.keys.length * dims &&
    f.keys.every((k) => typeof k === "string") &&
    f.xy.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** The stored positions, or null when there are none or the file is unusable. */
export async function readLayout(
  file: string,
  dims: GraphDims = 2,
): Promise<LayoutPositions | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLayoutFile(parsed, dims)
      ? { keys: parsed.keys, xy: parsed.xy }
      : null;
  } catch {
    return null;
  }
}

/**
 * Merge `update` into the stored positions and write them atomically. Keys
 * not in the update are kept: a filtered graph saves only what it shows, and
 * that must not erase the rest of the scope's layout. `keep` drops stored keys
 * that no longer belong (nodes of a removed workspace), and the update's too:
 * a save racing the removal must not write them back. Past the size cap the
 * keys the update did not touch go first, oldest first. `alive` is asked when
 * the write runs, not when it is queued: false (its scope was removed in
 * between) drops the write, so it cannot bring the removed directory back. A
 * write to a workspace being removed is dropped the same way (see
 * removeWorkspaceWithLayouts).
 */
export function writeLayout(
  file: string,
  update: LayoutPositions,
  keep: (key: string) => boolean = () => true,
  dims: GraphDims = 2,
  alive: () => boolean = () => true,
): Promise<void> {
  // Each write reads, merges and replaces the file: two in flight for one
  // file would lose one's keys, so writes to a file run one after another.
  const run = (writes.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => mergeAndWrite(file, update, keep, dims, alive));
  writes.set(file, run);
  void run
    .finally(() => {
      if (writes.get(file) === run) writes.delete(file);
    })
    .catch(() => undefined);
  return run;
}

const writes = new Map<string, Promise<void>>();
/** Files whose workspace is being removed (see removeWorkspaceWithLayouts),
 *  counted: two removals of one workspace may overlap. */
const heldOff = new Map<string, number>();

/** Wait until no write to `file` is queued. Writes queued while waiting chain
 *  onto the last one, so this waits until the queue's tail is one already
 *  waited for. */
async function drainWrites(file: string): Promise<void> {
  let last: Promise<void> | undefined;
  let w: Promise<void> | undefined;
  while ((w = writes.get(file)) && w !== last) {
    last = w;
    await w.catch(() => undefined);
  }
}

async function mergeAndWrite(
  file: string,
  update: LayoutPositions,
  keep: (key: string) => boolean,
  dims: GraphDims,
  alive: () => boolean,
): Promise<void> {
  const merged = new Map<string, number[]>();
  const at = (xy: number[], i: number) => xy.slice(i * dims, (i + 1) * dims);
  const prev = await readLayout(file, dims);
  if (prev) {
    prev.keys.forEach((k, i) => {
      if (keep(k)) merged.set(k, at(prev.xy, i));
    });
  }
  update.keys.forEach((k, i) => {
    if (!keep(k)) return;
    // Re-inserted so the updated keys sit at the end, i.e. are the newest.
    merged.delete(k);
    merged.set(k, at(update.xy, i));
  });
  let entries = [...merged];
  if (entries.length > GRAPH_LAYOUT_MAX_NODES)
    entries = entries.slice(entries.length - GRAPH_LAYOUT_MAX_NODES);

  const out: LayoutFile = {
    v: 1,
    ...(dims === 3 ? { dims } : {}),
    savedAt: Date.now(),
    keys: entries.map(([k]) => k),
    xy: entries.flatMap(([, p]) => p),
  };
  // Checked after the last wait before mkdir, which would recreate a removed
  // workspace's data directory.
  if (heldOff.has(file) || !alive()) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(out));
  await fs.rename(tmp, file);
}

/** The positions once any save queued for the file has landed, so a view
 *  reopened right after leaving starts from what it left. */
export async function readLayoutSettled(
  file: string,
  dims: GraphDims = 2,
): Promise<LayoutPositions | null> {
  await (writes.get(file) ?? Promise.resolve()).catch(() => undefined);
  return readLayout(file, dims);
}

/** Best effort: a file left behind is only a stale cache nobody reads. */
export async function removeLayout(file: string): Promise<void> {
  await (writes.get(file) ?? Promise.resolve()).catch(() => undefined);
  await fs.rm(file, { force: true }).catch(() => undefined);
}

/**
 * Run `remove`, which deletes a workspace's data directory, so that no save
 * of the workspace's layouts writes into the directory as it goes or brings
 * it back after. Saves to its files are held off from the start, those
 * already queued are waited out (one that has not reached its write yet is
 * dropped), and only then does `remove` run. Saves sent once it has returned
 * are left to their `alive` check (see writeLayout), so a workspace
 * registered again saves as usual.
 */
export async function removeWorkspaceWithLayouts(
  dataDir: string,
  remove: () => Promise<void>,
): Promise<void> {
  const files = [
    path.join(dataDir, fileName(2)),
    path.join(dataDir, fileName(3)),
  ];
  for (const f of files) heldOff.set(f, (heldOff.get(f) ?? 0) + 1);
  try {
    for (const f of files) await drainWrites(f);
    await remove();
  } finally {
    for (const f of files) {
      const n = (heldOff.get(f) ?? 1) - 1;
      if (n > 0) heldOff.set(f, n);
      else heldOff.delete(f);
    }
  }
}

/**
 * For All's file: a file node survives only while its workspace is registered.
 * Given a getter, the ids are read on the first key tested, i.e. when the
 * write runs rather than when it was queued behind another one, so a
 * workspace removed in between is not written back.
 */
export function keepRegisteredWorkspaces(
  ids: Set<string> | (() => Set<string>),
): (key: string) => boolean {
  let registered = typeof ids === "function" ? null : ids;
  return (key) => {
    const ws = workspaceOfNodeKey(key);
    if (ws == null) return !key.startsWith("f:");
    registered ??= (ids as () => Set<string>)();
    return registered.has(ws);
  };
}
