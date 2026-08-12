// IPC DTO schemas — single source of truth shared by main and renderer.
//
// Backend handlers and the renderer client both import from here. The `*Schema`
// values can be used at runtime (e.g. for .parse() validation in main); the
// inferred types satisfy the prior hand-written interfaces.
import { z } from "zod";
import { MAX_TAG_REF_NAME } from "../tags.js";

export const KindSchema = z.enum(["video", "image"]);
export type Kind = z.infer<typeof KindSchema>;

export const TagInfoSchema = z.object({
  id: z.number(),
  name: z.string(),
  namespace: z.string(),
  source: z.string(),
  score: z.number().nullable(),
});
export type TagInfo = z.infer<typeof TagInfoSchema>;

export const PlayEntrySchema = z.object({
  playedAt: z.number(),
  position: z.number().nullable(),
  via: z.string(),
});
export type PlayEntry = z.infer<typeof PlayEntrySchema>;

export const SceneBookmarkSchema = z.object({
  id: z.number(),
  sec: z.number(),
  /** Unix seconds. Currently not shown in the UI; kept for future sort-by-recent and audit. */
  createdAt: z.number(),
});
export type SceneBookmark = z.infer<typeof SceneBookmarkSchema>;

export const FileRowSchema = z.object({
  id: z.number(),
  /** Owning workspace ID. Injected by the IPC layer (file IDs are unique only within a workspace). */
  workspaceId: z.string(),
  relPath: z.string(),
  kind: z.string(),
  ext: z.string().nullable(),
  size: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration: z.number().nullable(),
  rating: z.number(),
  /** Favorite flag stored as 0/1 in SQLite. */
  favorite: z.number(),
  thumbStatus: z.string(),
  /** Sampled content hash (see scan.ts). Null until the scan computes it; used by the "hash" sort. */
  contentHash: z.string().nullable().optional(),
  capturedAt: z.number().nullable(),
  /** Filesystem creation time (birthtime, Unix seconds). Null where the FS doesn't provide it. */
  btime: z.number().nullable(),
  /** Last time the file's detail was opened (Unix seconds). Null if never opened. */
  lastAccessedAt: z.number().nullable(),
  /** Tags attached to search results (for grid display). For detail fetches, use FileDetail.tags. */
  tags: z.array(TagInfoSchema).optional(),
});
export type FileRow = z.infer<typeof FileRowSchema>;

export const FileDetailSchema = FileRowSchema.extend({
  absPath: z.string(),
  codec: z.string().nullable(),
  fps: z.number().nullable(),
  mtime: z.number().nullable(),
  meta: z.unknown(),
  tags: z.array(TagInfoSchema),
  playHistory: z.array(PlayEntrySchema),
  bookmarks: z.array(SceneBookmarkSchema),
  /** User-chosen thumbnail offset in seconds. Null when the auto frame is in use. */
  thumbOffsetSec: z.number().nullable(),
});
export type FileDetail = z.infer<typeof FileDetailSchema>;

/**
 * Keyset-pagination cursor. `offset` is the global index of the page's first
 * row (kept for the UI's virtualizer padding and backward paging); `key` is
 * the seek position — the sort-key value / workspace / id of the last row
 * already returned. When `key` is present the query layer seeks past it
 * instead of scanning `offset` rows (deep pages stay O(page), not O(offset)).
 * Backward pages are fetched with an offset-only cursor (no `key`).
 */
export const SearchSeekKeySchema = z.object({
  /** Active sort key's value on the last returned row (null for id sorts or NULL columns). */
  v: z.union([z.string(), z.number()]).nullable(),
  ws: z.string(),
  id: z.number().int(),
});
export type SearchSeekKey = z.infer<typeof SearchSeekKeySchema>;

