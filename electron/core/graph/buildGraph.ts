// Builds the graph view's payload for one query over one or more workspaces:
// the matching files (capped, in the query's order) and every relationship the
// edge sources find among them, as column arrays.
import { MANUAL_SORT } from "../../../shared/sortDir.js";
import type {
  EdgeSet,
  EdgeSourceId,
  GraphPayload,
} from "../../../shared/ipc/graph.js";
import {
  comparatorFor,
  type CoreTarget,
  type FileRef,
} from "../crossWorkspace.js";
import { graphFileCount, graphFiles, type GraphFileRow } from "../queries.js";
import type { SearchQuery } from "../types.js";
import { EDGE_SOURCES, type EdgeSource } from "./edgeSources.js";

export interface BuildGraphOptions {
  /** Most files the payload carries. */
  cap: number;
  /** Restrict to these files (a collection, or the duplicates filter). */
  refs?: FileRef[];
  /** `refs` is the collection's hand-arranged order and the query sorts by it. */
  storedOrder?: boolean;
  /** Injected by tests; defaults to EDGE_SOURCES. */
  sources?: readonly EdgeSource[];
}

type Row = GraphFileRow & { workspaceId: string };

function emptyPayload(): GraphPayload {
  return {
    workspaces: [],
    files: { ws: [], id: [], metaKey: [], relPath: [], kind: [], hasThumb: [] },
    tags: { namespace: [], name: [] },
    edgeSets: [],
    totalFiles: 0,
    truncated: false,
  };
}

function refKey(workspaceId: string, fileId: number): string {
  return `${workspaceId}:${fileId}`;
}

export function buildGraph(
  cores: CoreTarget[],
  query: SearchQuery,
  opts: BuildGraphOptions,
): GraphPayload {
  const { cap, refs, storedOrder = false } = opts;
  // Manual order exists only as a collection's stored order; anywhere else the
  // search falls back to the default order, as files_search does.
  const q: SearchQuery =
    query.sort === MANUAL_SORT
      ? { ...query, sort: undefined, sortDir: undefined }
      : query;

  let targets = cores;
  let idsByWs: Map<string, number[]> | null = null;
  if (refs) {
    if (refs.length === 0) return emptyPayload();
    idsByWs = new Map();
    for (const ref of refs) {
      const ids = idsByWs.get(ref.workspaceId) ?? [];
      ids.push(ref.fileId);
      idsByWs.set(ref.workspaceId, ids);
    }
    const byWs = idsByWs;
    targets = cores.filter((t) => byWs.has(t.id));
  }
  if (targets.length === 0) return emptyPayload();

  let total = 0;
  let rows: Row[] = [];
  for (const target of targets) {
    const ids = idsByWs?.get(target.id);
    const tq: SearchQuery = ids ? { ...q, fileIds: ids } : q;
    // The stored order is not a SQL order, so every matching row of the
    // collection is read and the cut is made after reordering below.
    const db = target.core.db;
    const count = graphFileCount(db, tq);
    // Identical copies collapse into one node below; reading that many rows
    // more keeps them from pushing unique files past the cap.
    const copies = count.rows - count.nodes;
    const limit = storedOrder && ids ? Math.max(cap, ids.length) : cap + copies;
    for (const row of graphFiles(db, tq, limit))
      rows.push({ ...row, workspaceId: target.id });
    total += count.nodes;
  }

  // One node per (workspace, meta_key): identical copies of a file inside one
  // workspace share user data, so they are one thing in the graph too. The
  // first copy in the query's order stands for them. Done before the cap, so
  // copies do not use up places meant for other files.
  const firstCopy = (list: Row[]): Row[] => {
    const seen = new Set<string>();
    return list.filter((r) => {
      const key = `${r.workspaceId}\u0000${r.metaKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  if (storedOrder && refs) {
    const order = new Map(
      refs.map((r, i) => [refKey(r.workspaceId, r.fileId), i]),
    );
    rows.sort(
      (a, b) =>
        (order.get(refKey(a.workspaceId, a.id)) ?? Infinity) -
        (order.get(refKey(b.workspaceId, b.id)) ?? Infinity),
    );
  } else if (targets.length > 1) {
    rows.sort(comparatorFor(q.sort, q.sortDir));
  }
  rows = firstCopy(rows).slice(0, cap);
  const truncated = total > rows.length;

  const payload = emptyPayload();
  payload.totalFiles = total;
  payload.truncated = truncated;

  const wsIndex = new Map<string, number>();
  const keysByWs = new Map<string, string[]>();
  const fileIndexByWs = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let seen = fileIndexByWs.get(row.workspaceId);
    if (!seen) {
      seen = new Map();
      fileIndexByWs.set(row.workspaceId, seen);
      keysByWs.set(row.workspaceId, []);
      wsIndex.set(row.workspaceId, payload.workspaces.length);
      payload.workspaces.push(row.workspaceId);
    }
    if (seen.has(row.metaKey)) continue;
    seen.set(row.metaKey, payload.files.id.length);
    keysByWs.get(row.workspaceId)?.push(row.metaKey);
    const f = payload.files;
    f.ws.push(wsIndex.get(row.workspaceId) ?? 0);
    f.id.push(row.id);
    f.metaKey.push(row.metaKey);
    f.relPath.push(row.relPath);
    f.kind.push(row.kind);
    f.hasThumb.push(row.thumbStatus === "done" && Number(row.hasThumb) === 1);
  }

  const tagIndex = new Map<string, number>();
  const sets = new Map<EdgeSourceId, EdgeSet>();
  const coreById = new Map(targets.map((t) => [t.id, t.core]));
  for (const [wsId, metaKeys] of keysByWs) {
    const core = coreById.get(wsId);
    const localFiles = fileIndexByWs.get(wsId);
    if (!core || !localFiles) continue;
    for (const source of opts.sources ?? EDGE_SOURCES) {
      const res = source.build(core.db, metaKeys);
      if (res.a.length === 0) continue;
      let set = sets.get(source.id);
      if (!set) {
        set = { source: source.id, kind: res.kind, a: [], b: [] };
        if (res.weight) set.weight = [];
        sets.set(source.id, set);
      }
      // Local indices → payload indices. Tags merge by (namespace, name)
      // across workspaces, which is what links files of different roots.
      const tagMap = res.tags.map((t) => {
        const key = `${t.namespace}\u0000${t.name}`;
        let i = tagIndex.get(key);
        if (i == null) {
          i = payload.tags.name.length;
          tagIndex.set(key, i);
          payload.tags.namespace.push(t.namespace);
          payload.tags.name.push(t.name);
        }
        return i;
      });
      const fileOf = (local: number) => localFiles.get(metaKeys[local]) ?? -1;
      for (let i = 0; i < res.a.length; i++) {
        const a = fileOf(res.a[i]);
        const b = res.kind === "file-tag" ? tagMap[res.b[i]] : fileOf(res.b[i]);
        if (a < 0 || b == null || b < 0) continue;
        set.a.push(a);
        set.b.push(b);
        set.weight?.push(res.weight?.[i] ?? 1);
      }
    }
  }
  payload.edgeSets = [...sets.values()];
  return payload;
}
