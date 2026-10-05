// IPC channel input schemas + output types — single source of truth for both
// processes. Main validates incoming payloads against ChannelInputs; the
// renderer's typed invoke wrapper uses ChannelOutputs to type the response.
// Output is declared as TypeScript types rather than Zod schemas because the
// renderer trusts data coming from main (no runtime check needed).
import { z } from "zod";
import type {
  AppStatus,
  DuplicatesResult,
  FileDetail,
  FileRow,
  FolderFilesResult,
  FolderListing,
  HistoryPage,
  LogoId,
  SceneBookmark,
  SearchResult,
  TagList,
  UpdateInfo,
  UserCollection,
  WorkspaceStats,
  WorkspacesList,
} from "./schema.js";
import {
  ActivityMetricSchema,
  DaySchema,
  FolderPathSchema,
  GraphDimsSchema,
  GraphNodeKeySchema,
  GraphScopeSchema,
  HistoryQuerySchema,
  LogoIdSchema,
  SearchQuerySchema,
  TagRefSchema,
} from "./schema.js";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
} from "./channelNames.js";
import {
  MAX_BULK_FILES,
  MAX_BULK_TAG_NAMES,
  MAX_TAG_LIST,
  MAX_TAG_NAME,
} from "../tags.js";
import { MAX_WORKSPACE_ID } from "../workspaceIds.js";
import {
  GRAPH_LAYOUT_MAX_NODES,
  GRAPH_MAX_FILES_HARD,
  type GraphPayload,
} from "./graph.js";
import { ACTIVITY_MAX_DAYS, type ActivityDays } from "./activity.js";
import { daySpan, parseDay } from "../day.js";
import { MAX_FOLDER_FILES_PATHS } from "../folderPath.js";
import { MAX_MEDIA_SEC } from "../resume.js";

export { EVENT_CHANNELS, INVOKE_CHANNELS };
export type { EventChannel, InvokeChannel };

/**
 * How many file ids a files_bulk_tag payload carries, counted off the RAW value
 * before zod validates any of it.
 *
 * A cap expressed as `.max()` on the parsed array does not protect the main
 * process: zod validates every element first and only then checks the length or
 * runs a refine, so a payload of 5,000 groups x 5,000 ids costs ~800ms of
 * synchronous validation before being refused — with better-sqlite3 and the
 * media server on the same loop, that is the whole app frozen. Gating on the
 * raw shape costs one pass over the groups, and bounds what the real schema
 * then has to parse.
 *
 * A non-array, or a group whose fileIds is not an array, counts as nothing: the
 * schema behind the gate is what reports those as type errors.
 */
function bulkTargetFileCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let n = 0;
  for (const group of raw) {
    const ids = (group as { fileIds?: unknown } | null)?.fileIds;
    if (Array.isArray(ids)) n += ids.length;
    if (n > MAX_BULK_FILES) return n;
  }
  return n;
}

/**
 * Whether any group carries an over-long workspace id, checked on the raw value
 * for the same reason the count is: a workspace id is a 16-character path hash,
 * so a payload of 5,000 groups each naming a megabyte-long id is nothing but a
 * way to make the main process handle megabytes. Counting files alone would let
 * it through, since the count is what it claims to be.
 */
function hasOversizedWorkspaceId(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some((group) => {
    const id = (group as { workspaceId?: unknown } | null)?.workspaceId;
    return typeof id === "string" && id.length > MAX_WORKSPACE_ID;
  });
}

/**
 * A selection addressed for a bulk edit: file ids grouped by the workspace that
 * owns them, because a file id only means something inside its own database —
 * the "All" view and collections routinely send several groups.
 *
 * The size gate runs on the raw value and short-circuits, so an oversized
 * payload is refused before a single id is validated. Every group needs at
 * least one id, so capping the group count at the same number as the ids is not
 * a second rule — it is the same one.
 */
const BulkTargets = z
  .unknown()
  .refine(
    (raw) =>
      !Array.isArray(raw) ||
      (raw.length <= MAX_BULK_FILES &&
        bulkTargetFileCount(raw) <= MAX_BULK_FILES &&
        !hasOversizedWorkspaceId(raw)),
    { message: `too many files (max ${MAX_BULK_FILES})` },
  )
  .pipe(
    z
      .array(
        z.object({
          workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
          // Positive: ids come from `files.id`, an INTEGER PRIMARY KEY. A
          // negative or zero id matches nothing, so accepting one only means
          // carrying work that cannot do anything.
          fileIds: z
            .array(z.number().int().positive())
            .min(1)
            .max(MAX_BULK_FILES),
        }),
      )
      .min(1),
  );

