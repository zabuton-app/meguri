// IPC DTO schemas — single source of truth shared by main and renderer.
//
// Backend handlers and the renderer client both import from here. The `*Schema`
// values can be used at runtime (e.g. for .parse() validation in main); the
// inferred types satisfy the prior hand-written interfaces.
import { z } from "zod";
import { MAX_TAG_NAME, MAX_TAG_REF_NAME } from "../tags.js";
import {
  CASE_MODES,
  KEYWORD_MODES,
  MAX_AUTO_TAG_KEYWORD_TAGS,
  MAX_AUTO_TAG_KEYWORD_TERMS,
  MAX_AUTO_TAG_EXCLUDE,
  MAX_AUTO_TAG_FOLDER_RULES,
  MAX_AUTO_TAG_FOLDER_TAGS,
  MAX_AUTO_TAG_KEYWORDS,
  MAX_AUTO_TAG_PATTERN,
  MAX_AUTO_TAG_RULES,
  MAX_AUTO_TAG_RULE_NAME,
  MAX_AUTO_TAG_TEMPLATE,
  MAX_AUTO_TAG_TERMS,
  RULE_KINDS,
  type AutoTagConfig,
  type FolderRule,
  type KeywordEntry,
  type TagRule,
} from "../autoTag.js";
import { MAX_FOLDER_PATH, isNormalizedFolderPath } from "../folderPath.js";
import { MAX_WORKSPACE_ID } from "../workspaceIds.js";
import { MAX_EXCLUSION_PATTERN, PATTERN_KINDS } from "../scanExclusions.js";
import { GRAPH_NODE_KEY_MAX } from "./graph.js";
import { ACTIVITY_METRICS } from "./activity.js";
import { TIMELINE_AXES } from "./timeline.js";
import { parseDay } from "../day.js";

export const KindSchema = z.enum(["video", "image", "audio"]);
export type Kind = z.infer<typeof KindSchema>;

// App logo variants (window/tray/in-app icon). "dark" is the original
// vermilion kanji icon, "light" the inverted unbleached-cotton one, and
// "enso" a pictorial brush-circle-with-media-card mark on navy. Persisted in
// main's settings (the tray exists before any renderer), so the ids are a
// stable API shared by the stored settings, IPC, and the bundled assets — do not
// rename.
export const LOGO_IDS = ["dark", "light", "enso"] as const;
export const LogoIdSchema = z.enum(LOGO_IDS);
export type LogoId = z.infer<typeof LogoIdSchema>;

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
  /** Whether a thumbnail file was actually produced, as 0/1 (SQLite has no boolean).
   *  Distinct from thumbStatus: audio is marked 'done' whether or not it embeds cover
   *  art, so status alone can't tell a real thumbnail from a deliberate absence. */
  hasThumb: z.number(),
  /** Sampled content hash (see scan.ts). Null until the scan computes it; used by the "hash" sort. */
  contentHash: z.string().nullable().optional(),
  capturedAt: z.number().nullable(),
  /** Filesystem creation time (birthtime, Unix seconds). Null where the FS doesn't provide it. */
  btime: z.number().nullable(),
  /** When the file entered the index (created_at, Unix seconds). */
  addedAt: z.number(),
  /** Last time the file's detail was opened (Unix seconds). Null if never opened. */
  lastAccessedAt: z.number().nullable(),
  /** Where playback was last stopped (seconds), or null when there is nothing to
   *  resume: never played, played to the end, or barely begun (see shared/resume.ts). */
  resumePosition: z.number().nullable(),
  /** resumePosition as a fraction of the duration (0..1). Null when either is unknown. */
  progress: z.number().nullable(),
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

/**
 * A folder inside a workspace in the normalized "/"-separated form ("" is the
 * root); see shared/folderPath.ts. Checked here so a malformed path never
 * reaches the range the query builds from it.
 */
export const FolderPathSchema = z
  .string()
  .max(MAX_FOLDER_PATH)
  .refine(isNormalizedFolderPath, { message: "malformed folder path" });
export type FolderPath = z.infer<typeof FolderPathSchema>;

/** Restricts a search to one folder: its direct files, or everything under it. */
export const FolderScopeSchema = z.object({
  path: FolderPathSchema,
  recursive: z.boolean(),
});
export type FolderScope = z.infer<typeof FolderScopeSchema>;

export const ActivityMetricSchema = z.enum(ACTIVITY_METRICS);

export const TimelineAxisSchema = z.enum(TIMELINE_AXES);

/** A calendar day, "YYYY-MM-DD", read in the main process's local time. */
export const DaySchema = z
  .string()
  .max(10)
  .refine((v) => parseDay(v) !== null, { message: "not a calendar day" });

export const SearchCursorSchema = z.object({
  offset: z.number().int().min(0),
  key: SearchSeekKeySchema.optional(),
});
export type SearchCursor = z.infer<typeof SearchCursorSchema>;

