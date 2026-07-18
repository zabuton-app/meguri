// Cross-workspace aggregation. Runs the per-DB queries against a set of Cores and
// merges/sorts/paginates in memory so the virtual "All" workspace can list every root.
// A single-element set is the fast path (no merge), so callers use this uniformly.
import { resolveSortDir } from "../../shared/sortDir.js";
import type { Core } from "./index.js";
import { searchFiles, randomFiles, listPlayHistory } from "./queries.js";
import type {
  FileRow,
  HistoryEntryRow,
  HistoryPage,
  HistoryQuery,
  SearchQuery,
  SearchResult,
} from "./types.js";

const DEFAULT_LIMIT = 100;

export interface CoreTarget {
  id: string;
  core: Core;
}

export interface FileRef {
  workspaceId: string;
  fileId: number;
}

/** Stamp each row with its owning workspace ID (file IDs are unique only within a workspace). */
function inject<T extends FileRow>(items: T[], wsId: string): T[] {
  for (const it of items) it.workspaceId = wsId;
  return items;
}

export function searchWorkspaces(
  cores: CoreTarget[],
  query: SearchQuery,
): SearchResult {
  if (cores.length === 0) return { items: [], nextCursor: null };
  // Fast path: a single workspace needs no merge/re-sort/re-pagination.
  if (cores.length === 1) {
    const { id, core } = cores[0];
    const res = searchFiles(core.db, query);
    return { items: inject(res.items, id), nextCursor: res.nextCursor };
  }

  return mergeSearchPages(cores, query);
}

export function searchCollection(
  cores: CoreTarget[],
  refs: FileRef[],
  query: SearchQuery,
): SearchResult {
  if (refs.length === 0) return { items: [], nextCursor: null };
  const idsByWs = new Map<string, number[]>();
  for (const ref of refs) {
    const ids = idsByWs.get(ref.workspaceId) ?? [];
    ids.push(ref.fileId);
    idsByWs.set(ref.workspaceId, ids);
  }
  const targets = cores.filter((target) => idsByWs.has(target.id));
  if (targets.length === 0) return { items: [], nextCursor: null };
  if (targets.length === 1) {
    const target = targets[0];
    const res = searchFiles(target.core.db, {
      ...query,
      fileIds: idsByWs.get(target.id) ?? [],
    });
    return { items: inject(res.items, target.id), nextCursor: res.nextCursor };
  }

  return mergeSearchPages(targets, query, idsByWs);
}

interface WsStream<T> {
  wsId: string;
  core: Core;
  nextCursor: number;
  buffer: T[];
  bufIdx: number;
  exhausted: boolean;
}

/** Per-workspace batched fetch: one page of already-sorted rows plus the next cursor. */
type FetchBatch<T> = (
  core: Core,
  wsId: string,
  cursor: number,
  limit: number,
) => { items: T[]; nextCursor: number | null };

/** Thin wrapper over mergePages for the file-search shape (optional per-ws ID restriction). */
function mergeSearchPages(
  targets: CoreTarget[],
  query: SearchQuery,
  idsByWs?: Map<string, number[]>,
): SearchResult {
  return mergePages<FileRow>(
    targets,
    (core, wsId, cursor, limit) => {
      const res = searchFiles(core.db, {
        ...query,
        cursor,
        limit,
        fileIds: idsByWs?.get(wsId),
      });
      return { items: inject(res.items, wsId), nextCursor: res.nextCursor };
    },
    comparatorFor(query.sort, query.sortDir),
    Math.max(1, query.limit ?? DEFAULT_LIMIT),
    Math.max(0, query.cursor ?? 0),
  );
}

