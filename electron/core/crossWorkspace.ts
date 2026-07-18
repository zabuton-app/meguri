// Cross-workspace aggregation. Runs the per-DB queries against a set of Cores and
// merges/sorts/paginates in memory so the virtual "All" workspace can list every root.
// A single-element set is the fast path (no merge), so callers use this uniformly.
import { resolveSortDir } from "../../shared/sortDir.js";
import type { Core } from "./index.js";
import {
  attachTags,
  listPlayHistory,
  numericCursor,
  randomFiles,
  searchFiles,
  sortValueOf,
  type SeekPosition,
} from "./queries.js";
import type {
  FileRow,
  HistoryEntryRow,
  HistoryPage,
  HistoryQuery,
  SearchCursor,
  SearchQuery,
  SearchResult,
  SearchSeekKey,
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

/** Split the incoming cursor into its offset (UI bookkeeping) and seek key. */
function normalizeCursor(cursor: SearchQuery["cursor"]): {
  offset: number;
  key?: SearchSeekKey;
} {
  if (cursor != null && typeof cursor === "object") {
    return { offset: Math.max(0, cursor.offset), key: cursor.key };
  }
  return { offset: numericCursor(cursor) };
}

/** Per-stream seek derived from the global key (see SeekPosition's tie rules). */
function seekFor(key: SearchSeekKey, wsId: string): SeekPosition {
  const tie =
    wsId === key.ws ? "after-id" : wsId > key.ws ? "all" : "none";
  return { v: key.v, id: key.id, tie };
}

/** Seek key of the last row of a page (rows carry workspaceId via inject()). */
function keyOf(sort: string | undefined, row: FileRow): SearchSeekKey {
  return { v: sortValueOf(sort, row), ws: row.workspaceId, id: row.id };
}

function nextCursorFrom(
  sort: string | undefined,
  offset: number,
  limit: number,
  items: FileRow[],
  hasMore: boolean,
): SearchCursor | null {
  if (!hasMore || items.length === 0) return null;
  return { offset: offset + limit, key: keyOf(sort, items[items.length - 1]) };
}

/** One workspace, no merge needed. Seeks when the cursor carries a key. */
function searchSingle(
  target: CoreTarget,
  query: SearchQuery,
  fileIds?: number[],
): SearchResult {
  const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const { offset, key } = normalizeCursor(query.cursor);
  let items: FileRow[];
  let hasMore: boolean;
  if (key) {
    const res = searchFiles(
      target.core.db,
      { ...query, cursor: undefined, limit: limit + 1, fileIds },
      seekFor(key, target.id),
    );
    hasMore = res.items.length > limit;
    items = inject(res.items.slice(0, limit), target.id);
  } else {
    const res = searchFiles(target.core.db, { ...query, cursor: offset, fileIds });
    hasMore = res.nextCursor != null;
    items = inject(res.items, target.id);
  }
  return {
    items,
    nextCursor: nextCursorFrom(query.sort, offset, limit, items, hasMore),
  };
}

export function searchWorkspaces(
  cores: CoreTarget[],
  query: SearchQuery,
): SearchResult {
  if (cores.length === 0) return { items: [], nextCursor: null };
  // Fast path: a single workspace needs no merge/re-sort/re-pagination.
  if (cores.length === 1) return searchSingle(cores[0], query);

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
    return searchSingle(target, query, idsByWs.get(target.id) ?? []);
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

/**
 * k-way merge for the file search. With a keyed cursor every stream seeks
 * straight to its position (no offset re-scan, and no K× deep-OFFSET cost);
 * an offset-only cursor (first page / backward paging) falls back to skipping
 * merged rows. Batches are fetched without tags — the merge discards rows, so
 * tags are attached only to the final page.
 */
function mergeSearchPages(
  targets: CoreTarget[],
  query: SearchQuery,
  idsByWs?: Map<string, number[]>,
): SearchResult {
  const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const { offset, key } = normalizeCursor(query.cursor);
  const batchSize = limit + 1;

  interface SearchStream {
    wsId: string;
    core: Core;
    buffer: FileRow[];
    bufIdx: number;
    exhausted: boolean;
  }

  const fetchInto = (stream: SearchStream, seek?: SeekPosition): void => {
    const res = searchFiles(
      stream.core.db,
      {
        ...query,
        cursor: seek ? undefined : 0,
        limit: batchSize,
        fileIds: idsByWs?.get(stream.wsId),
      },
      seek,
      { skipTags: true },
    );
    stream.buffer = inject(res.items, stream.wsId);
    stream.bufIdx = 0;
    // Seek fetches return up to batchSize rows (fewer = dry); the initial
    // offset-path fetch signals more via the legacy numeric nextCursor.
    stream.exhausted = seek
      ? res.items.length < batchSize
      : res.nextCursor == null;
  };

  /** Refill from just after the stream's own last row (same-ws continuation). */
  const refill = (stream: SearchStream): void => {
    if (stream.exhausted) {
      stream.buffer = [];
      stream.bufIdx = 0;
      return;
    }
    const last = stream.buffer[stream.buffer.length - 1];
    if (!last) {
      stream.exhausted = true;
      stream.buffer = [];
      stream.bufIdx = 0;
      return;
    }
    fetchInto(stream, {
      v: sortValueOf(query.sort, last),
      id: last.id,
      tie: "after-id",
    });
  };

  const streams: SearchStream[] = targets.map(({ id, core }) => ({
    wsId: id,
    core,
    buffer: [],
    bufIdx: 0,
    exhausted: false,
  }));
  for (const stream of streams) {
    fetchInto(stream, key ? seekFor(key, stream.wsId) : undefined);
  }

  const cmp = comparatorFor(query.sort, query.sortDir);
  const heap = new StreamHeap(streams, cmp);
  for (let i = 0; i < streams.length; i++) {
    if (streamHasItem(streams[i])) heap.push(i);
  }

  // With a seek key the streams already start at the page position.
  let toSkip = key ? 0 : offset;
  const collected: FileRow[] = [];
  const want = limit + 1;

  while (!heap.isEmpty() && (toSkip > 0 || collected.length < want)) {
    const si = heap.pop();
    const stream = streams[si];
    const item = stream.buffer[stream.bufIdx];
    stream.bufIdx++;

    if (toSkip > 0) {
      toSkip--;
    } else {
      collected.push(item);
    }

    if (stream.bufIdx >= stream.buffer.length) refill(stream);
    if (streamHasItem(stream)) heap.push(si);
  }

  const items = collected.slice(0, limit);
  const byWs = new Map<string, FileRow[]>();
  for (const it of items) {
    const rows = byWs.get(it.workspaceId) ?? [];
    rows.push(it);
    byWs.set(it.workspaceId, rows);
  }
  for (const { id, core } of targets) {
    const rows = byWs.get(id);
    if (rows?.length) attachTags(core.db, rows);
  }

  return {
    items,
    nextCursor: nextCursorFrom(
      query.sort,
      offset,
      limit,
      items,
      collected.length > limit,
    ),
  };
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

/** Minimal buffered-stream shape shared by the offset and seek merge paths. */
interface BufferedStream<T> {
  buffer: T[];
  bufIdx: number;
}

function streamHasItem<T>(stream: BufferedStream<T>): boolean {
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
    private readonly streams: BufferedStream<T>[],
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