/**
 * Queries stored before the kind filter took several kinds (smart collections,
 * recent searches) carry `kind: "video"`. Read that as `kinds: ["video"]` so
 * they keep their condition instead of quietly losing it to key stripping.
 * It is for stored data only; nothing sends `kind` over IPC any more.
 */
function liftLegacyKind(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return value;
  const { kind, ...rest } = value as Record<string, unknown>;
  const hasKinds = Array.isArray(rest.kinds) && rest.kinds.length > 0;
  if (typeof kind === "string" && kind !== "" && !hasKinds)
    return { ...rest, kinds: [kind] };
  return rest;
}

export const SearchQuerySchema = z.preprocess(
  liftLegacyKind,
  z.object({
    q: z.string().optional(),
    tags: z.array(z.string()).optional(),
    tagSource: z.string().optional(),
    /** Any of these kinds; absent or empty means every kind. */
    // Plain strings, so a kind from a newer build survives; capped because
    // the query binds one placeholder per kind.
    kinds: z.array(z.string().max(32)).max(16).optional(),
    ratingMin: z.number().optional(),
    favorite: z.boolean().optional(),
    /** Restrict to files that have duplicates (same content_hash + size, cross-workspace in the All view). */
    duplicates: z.boolean().optional(),
    /** Only videos with an embedded text subtitle track the player can show. */
    subtitles: z.boolean().optional(),
    played: z.boolean().optional(),
    /** Only files left part-way through (a resume point is stored). */
    inProgress: z.boolean().optional(),
    playedVia: z.string().optional(),
    capturedFrom: z.number().optional(),
    capturedTo: z.number().optional(),
    /** Filesystem creation date (birthtime) range, Unix seconds. Files with no btime never match. */
    btimeFrom: z.number().optional(),
    btimeTo: z.number().optional(),
    /** Range of the time the file entered the index (created_at), Unix seconds. */
    addedFrom: z.number().optional(),
    addedTo: z.number().optional(),
    /** Played-at range, Unix seconds: files with a play history row inside it. */
    playedFrom: z.number().optional(),
    playedTo: z.number().optional(),
    sort: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    /** Folder view: only files under this folder (see FolderScopeSchema). */
    folder: FolderScopeSchema.optional(),
    fileIds: z.array(z.number()).optional(),
    // Number = plain offset (legacy / backward paging); object = keyset cursor.
    cursor: z.union([z.number().int().min(0), SearchCursorSchema]).optional(),
    // Clamped again to MAX_LIMIT (500) in the query layer; bounding it here rejects
    // absurd values at the IPC boundary and double-guards the multi-core cross-
    // workspace path, where the per-core clamp doesn't bound the merged slice.
    limit: z.number().int().min(1).max(500).optional(),
  }),
);
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * A saved search (smart collection), stored in the library's
 * `smart_collections` table (electron/core/smartCollectionStore.ts).
 */
export const SmartCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: SearchQuerySchema,
  /**
   * The workspace `query.folder` lies in. A folder path means nothing outside
   * its own workspace, so it is saved only together with one.
   */
  workspaceId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SmartCollection = z.infer<typeof SmartCollectionSchema>;

/** The saved searches, newest first, and the one the list opens with. */
export interface StoredSmartCollections {
  collections: SmartCollection[];
  defaultId: string | null;
}

/**
 * Keyset cursor of the play-history timeline: the last row of the page it
 * follows, in the timeline's order (played_at DESC, id DESC, then workspace).
 * Each workspace seeks straight past it instead of re-reading from the start.
 */
export const HistoryCursorSchema = z.object({
  /** playedAt of the last row. */
  at: z.number(),
  /** historyId of the last row. */
  id: z.number().int(),
  /** workspaceId of the last row (breaks ties between workspaces). */
  ws: z.string(),
});
export type HistoryCursor = z.infer<typeof HistoryCursorSchema>;

export const HistoryQuerySchema = z.object({
  via: z.enum(["browser", "external"]).optional(),
  // Number = offset over collapsed rows (the first page is 0); object = keyset.
  cursor: z.union([z.number().int().min(0), HistoryCursorSchema]).optional(),
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
  nextCursor: HistoryCursorSchema.nullable(),
});
export type HistoryPage = z.infer<typeof HistoryPageSchema>;

/** A file the last scan of its workspace did not find on disk (#277). */
export const MissingFileSchema = FileRowSchema.extend({
  /** When the scan found the file gone (Unix seconds). */
  deletedAt: z.number(),
});
export type MissingFileRow = z.infer<typeof MissingFileSchema>;