/** k-way merge with per-workspace batched fetches — memory stays O(N × batch), not O(N × offset). */
function mergePages<T>(
  targets: CoreTarget[],
  fetchBatch: FetchBatch<T>,
  cmp: (a: T, b: T) => number,
  limit: number,
  offset: number,
): { items: T[]; nextCursor: number | null } {
  const batchSize = limit + 1;

  const streams: WsStream<T>[] = targets.map(({ id, core }) => ({
    wsId: id,
    core,
    nextCursor: 0,
    buffer: [],
    bufIdx: 0,
    exhausted: false,
  }));

  for (const stream of streams) {
    loadStreamBatch(stream, fetchBatch, batchSize);
  }

  const heap = new StreamHeap(streams, cmp);
  for (let i = 0; i < streams.length; i++) {
    if (streamHasItem(streams[i])) heap.push(i);
  }

  let skipped = 0;
  const collected: T[] = [];
  const want = limit + 1;

  while (!heap.isEmpty() && (skipped < offset || collected.length < want)) {
    const si = heap.pop();
    const stream = streams[si];
    const item = stream.buffer[stream.bufIdx];
    stream.bufIdx++;

    if (skipped < offset) {
      skipped++;
    } else {
      collected.push(item);
    }

    if (stream.bufIdx >= stream.buffer.length) {
      loadStreamBatch(stream, fetchBatch, batchSize);
    }
    if (streamHasItem(stream)) {
      heap.push(si);
    }
  }

  const items = collected.slice(0, limit);
  const nextCursor = collected.length > limit ? offset + limit : null;
  return { items, nextCursor };
}

function streamHasItem<T>(stream: WsStream<T>): boolean {
  return stream.bufIdx < stream.buffer.length;
}

function loadStreamBatch<T>(
  stream: WsStream<T>,
  fetchBatch: FetchBatch<T>,
  batchSize: number,
): void {
  if (stream.exhausted) return;
  const res = fetchBatch(
    stream.core,
    stream.wsId,
    stream.nextCursor,
    batchSize,
  );
  stream.buffer = res.items;
  stream.bufIdx = 0;
  if (res.nextCursor != null) {
    stream.nextCursor = res.nextCursor;
  } else {
    stream.exhausted = true;
  }
}

/** Min-heap of stream indices ordered by each stream's current head row. */
class StreamHeap<T> {
  private readonly indices: number[] = [];

  constructor(
    private readonly streams: WsStream<T>[],
    private readonly cmp: (a: T, b: T) => number,
  ) {}

  isEmpty(): boolean {
    return this.indices.length === 0;
  }

  push(si: number): void {
    this.indices.push(si);
    this.siftUp(this.indices.length - 1);
  }