/** The parsed shape, so both processes and the renderer name one type. */
export type BulkTargets = z.infer<typeof BulkTargets>;

/**
 * An array of at most `max` items whose length is checked on the raw value
 * first, like BulkTargets: a plain `.max()` only reports the excess after
 * every element has been validated, so an oversized payload would still cost
 * the main process a pass over all of it. Worth it where the cap runs to
 * thousands; a short list is fine with `.max()`.
 */
function boundedArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .unknown()
    .refine((raw) => !Array.isArray(raw) || raw.length <= max, {
      message: `too many items (max ${max})`,
    })
    .pipe(z.array(item).max(max));
}

// Most file-mutating channels share the same (workspaceId, fileId) target.
const FileTarget = z.object({
  id: z.number(),
  workspaceId: z.string(),
});

export const ChannelInputs = {
  app_status: z.void(),
  about_info: z.void(),
  workspace_stats: z.void(),
  workspaces_list: z.void(),
  workspace_add: z.void(),
  // Preload-only (PRELOAD_INVOKE_CHANNELS): the path of a folder dropped from
  // the OS. Bounded so a forged payload cannot hand main megabytes to stat.
  // An empty path (a File not backed by the filesystem) is let through to be
  // refused by the directory check, which reports it as "not a folder".
  workspace_add_path: z.object({ path: z.string().max(4096) }),
  workspace_remove: z.object({ id: z.string() }),
  workspace_reorder: z.object({ ids: z.array(z.string()) }),
  workspace_switch: z.object({ id: z.string() }),
  workspace_set_emoji: z.object({
    id: z.string(),
    emoji: z.string().nullable(),
  }),
  collection_create: z.object({
    name: z.string().min(1),
    emoji: z.string().optional(),
  }),
  collection_remove: z.object({ id: z.string() }),
  collection_reorder: z.object({ ids: z.array(z.string()) }),
  // Order of the FILES inside one collection (the "manual" sort). Distinct from
  // collection_reorder above, which orders the collections themselves.
  collection_reorder_items: z.object({
    collectionId: z.string(),
    items: z.array(
      z.object({ workspaceId: z.string(), fileId: z.number().int() }),
    ),
  }),
  collection_set_emoji: z.object({
    id: z.string(),
    emoji: z.string().nullable(),
  }),
  collection_rename: z.object({ id: z.string(), name: z.string().min(1) }),
  collection_add_file: FileTarget.extend({ collectionId: z.string() }),
  collection_remove_file: FileTarget.extend({ collectionId: z.string() }),
  // Membership for many files at once. Collections live in config.json, which is
  // rewritten on every change, so adding a selection one file at a time would
  // mean one disk write per file. `op` names the direction rather than a boolean
  // flag, matching the collection_add_file / collection_remove_file vocabulary
  // this is the bulk form of.
  collection_set_membership: z.object({
    collectionId: z.string().min(1).max(MAX_WORKSPACE_ID),
    targets: BulkTargets,
    op: z.enum(["add", "remove"]),
  }),
  // Renderer always sends an object; default-{} makes the schema tolerant of
  // future call sites that omit the arg entirely.
  scan_start: z
    .object({
      includeExcluded: z.boolean().optional(),
      rebuild: z.boolean().optional(),
    })
    .default({}),
  scan_cancel: z.object({ wsId: z.string().optional() }).default({}),
  files_search: z.object({ query: SearchQuerySchema }),
  files_random: z.object({ query: SearchQuerySchema.optional() }).default({}),
  folders_list: z.object({
    workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
    path: FolderPathSchema,
  }),
  // Expands selected folder cards into their files for a bulk edit. The cap is
  // on how many folders one call names, not on files: the row budget is applied
  // by the query (MAX_BULK_FILES + 1), past which the edit is refused anyway.
  folder_files: z.object({
    workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
    paths: z
      .array(FolderPathSchema)
      .min(1)
      .max(MAX_FOLDER_FILES_PATHS)
      .refine((paths) => new Set(paths).size === paths.length, {
        message: "duplicate folder path",
      }),
  }),
  // The whole graph for the active target in one call; cursor / limit / folder
  // in the query are ignored (the graph does not page and has no folder view).
  graph_build: z.object({
    query: SearchQuerySchema,
    maxFiles: z.number().int().min(1).max(GRAPH_MAX_FILES_HARD).optional(),
  }),
  graph_layout_get: z.object({
    scope: GraphScopeSchema,
    dims: GraphDimsSchema.optional(),
  }),
  graph_layout_set: z
    .object({
      scope: GraphScopeSchema,
      dims: GraphDimsSchema.optional(),
      keys: boundedArray(GraphNodeKeySchema, GRAPH_LAYOUT_MAX_NODES),
      xy: boundedArray(z.number(), GRAPH_LAYOUT_MAX_NODES * 3),
    })
    .refine((v) => v.xy.length === v.keys.length * (v.dims ?? 2), {
      message: "xy must hold one number per dimension per key",
    }),
  // Per-day counts for the heatmap, over the files the query
  // matches; cursor / limit / folder / day in the query are ignored.
  activity_days: z
    .object({
      query: SearchQuerySchema,
      metric: ActivityMetricSchema,
      from: DaySchema,
      to: DaySchema,
    })
    .refine(
      (v) => {
        const from = parseDay(v.from);
        const to = parseDay(v.to);
        if (!from || !to) return false;
        const span = daySpan(from, to);
        return span >= 1 && span <= ACTIVITY_MAX_DAYS;
      },
      { message: "from must not be after to, nor the range too long" },
    ),
  file_get: FileTarget,
  file_set_rating: FileTarget.extend({ rating: z.number() }),
  file_set_favorite: FileTarget.extend({ favorite: z.boolean() }),
  file_delete_from_index: FileTarget,
  file_record_play: FileTarget.extend({
    via: z.enum(["browser", "external"]),
    position: z.number().optional(),
  }),
  // Where playback of a file stands. `duration` is the player's own (the DB
  // value can be missing); `urgent` asks for the write to land now rather than
  // be coalesced with the next few (pause, seek, close — see PositionWriter).
  file_save_position: FileTarget.extend({
    // Bounded at a week: no media is longer, and an absurd value would
    // otherwise be stored and handed to the stream server as `?t=`.
    position: z.number().finite().min(0).max(MAX_MEDIA_SEC),
    duration: z
      .number()
      .finite()
      .positive()
      .max(MAX_MEDIA_SEC)
      .nullable()
      .optional(),
    ended: z.boolean().optional(),
    urgent: z.boolean().optional(),
  }),
  history_list: z.object({ query: HistoryQuerySchema.optional() }).default({}),
  duplicates_list: z.void(),
  history_clear: z.void(),
  // A name being created, so it is capped at MAX_TAG_NAME — same as
  // tag_rename's `to`, and unlike TagRefSchema, which only addresses one.
  file_add_tag: FileTarget.extend({
    name: z.string().min(1).max(MAX_TAG_NAME),
  }),
  file_remove_tag: FileTarget.extend({ tagId: z.number() }),
  // One edit over many files, grouped by workspace because a file id only
  // means something inside its own database — the "All" view routinely sends
  // several groups. Tags are addressed by NAME rather than by id for the same
  // reason: the same tag is a different row in every database.
  files_bulk_tag: z
    .object({
      targets: BulkTargets,
      /** Manual tag names to attach to every target. Created where missing. */
      add: z.array(z.string().min(1).max(MAX_TAG_NAME)).max(MAX_BULK_TAG_NAMES),
      /** Manual tag names to detach from every target. Unknown names are no-ops. */
      remove: z
        .array(z.string().min(1).max(MAX_TAG_NAME))
        .max(MAX_BULK_TAG_NAMES),
    })
    // MAX_BULK_TAG_NAMES is a budget for the call, not for each list: the cost
    // that matters is the cross product of files and names, and the dialog
    // counts its staged additions and removals together against the same
    // number.
    .refine((v) => v.add.length + v.remove.length <= MAX_BULK_TAG_NAMES, {
      message: `too many tag names (max ${MAX_BULK_TAG_NAMES})`,
    }),
  // Favorite and rating over a whole selection. One channel because both live in
  // the same file_meta row and one upsert writes them: either may be omitted,
  // and a call that sets both is reported as both.
  files_bulk_meta: z
    .object({
      targets: BulkTargets,
      favorite: z.boolean().optional(),
      /** 0 clears the rating, matching the per-file control. */
      rating: z.number().int().min(0).max(5).optional(),
    })
    .refine((v) => v.favorite !== undefined || v.rating !== undefined, {
      message: "nothing to set",
    }),
  // The selection read again after a bulk edit, by the same per-workspace
  // targets the edit was sent with (and so under the same cap).
  files_by_ids: z.object({ targets: BulkTargets }),
  tags_list: z.object({
    workspaceId: z.string(),
    prefix: z.string(),
    limit: z.number().optional(),
  }),
  // The tag-catalog channels take no workspaceId: scope comes from the active
  // view (like duplicates_list), and tags are addressed by name because ids are
  // per-database and meaningless across the "All" view.
  tags_list_all: z.void(),
  tag_rename: z.object({
    from: TagRefSchema,
    /** New plain name; the namespace is always "" since only manual tags are editable. */
    to: z.string().min(1).max(MAX_TAG_NAME),
  }),
  // Both operand lists are bounded by the catalog they are picked from: the
  // screen can select every row it shows, and it never shows more than
  // MAX_TAG_LIST. Each element resolves with its own synchronous query, so an
  // unbounded array is a way to stall the main process from the renderer side.
  tag_merge: z.object({
    from: z.array(TagRefSchema).min(1).max(MAX_TAG_LIST),
    // Also a reference, not a new name: the merge dialog only ever targets a tag
    // from the selection. Main may still have to create it in a database that
    // does not hold it yet, which is why the "All" view can merge at all.
    into: TagRefSchema,
  }),
  tag_delete: z.object({
    tags: z.array(TagRefSchema).min(1).max(MAX_TAG_LIST),
  }),
  bookmark_add: FileTarget.extend({ sec: z.number() }),
  bookmark_remove: FileTarget.extend({ bookmarkId: z.number() }),
  thumb_set_offset: FileTarget.extend({ sec: z.number().nullable() }),
  frame_export: FileTarget.extend({ sec: z.number().finite().min(0) }),
  open_external: FileTarget,
  open_folder: FileTarget,
  // A folder of the folder view, opened in the OS file manager.
  folder_open_in_file_manager: z.object({
    workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
    path: FolderPathSchema,
  }),
  // A folder of the folder view, its absolute path onto the clipboard.
  folder_copy_path: z.object({
    workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID),
    path: FolderPathSchema,
  }),
  copy_file_path: FileTarget,
  open_url: z.object({ url: z.string() }),
  open_devtools: z.void(),
  window_close: z.void(),
  // Update check (GitHub Releases). `force` bypasses the throttle used by the
  // background/startup check (manual "check now" button always hits the network).
  update_check: z.object({ force: z.boolean().optional() }).default({}),
  update_get_settings: z.void(),
  update_set_auto_check: z.object({ enabled: z.boolean() }),
  update_ignore: z.object({ version: z.string() }),
  logo_get: z.void(),
  logo_set: z.object({ logo: LogoIdSchema }),
} as const satisfies Record<InvokeChannel, z.ZodTypeAny>;