export const MissingFilesResultSchema = z.object({
  /** The most recently gone first, at most MAX_BULK_FILES of them, so that
   *  selecting all of them is one removal. */
  items: z.array(MissingFileSchema),
  /** All missing files of the workspaces listed. */
  total: z.number(),
  /** Some workspace in scope is being scanned and was left out: mid-scan,
   *  and through a whole rebuild, its files on disk read as missing. */
  scanning: z.boolean(),
});
export type MissingFilesResult = z.infer<typeof MissingFilesResultSchema>;

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

/**
 * Auto-tagging configuration (shared/autoTag.ts). Shape and size only: a rule
 * whose pattern does not compile is stored as typed — the screen shows the
 * error next to it and the engine skips it — so half-finished edits survive.
 */
export const AutoTagRuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(MAX_AUTO_TAG_RULE_NAME),
  kind: z.enum(RULE_KINDS),
  pattern: z.string().max(MAX_AUTO_TAG_PATTERN),
  template: z.string().max(MAX_AUTO_TAG_TEMPLATE),
  exclude: z.string().max(MAX_AUTO_TAG_EXCLUDE),
  ci: z.boolean(),
  split: z.boolean(),
  caseMode: z.enum(CASE_MODES),
  enabled: z.boolean(),
}) satisfies z.ZodType<TagRule>;

const autoTagTerm = z.string().min(1).max(MAX_TAG_NAME);

export const AutoTagKeywordSchema = z.object({
  id: z.string().min(1).max(64),
  terms: z.array(autoTagTerm).max(MAX_AUTO_TAG_KEYWORD_TERMS),
  tags: z.array(autoTagTerm).max(MAX_AUTO_TAG_KEYWORD_TAGS),
  mode: z.enum(KEYWORD_MODES),
}) satisfies z.ZodType<KeywordEntry>;

export const AutoTagFolderSchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
  folder: z.string().max(MAX_FOLDER_PATH).refine(isNormalizedFolderPath),
  tags: z.array(autoTagTerm).max(MAX_AUTO_TAG_FOLDER_TAGS),
  enabled: z.boolean(),
}) satisfies z.ZodType<FolderRule>;

export const AutoTagConfigSchema = z.object({
  rules: z.array(AutoTagRuleSchema).max(MAX_AUTO_TAG_RULES),
  keywords: z.array(AutoTagKeywordSchema).max(MAX_AUTO_TAG_KEYWORDS),
  folders: z.array(AutoTagFolderSchema).max(MAX_AUTO_TAG_FOLDER_RULES),
  applyOnScan: z.boolean(),
  ignored: z.array(autoTagTerm).max(MAX_AUTO_TAG_TERMS),
}) satisfies z.ZodType<AutoTagConfig>;

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

/** One child folder in the folder view. Derived from rel_path; never stored. */
export const FolderEntrySchema = z.object({
  name: z.string(),
  path: FolderPathSchema,
  /** Live media under it, at any depth. Always at least 1: empty folders are not listed. */
  count: z.number().int().positive(),
  /** Folders directly inside it that hold live media. */
  subfolders: z.number().int().nonnegative(),
  /** Up to four files for the card's mosaic, those with a thumbnail first. */
  previews: z.array(FileRowSchema).max(4),
});
export type FolderEntry = z.infer<typeof FolderEntrySchema>;

export const FolderListingSchema = z.object({
  /**
   * The folder actually listed: the one asked for, or — when it has no live
   * media left (deleted, renamed away) — its nearest ancestor that does.
   */
  path: FolderPathSchema,
  folders: z.array(FolderEntrySchema),
  /** Live media directly in `path`. */
  fileCount: z.number().int().nonnegative(),
});
export type FolderListing = z.infer<typeof FolderListingSchema>;

/** A folder selection expanded to its files, one entry per requested folder. */
export const FolderFilesResultSchema = z.array(
  z.object({
    path: FolderPathSchema,
    /** Live media under the folder, at any depth. */
    total: z.number().int().nonnegative(),
    /** The files, in rel_path order; cut short once the call's row budget is spent. */
    rows: z.array(FileRowSchema),
  }),
);
export type FolderFilesResult = z.infer<typeof FolderFilesResultSchema>;

export const LibraryMergeProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type LibraryMergeProgress = z.infer<typeof LibraryMergeProgressSchema>;

/**
 * Why a workspace's metadata could not be merged into the library:
 * - diskFull: no room for its backup copy or the merge
 * - backup: its backup copy could not be written for another reason
 * - merge: the merge itself failed (rolled back)
 * - open: its database could not be opened at all
 */
export const LibraryMergeFailureReasonSchema = z.enum([
  "diskFull",
  "backup",
  "merge",
  "open",
]);
export type LibraryMergeFailureReason = z.infer<
  typeof LibraryMergeFailureReasonSchema
>;

export const LibraryMergeFailureSchema = z.object({
  label: z.string(),
  reason: LibraryMergeFailureReasonSchema,
});
export type LibraryMergeFailure = z.infer<typeof LibraryMergeFailureSchema>;