  pop(): number {
    const top = this.indices[0];
    const last = this.indices.pop()!;
    if (this.indices.length > 0) {
      this.indices[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private headAt(heapIdx: number): T {
    const si = this.indices[heapIdx];
    const stream = this.streams[si];
    return stream.buffer[stream.bufIdx];
  }

  private less(a: number, b: number): boolean {
    return this.cmp(this.headAt(a), this.headAt(b)) < 0;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [this.indices[i], this.indices[parent]] = [
        this.indices[parent],
        this.indices[i],
      ];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.indices.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      [this.indices[i], this.indices[smallest]] = [
        this.indices[smallest],
        this.indices[i],
      ];
      i = smallest;
    }
  }
}

/**
 * Cross-workspace play-history timeline. Mirrors history.ts' ORDER BY
 * (played_at DESC, id DESC) with (workspaceId, historyId) as the cross-workspace
 * tiebreak. Runs collapsed per-workspace are not re-collapsed across workspaces:
 * a file exists in one workspace's DB, so cross-ws duplicates can't occur.
 */
export function listHistoryWorkspaces(
  cores: CoreTarget[],
  query: HistoryQuery,
): HistoryPage {
  if (cores.length === 0) return { items: [], nextCursor: null };
  if (cores.length === 1) {
    const { id, core } = cores[0];
    const res = listPlayHistory(core.db, query);
    return { items: inject(res.items, id), nextCursor: res.nextCursor };
  }
  const cmp = (a: HistoryEntryRow, b: HistoryEntryRow): number =>
    b.playedAt - a.playedAt ||
    cmpStr(a.workspaceId, b.workspaceId) ||
    b.historyId - a.historyId;
  return mergePages<HistoryEntryRow>(
    cores,
    (core, wsId, cursor, limit) => {
      const res = listPlayHistory(core.db, { ...query, cursor, limit });
      return { items: inject(res.items, wsId), nextCursor: res.nextCursor };
    },
    cmp,
    Math.max(1, query.limit ?? DEFAULT_LIMIT),
    Math.max(0, query.cursor ?? 0),
  );
}

export function randomWorkspaces(
  cores: CoreTarget[],
  query: SearchQuery,
): FileRow[] {
  const lim = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const all: FileRow[] = [];
  for (const { id, core } of cores) {
    all.push(...inject(randomFiles(core.db, { ...query, limit: lim }), id));
  }
  shuffle(all);
  return all.slice(0, lim);
}

/** Random sampling restricted to a collection's items (per-workspace fileIds). */
export function randomCollection(
  cores: CoreTarget[],
  refs: FileRef[],
  query: SearchQuery,
): FileRow[] {
  if (refs.length === 0) return [];
  const lim = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const idsByWs = new Map<string, number[]>();
  for (const ref of refs) {
    const ids = idsByWs.get(ref.workspaceId) ?? [];
    ids.push(ref.fileId);
    idsByWs.set(ref.workspaceId, ids);
  }
  const all: FileRow[] = [];
  for (const { id, core } of cores) {
    const fileIds = idsByWs.get(id);
    if (!fileIds?.length) continue;
    all.push(
      ...inject(randomFiles(core.db, { ...query, fileIds, limit: lim }), id),
    );
  }
  shuffle(all);
  return all.slice(0, lim);
}

/**
 * Mirror queries.ts' ORDER BY, with workspaceId (then id) as the stable
 * cross-workspace tiebreak. The id term follows each sort's SQL tiebreak:
 * fixed ASC for most sorts, but direction-following for name (see below).
 * Kept in lockstep with orderByFor() in queries/files.ts — the k-way merge
 * assumes each per-DB stream arrives in exactly this order, so any change to
 * one side must be applied to both.
 */
function comparatorFor(
  sort?: string,
  dir?: string,
): (a: FileRow, b: FileRow) => number {
  const direction = resolveSortDir(sort, dir);
  switch (sort) {
    case "rating":
      return (a, b) => cmpNum(a.rating, b.rating, direction) || tiebreak(a, b);
    case "captured":
      return (a, b) =>
        cmpNullableNum(a.capturedAt, b.capturedAt, direction) || tiebreak(a, b);
    case "name":
      // orderByFor()'s name sort tiebreaks on id following the sort direction
      // (so the index can serve the DESC scan); mirror that here.
      return (a, b) =>
        cmpStr(a.relPath, b.relPath, direction) ||
        cmpStr(a.workspaceId, b.workspaceId) ||
        cmpNum(a.id, b.id, direction);
    case "accessed":
      return (a, b) =>
        cmpNullableNum(a.lastAccessedAt, b.lastAccessedAt, direction) ||
        tiebreak(a, b);
    default:
      return (a, b) =>
        cmpStr(a.workspaceId, b.workspaceId) || cmpNum(a.id, b.id, direction);
  }
}

function tiebreak(a: FileRow, b: FileRow): number {
  return cmpStr(a.workspaceId, b.workspaceId) || a.id - b.id;
}

function cmpNum(a: number, b: number, dir: "asc" | "desc"): number {
  return dir === "asc" ? a - b : b - a;
}

function cmpStr(a: string, b: string, dir: "asc" | "desc" = "asc"): number {
  const result = a < b ? -1 : a > b ? 1 : 0;
  return dir === "asc" ? result : -result;
}

/** Sort NULLs last in both directions, matching the SQL ORDER BY expressions. */
function cmpNullableNum(
  a: number | null,
  b: number | null,
  dir: "asc" | "desc",
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmpNum(a, b, dir);
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