type ChannelInputKeys = keyof typeof ChannelInputs;
type AssertChannelInputsMatch =
  Exclude<InvokeChannel, ChannelInputKeys> extends never
    ? Exclude<ChannelInputKeys, InvokeChannel> extends never
      ? true
      : [
          "ChannelInputs has keys not listed in INVOKE_CHANNELS",
          Exclude<ChannelInputKeys, InvokeChannel>,
        ]
    : [
        "INVOKE_CHANNELS / PRELOAD_INVOKE_CHANNELS missing from ChannelInputs",
        Exclude<InvokeChannel, ChannelInputKeys>,
      ];
type Expect<T extends true> = T;

export type ChannelName =
  Expect<AssertChannelInputsMatch> extends true
    ? keyof typeof ChannelInputs
    : never;
export type ChannelInput<C extends ChannelName> = z.infer<
  (typeof ChannelInputs)[C]
>;

/**
 * What registering a workspace did. `existing` means the folder was already
 * registered and was only switched to; `notDirectory` means a dropped path was
 * refused because it is not a directory (or no longer exists).
 */
export interface WorkspaceAddResult {
  /**
   * A folder was registered or, when `existing`, switched to: either way the
   * active workspace changed and a scan may have started. False when nothing
   * happened (the picker was cancelled, or a dropped path was refused).
   */
  added: boolean;
  id?: string;
  scanJobId?: string;
  existing?: boolean;
  notDirectory?: boolean;
}

