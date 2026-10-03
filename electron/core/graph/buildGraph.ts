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
import {
  graphFileCount,
  graphFiles,
  graphPlayCounts,
  type GraphFileRow,
} from "../queries.js";
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
    files: {
      ws: [],
      id: [],
      metaKey: [],
      relPath: [],
      kind: [],
      hasThumb: [],
      plays: [],
    },
    tags: { namespace: [], name: [] },
    edgeSets: [],
    totalFiles: 0,
    truncated: false,
  };
}

function refKey(workspaceId: string, fileId: number): string {
  return `${workspaceId}:${fileId}`;
}

/**
 * One node per (workspace, meta_key): identical copies of a file inside one
 * workspace share user data, so they are one thing in the graph too. The
 * returned test passes the first copy it is shown, which stands for the rest,
 * and so copies do not use up places meant for other files.
 */
function firstCopies(): (row: Row) => boolean {
  const seen = new Set<string>();
  return (row) => {
    const key = `${row.workspaceId}\u0000${row.metaKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

type FileCount = { rows: number; nodes: number };

/** Up to `cap` files in the query's order, merged across workspaces. */
function rowsInQueryOrder(
  targets: CoreTarget[],
  query: SearchQuery,
  queryOf: (target: CoreTarget) => SearchQuery,
  countOf: (target: CoreTarget) => FileCount,
  cap: number,
): Row[] {
  const rows: Row[] = [];
  for (const target of targets) {
    const isFirst = firstCopies();
    // Reading stops once the cap is reached; skipped copies can at most add
    // their own number of rows to that, which bounds the query as well.
    const { rows: matched, nodes } = countOf(target);
    let taken = 0;
    for (const row of graphFiles(
      target.core.db,
      queryOf(target),
      cap + matched - nodes,
    )) {
      const r: Row = { ...row, workspaceId: target.id };
      if (!isFirst(r)) continue;
      rows.push(r);
      if (++taken >= cap) break;
    }
  }
  if (targets.length > 1) rows.sort(comparatorFor(query.sort, query.sortDir));
  return rows.slice(0, cap);
}

/**
 * Refs read per query when walking a collection in its stored order. Larger
 * than searchCollectionManual's: that one fills a page, this a whole graph.
 */
const MANUAL_CHUNK = 500;

/**
 * Up to `cap` files of a collection in its stored order. The refs are walked
 * a chunk at a time and the walk ends once the graph is full, so a large
 * collection is not read whole for a capped graph (the same approach as
 * searchCollectionManual).
 */
function rowsInStoredOrder(
  targets: CoreTarget[],
  query: SearchQuery,
  refs: FileRef[],
  cap: number,
): Row[] {
  const out: Row[] = [];
  const isFirst = firstCopies();
  for (let i = 0; i < refs.length && out.length < cap; i += MANUAL_CHUNK) {
    const slice = refs.slice(i, i + MANUAL_CHUNK);
    const idsByWs = idsByWorkspace(slice);
    const byRef = new Map<string, Row>();
    for (const target of targets) {
      const ids = idsByWs.get(target.id);
      if (!ids) continue;
      for (const row of graphFiles(target.core.db, { ...query, fileIds: ids }))
        byRef.set(refKey(target.id, row.id), {
          ...row,
          workspaceId: target.id,
        });
    }
    for (const ref of slice) {
      const row = byRef.get(refKey(ref.workspaceId, ref.fileId));
      if (!row || !isFirst(row)) continue;
      out.push(row);
      if (out.length >= cap) break;
    }
  }
  return out;
}

function idsByWorkspace(refs: FileRef[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const ref of refs) {
    const ids = out.get(ref.workspaceId) ?? [];
    ids.push(ref.fileId);
    out.set(ref.workspaceId, ids);
  }
  return out;
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
    const byWs = idsByWorkspace(refs);
    idsByWs = byWs;
    targets = cores.filter((t) => byWs.has(t.id));
  }
  if (targets.length === 0) return emptyPayload();

  const queryOf = (target: CoreTarget): SearchQuery => {
    const ids = idsByWs?.get(target.id);
    return ids ? { ...q, fileIds: ids } : q;
  };
  const counts = new Map(
    targets.map((t) => [t.id, graphFileCount(t.core.db, queryOf(t))]),
  );
  let total = 0;
  for (const count of counts.values()) total += count.nodes;

  // The stored order is not a SQL order, so those rows are read by refs.
  const rows =
    storedOrder && refs
      ? rowsInStoredOrder(targets, q, refs, cap)
      : rowsInQueryOrder(
          targets,
          q,
          queryOf,
          (t) => counts.get(t.id) ?? { rows: 0, nodes: 0 },
          cap,
        );
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
    f.plays.push(0);
  }

  const tagIndex = new Map<string, number>();
  const sets = new Map<EdgeSourceId, EdgeSet>();
  const coreById = new Map(targets.map((t) => [t.id, t.core]));
  for (const [wsId, metaKeys] of keysByWs) {
    const core = coreById.get(wsId);
    const localFiles = fileIndexByWs.get(wsId);
    if (!core || !localFiles) continue;
    for (const [metaKey, plays] of graphPlayCounts(core.db, metaKeys)) {
      const i = localFiles.get(metaKey);
      if (i != null) payload.files.plays[i] = plays;
    }
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
