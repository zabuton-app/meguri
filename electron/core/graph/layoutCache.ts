// Cached node positions of the graph view, one JSON file per scope. Positions
// are derived data — losing them only costs a re-layout — so they live beside
// the DB rather than in it, and anything malformed is ignored, not repaired.
//
// A real workspace keeps its file in its own data directory, which is deleted
// with the workspace. "All" and collections have no data directory, so theirs
// go under <userData>/graph-layouts/, named by a hash of the scope string.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_LAYOUT_MAX_NODES,
  workspaceOfNodeKey,
} from "../../../shared/ipc/graph.js";
import { ALL_ID, COLLECTION_ID_PREFIX } from "../../../shared/workspaceIds.js";

const FILE_NAME = "graph-layout.json";
const SHARED_DIR = "graph-layouts";

export interface LayoutPositions {
  keys: string[];
  /** [x0, y0, x1, y1, ...]: two numbers per key. */
  xy: number[];
}

interface LayoutFile extends LayoutPositions {
  v: 1;
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

function sharedFile(baseDir: string, scope: string): string {
  const hash = createHash("sha1").update(scope).digest("hex").slice(0, 16);
  return path.join(baseDir, SHARED_DIR, `${hash}.json`);
}

/** Where a scope's positions live, or null when the scope does not exist
 *  (a removed workspace or collection must not get its file back). */
export function layoutPathFor(
  scope: string,
  scopes: LayoutScopes,
): string | null {
  if (scope === ALL_ID) return sharedFile(scopes.baseDir, scope);
  if (scope.startsWith(COLLECTION_ID_PREFIX)) {
    const id = scope.slice(COLLECTION_ID_PREFIX.length);
    return scopes.hasCollection(id) ? sharedFile(scopes.baseDir, scope) : null;
  }
  const dir = scopes.workspaceDataDir(scope);
  return dir ? path.join(dir, FILE_NAME) : null;
}

/** Path a collection's file had, for deleting it with the collection. */
export function collectionLayoutPath(baseDir: string, id: string): string {
  return sharedFile(baseDir, `${COLLECTION_ID_PREFIX}${id}`);
}

function isLayoutFile(v: unknown): v is LayoutFile {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Partial<LayoutFile>;
  return (
    f.v === 1 &&
    Array.isArray(f.keys) &&
    Array.isArray(f.xy) &&
    f.keys.length <= GRAPH_LAYOUT_MAX_NODES &&
    f.xy.length === f.keys.length * 2 &&
    f.keys.every((k) => typeof k === "string") &&
    f.xy.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** The stored positions, or null when there are none or the file is unusable. */
export async function readLayout(
  file: string,
): Promise<LayoutPositions | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLayoutFile(parsed) ? { keys: parsed.keys, xy: parsed.xy } : null;
  } catch {
    return null;
  }
}

/**
 * Merge `update` into the stored positions and write them atomically. Keys
 * not in the update are kept: a filtered graph saves only what it shows, and
 * that must not erase the rest of the scope's layout. `keep` drops stored keys
 * that no longer belong (nodes of a removed workspace). Past the size cap the
 * keys the update did not touch go first, oldest first.
 */
export function writeLayout(
  file: string,
  update: LayoutPositions,
  keep: (key: string) => boolean = () => true,
): Promise<void> {
  // Each write reads, merges and replaces the file: two in flight for one
  // file would lose one's keys, so writes to a file run one after another.
  const run = (writes.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => mergeAndWrite(file, update, keep));
  writes.set(file, run);
  void run
    .finally(() => {
      if (writes.get(file) === run) writes.delete(file);
    })
    .catch(() => undefined);
  return run;
}

const writes = new Map<string, Promise<void>>();

async function mergeAndWrite(
  file: string,
  update: LayoutPositions,
  keep: (key: string) => boolean,
): Promise<void> {
  const merged = new Map<string, [number, number]>();
  const prev = await readLayout(file);
  if (prev) {
    prev.keys.forEach((k, i) => {
      if (keep(k)) merged.set(k, [prev.xy[i * 2], prev.xy[i * 2 + 1]]);
    });
  }
  update.keys.forEach((k, i) => {
    // Re-inserted so the updated keys sit at the end, i.e. are the newest.
    merged.delete(k);
    merged.set(k, [update.xy[i * 2], update.xy[i * 2 + 1]]);
  });
  let entries = [...merged];
  if (entries.length > GRAPH_LAYOUT_MAX_NODES)
    entries = entries.slice(entries.length - GRAPH_LAYOUT_MAX_NODES);

  const out: LayoutFile = {
    v: 1,
    savedAt: Date.now(),
    keys: entries.map(([k]) => k),
    xy: entries.flatMap(([, p]) => p),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(out));
  await fs.rename(tmp, file);
}

/** The positions once any save queued for the file has landed, so a view
 *  reopened right after leaving starts from what it left. */
export async function readLayoutSettled(
  file: string,
): Promise<LayoutPositions | null> {
  await (writes.get(file) ?? Promise.resolve()).catch(() => undefined);
  return readLayout(file);
}

/** Best effort: a file left behind is only a stale cache nobody reads. */
export async function removeLayout(file: string): Promise<void> {
  await (writes.get(file) ?? Promise.resolve()).catch(() => undefined);
  await fs.rm(file, { force: true }).catch(() => undefined);
}

/** For All's file: a file node survives only while its workspace is registered. */
export function keepRegisteredWorkspaces(
  ids: Set<string>,
): (key: string) => boolean {
  return (key) => {
    const ws = workspaceOfNodeKey(key);
    return ws == null ? !key.startsWith("f:") : ids.has(ws);
  };
}