/** The library:merge event: progress while it runs, then the outcome. */
export const LibraryMergeEventSchema = z.discriminatedUnion("state", [
  LibraryMergeProgressSchema.extend({ state: z.literal("running") }),
  z.object({
    state: z.literal("done"),
    /** The workspaces whose metadata could not be merged. */
    failed: z.array(LibraryMergeFailureSchema),
  }),
]);
export type LibraryMergeEvent = z.infer<typeof LibraryMergeEventSchema>;

/** What went wrong reading the settings at startup (see appConfig.ts). */
export const ConfigProblemSchema = z.enum(["moved-aside", "unreadable"]);
export type ConfigProblem = z.infer<typeof ConfigProblemSchema>;

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
  /** Present while workspaces are being merged into the shared library (the
   *  first launch after the upgrade): how many of them are done. */
  libraryMerge: LibraryMergeProgressSchema.optional(),
  /** After that merge: the workspaces it could not merge. */
  libraryMergeFailed: z.array(LibraryMergeFailureSchema).optional(),
  /** Set when the library was found damaged at startup and restored from
   *  its backup copy: when that copy was taken (Unix seconds). */
  libraryRestoredFrom: z.number().optional(),
  /** Set when the settings could not be used at startup: "moved-aside" when
   *  config.json, being imported, could not be parsed and was renamed to
   *  config.json.corrupt-<time>; "unreadable" when the library or config.json
   *  could not be read, and no setting is written until the next launch. */
  configProblem: ConfigProblemSchema.optional(),
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
  /**
   * True for built-in collections ("Watch Later"), which cannot be removed,
   * renamed, reordered, or re-iconed. The renderer uses this to hide those
   * affordances; the main process enforces it independently.
   */
  locked: z.boolean(),
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
    /** Folders and files skipped because they could not be read. */
    skipped: z.number(),
  }),
  aborted: z.boolean().optional(),
  error: z.boolean().optional(),
  /** Why the scan failed, when it is a known case: "root-unreadable" when
   *  the workspace's folder could not be read (an unplugged drive, a share
   *  that is down); "exclusion-stuck" when a scan exclusion pattern did not
   *  finish, so nothing was scanned (#282). */
  errorReason: z.enum(["root-unreadable", "exclusion-stuck"]).optional(),
  /** The workspace scanned (absent for a scan not tied to one). */
  workspaceId: z.string().optional(),
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
   * the MS Store product deep link (`ms-windows-store://`) on Store installs
   * of an app that has a Store product ID.
   */
  url: z.url(),
  /** Release name/title, when present. */
  name: z.string().nullable().optional(),
  /** ISO timestamp the release was published, when present. */
  publishedAt: z.string().nullable().optional(),
});
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>;

// --- Crash reports (#544) ---

/** A crash report kept from an earlier run (electron/core/crashReports.ts). */
export const CrashReportSchema = z.object({
  id: z.string(),
  /** When the next launch found it (Unix ms). */
  detectedAt: z.number(),
  /** "crashed": a process crashed. "unclean-exit": the run ended without a
   *  clean exit and without a crash dump (forced quit, power loss). */
  kind: z.enum(["crashed", "unclean-exit"]),
  /** The report, as the user copies it. */
  text: z.string(),
  /** A new crash report issue on GitHub, with the version, OS and channel
   *  filled in (the report itself is pasted). Null for an app without a
   *  crash report issue form: the report can only be copied. */
  issueUrl: z.url().nullable(),
  /** Found at this launch: the window tells the user about it. */
  isNew: z.boolean(),
});
export type CrashReport = z.infer<typeof CrashReportSchema>;

/** Scope a graph layout is cached under: the active target string (a
 *  workspace id, "__all__" or "collection:<id>"). Main resolves it against the
 *  targets it holds; the cap only bounds what an id-shaped string can carry. */
export const GraphScopeSchema = z.string().min(1).max(MAX_WORKSPACE_ID);

/** A graph node key ("f:<ws>:<metaKey>" or "t:<namespace>:<name>"). Stored,
 *  never parsed, so only its length is bounded. */
export const GraphNodeKeySchema = z.string().min(3).max(GRAPH_NODE_KEY_MAX);

/** The graph view's layout dimensions (the flat view or the 3D one). */
export const GraphDimsSchema = z.union([z.literal(2), z.literal(3)]);

/**
 * A scan exclusion pattern (#529): how it is written and what is written.
 * Main checks that it can be used (patternError in shared/scanExclusions.ts).
 */
export const ExclusionPatternSchema = z.object({
  kind: z.enum(PATTERN_KINDS),
  value: z.string().min(1).max(MAX_EXCLUSION_PATTERN),
});
export type ExclusionPattern = z.infer<typeof ExclusionPatternSchema>;
