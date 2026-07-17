// IPC DTO schemas — single source of truth shared by main and renderer.
//
// Backend handlers and the renderer client both import from here. The `*Schema`
// values can be used at runtime (e.g. for .parse() validation in main); the
// inferred types satisfy the prior hand-written interfaces.
import { z } from "zod";

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
  capturedAt: z.number().nullable(),
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

export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagSource: z.string().optional(),
  kind: z.string().optional(),
  ratingMin: z.number().optional(),
  favorite: z.boolean().optional(),
  played: z.boolean().optional(),
  playedVia: z.string().optional(),
  capturedFrom: z.number().optional(),
  capturedTo: z.number().optional(),
  sort: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  fileIds: z.array(z.number()).optional(),
  cursor: z.number().int().min(0).optional(),
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
  via: z.string(),
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

export const SearchResultSchema = z.object({
  items: z.array(FileRowSchema),
  nextCursor: z.number().nullable(),
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
  /** GitHub Releases page URL for the latest release. */
  url: z.url(),
  /** Release name/title, when present. */
  name: z.string().nullable().optional(),
  /** ISO timestamp the release was published, when present. */
  publishedAt: z.string().nullable().optional(),
});
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>;