// Return types per channel. Adding a channel here forces both the handler
// signature and the renderer client wrapper to match.
export interface ChannelOutputs {
  app_status: AppStatus;
  about_info: AboutInfo;
  workspace_stats: WorkspaceStats;
  workspaces_list: WorkspacesList;
  workspace_add: WorkspaceAddResult;
  workspace_add_path: WorkspaceAddResult;
  workspace_remove: void;
  workspace_reorder: void;
  workspace_switch: void;
  workspace_set_emoji: void;
  collection_create: UserCollection;
  collection_remove: void;
  collection_reorder: void;
  collection_reorder_items: void;
  collection_set_emoji: void;
  collection_rename: void;
  collection_add_file: void;
  collection_remove_file: void;
  /** Files whose membership actually changed (already-members are not counted). */
  collection_set_membership: { changed: number };
  scan_start: string;
  scan_cancel: void;
  files_search: SearchResult;
  files_random: FileRow[];
  folders_list: FolderListing;
  folder_files: FolderFilesResult;
  graph_build: GraphPayload;
  /** The cached positions of the scope, or null when there are none usable. */
  graph_layout_get: { keys: string[]; xy: number[] } | null;
  graph_layout_set: void;
  activity_days: ActivityDays;
  file_get: FileDetail | null;
  file_set_rating: void;
  file_set_favorite: void;
  file_delete_from_index: { id: number; relPath: string };
  file_record_play: void;
  file_save_position: void;
  history_list: HistoryPage;
  duplicates_list: DuplicatesResult;
  history_clear: void;
  file_add_tag: number;
  file_remove_tag: void;
  // `files` counts the rows actually edited; `skipped` counts targets whose
  // file row was gone by the time the write ran (deleted or re-scanned away),
  // which is not an error. `added`/`removed` are (file, tag) pairs that really
  // changed, so re-applying a tag every file already has reports 0.
  files_bulk_tag: {
    files: number;
    skipped: number;
    added: number;
    removed: number;
  };
  // `files` counts the rows written; `skipped` those whose file row was gone by
  // the time the write ran. Unlike the tag counters these do not detect churn:
  // setting a flag to what it already was is a write, and the UI has nothing to
  // say about the difference.
  files_bulk_meta: { files: number; skipped: number };
  // List rows (tags attached) for the targets that still exist. A target whose
  // file row is gone is left out rather than reported: its absence is the
  // answer.
  files_by_ids: FileRow[];
  tags_list: string[];
  tags_list_all: TagList;
  // The counters below are summed over the databases in scope, so in the "All"
  // view a tag present in three workspaces reports removedTags: 3 for one
  // logical tag, and a file shared between workspaces is counted once per
  // database. They are progress feedback, not identities.
  /** merged=true when the new name already existed and the rename escalated to a merge. */
  tag_rename: { merged: boolean; affectedFiles: number };
  tag_merge: { affectedFiles: number };
  tag_delete: { removedTags: number; affectedFiles: number };
  bookmark_add: SceneBookmark | null;
  bookmark_remove: void;
  thumb_set_offset: { ok: boolean; thumbOffsetSec: number | null };
  // saved=false means the user canceled the save dialog (not an error);
  // extraction failures reject instead.
  frame_export: { saved: boolean; path: string | null };
  open_external: void;
  open_folder: void;
  folder_open_in_file_manager: void;
  folder_copy_path: void;
  copy_file_path: void;
  open_url: void;
  open_devtools: boolean;
  window_close: void;
  // null when the check could not reach GitHub (offline / rate-limited).
  update_check: UpdateInfo | null;
  update_get_settings: UpdateSettings;
  update_set_auto_check: void;
  update_ignore: void;
  logo_get: LogoId;
  // Echoes the applied variant so the renderer can settle on main's value.
  logo_set: LogoId;
}