export const SearchCursorSchema = z.object({
  offset: z.number().int().min(0),
  key: SearchSeekKeySchema.optional(),
});
export type SearchCursor = z.infer<typeof SearchCursorSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagSource: z.string().optional(),
  kind: z.string().optional(),
  ratingMin: z.number().optional(),
  favorite: z.boolean().optional(),
  /** Restrict to files that have duplicates (same content_hash + size, cross-workspace in the All view). */
  duplicates: z.boolean().optional(),
  played: z.boolean().optional(),
  playedVia: z.string().optional(),
  capturedFrom: z.number().optional(),
  capturedTo: z.number().optional(),
  /** Filesystem creation date (birthtime) range, Unix seconds. Files with no btime never match. */
  btimeFrom: z.number().optional(),
  btimeTo: z.number().optional(),
  sort: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  fileIds: z.array(z.number()).optional(),
  // Number = plain offset (legacy / backward paging); object = keyset cursor.
  cursor: z.union([z.number().int().min(0), SearchCursorSchema]).optional(),
  // Clamped again to MAX_LIMIT (500) in the query layer; bounding it here rejects
  // absurd values at the IPC boundary and double-guards the multi-core cross-
  // workspace path, where the per-core clamp doesn't bound the merged slice.
  limit: z.number().int().min(1).max(500).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const HistoryQuerySchema = z.object({
  via: z.enum(["browser", "external"]).optional(),
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

/** One row of the cross-file play-history timeline: the played file plus event info. */
export const HistoryEntrySchema = FileRowSchema.extend({
  /** play_history row ID of the newest event in the collapsed run. */
  historyId: z.number(),
  /** Unix seconds of the newest event in the collapsed run. */
  playedAt: z.number(),
  via: z.enum(["browser", "external"]),
  position: z.number().nullable(),
  /** Total play count of this file (all events, not just this run). */
  playCount: z.number(),
});
export type HistoryEntryRow = z.infer<typeof HistoryEntrySchema>;

export const HistoryPageSchema = z.object({
  items: z.array(HistoryEntrySchema),
  nextCursor: z.number().nullable(),
});
export type HistoryPage = z.infer<typeof HistoryPageSchema>;

/** Files sharing the same (content_hash, size) pair — treated as identical content. */
export const DuplicateGroupSchema = z.object({
  contentHash: z.string(),
  size: z.number(),
  files: z.array(FileRowSchema),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

export const DuplicatesResultSchema = z.object({
  groups: z.array(DuplicateGroupSchema),
  /** Total file count across all returned groups (for the summary line). */
  fileCount: z.number(),
  /** True when the group list was cut off at the server-side cap. */
  truncated: z.boolean(),
});
export type DuplicatesResult = z.infer<typeof DuplicatesResultSchema>;

/**
 * A tag addressed by name rather than by `tags.id`. Each workspace has its own
 * database, so the same logical tag carries a different id in each — a name is
 * the only identifier that survives the cross-workspace ("All") view.
 */
export const TagRefSchema = z.object({
  namespace: z.string().max(32),
  // A reference to an existing tag, so this is MAX_TAG_REF_NAME rather than the
  // creation cap: tags named before that cap existed have to stay renameable,
  // mergeable and deletable. Names the user creates are bounded where they are
  // created (file_add_tag, tag_rename's `to`).
  name: z.string().min(1).max(MAX_TAG_REF_NAME),
});
export type TagRef = z.infer<typeof TagRefSchema>;

export const TagSourceCountSchema = z.object({
  source: z.string(),
  count: z.number(),
});
export type TagSourceCount = z.infer<typeof TagSourceCountSchema>;

/** One row of the tag management screen, aggregated over the workspaces in scope. */
export const TagSummarySchema = z.object({
  namespace: z.string(),
  name: z.string(),
  /** Display and query form ("beach" | "res:4k"). Also the stable list key. */
  qualified: z.string(),
  /** Distinct alive files carrying the tag, summed over the workspaces in scope. */
  fileCount: z.number(),
  /** Same basis, split by origin. A file tagged twice counts once per source. */
  bySource: z.array(TagSourceCountSchema),
  /** namespace !== "" — rename / merge / delete are rejected for these. */
  pipelineOwned: z.boolean(),
  /** Workspaces holding the tag; only meaningful in the "All" view. */
  workspaceIds: z.array(z.string()),
});
export type TagSummary = z.infer<typeof TagSummarySchema>;

export const TagListSchema = z.object({
  tags: z.array(TagSummarySchema),
  /** True when the catalog exceeded MAX_TAG_LIST and was cut short. */
  truncated: z.boolean(),
});
export type TagList = z.infer<typeof TagListSchema>;

export const SearchResultSchema = z.object({
  items: z.array(FileRowSchema),
  // Number when produced by the per-DB offset path; keyset object from the
  // workspace-level search (both are accepted back as SearchQuery.cursor).
  nextCursor: z.union([z.number(), SearchCursorSchema]).nullable(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const AppStatusSchema = z.object({
  root: z.string().nullable(),
  ready: z.boolean(),
  initError: z.string().nullable(),
  initErrorKind: z.enum(["schema_mismatch", "unknown"]).nullable(),
  mediaBase: z.string().nullable(),
  /** Active workspace ID. Used in media URLs (/ws/<id>/...). */
  workspaceId: z.string().nullable(),
  /** True while running unpackaged for local development. */
  devMode: z.boolean(),
});
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const WorkspaceInfoSchema = z.object({
  id: z.string(),
  path: z.string(),
  label: z.string(),
  active: z.boolean(),
  emoji: z.string().optional(),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

export const UserCollectionItemSchema = z.object({
  workspaceId: z.string(),
  fileId: z.number(),
  addedAt: z.number(),
});
export type UserCollectionItem = z.infer<typeof UserCollectionItemSchema>;

export const UserCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().optional(),
  active: z.boolean(),
  items: z.array(UserCollectionItemSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type UserCollection = z.infer<typeof UserCollectionSchema>;

export const WorkspacesListSchema = z.object({
  workspaces: z.array(WorkspaceInfoSchema),
  collections: z.array(UserCollectionSchema),
  activeId: z.string().nullable(),
});
export type WorkspacesList = z.infer<typeof WorkspacesListSchema>;

export const WorkspaceStatsSchema = z.object({
  /** Visible file count (matches the list view). Sums across roots when the "All" view is active. */
  fileCount: z.number(),
  /** Last successful scan time (Unix seconds). Max across roots for "All". Null if never scanned. */
  lastScanAt: z.number().nullable(),
});
export type WorkspaceStats = z.infer<typeof WorkspaceStatsSchema>;

// --- Events (main → renderer) ---

export const ScanProgressSchema = z.object({
  jobId: z.string(),
  phase: z.string(),
  done: z.number(),
  total: z.number(),
});
export type ScanProgress = z.infer<typeof ScanProgressSchema>;

export const ScanDoneSchema = z.object({
  jobId: z.string(),
  stats: z.object({
    inserted: z.number(),
    updated: z.number(),
    moved: z.number(),
    deleted: z.number(),
    unchanged: z.number(),
  }),
  aborted: z.boolean().optional(),
  error: z.boolean().optional(),
});
export type ScanDone = z.infer<typeof ScanDoneSchema>;

export const ThumbDoneSchema = z.object({
  id: z.number(),
  workspaceId: z.string().nullable().optional(),
});
export type ThumbDone = z.infer<typeof ThumbDoneSchema>;

// --- Update check (GitHub Releases) ---

export const UpdateInfoSchema = z.object({
  /** Currently running version (app.getVersion(), e.g. "0.1.0"). */
  current: z.string(),
  /** Latest stable release version, without the leading "v" (e.g. "0.2.0"). */
  latest: z.string(),
  /** True when `latest` is newer than `current` and not ignored by the user. */
  available: z.boolean(),
  /**
   * Where the "View" action should send the user: the GitHub release page, or
   * the MS Store product deep link (`ms-windows-store://`) on Store installs.
   */
  url: z.url(),
  /** Release name/title, when present. */
  name: z.string().nullable().optional(),
  /** ISO timestamp the release was published, when present. */
  publishedAt: z.string().nullable().optional(),
});
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>;