type ChannelOutputKeys = keyof ChannelOutputs;
type AssertChannelOutputsMatch =
  Exclude<InvokeChannel, ChannelOutputKeys> extends never
    ? Exclude<ChannelOutputKeys, InvokeChannel> extends never
      ? true
      : [
          "ChannelOutputs has keys not listed in INVOKE_CHANNELS",
          Exclude<ChannelOutputKeys, InvokeChannel>,
        ]
    : [
        "INVOKE_CHANNELS / PRELOAD_INVOKE_CHANNELS missing from ChannelOutputs",
        Exclude<InvokeChannel, ChannelOutputKeys>,
      ];

/** Static app/runtime info for the About section (Settings). */
export interface AboutInfo {
  /** App version (app.getVersion(), e.g. "0.1.0"). */
  version: string;
  /** Bundled runtime versions (process.versions.*). */
  electron: string;
  chrome: string;
  node: string;
}

/** User-facing update preferences (persisted in main's config.json). */
export interface UpdateSettings {
  /** Whether the app checks for updates on startup. */
  autoCheck: boolean;
  /** Version the user chose to skip ("don't notify me about this one"), if any. */
  ignoredVersion: string | null;
}
export type ChannelOutput<C extends ChannelName> =
  Expect<AssertChannelOutputsMatch> extends true ? ChannelOutputs[C] : never;
