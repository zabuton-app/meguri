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
  HistoryPage,
  SceneBookmark,
  SearchResult,
  TagList,
  UpdateInfo,
  UserCollection,
  WorkspaceStats,
  WorkspacesList,
} from "./schema.js";
import {
  HistoryQuerySchema,
  SearchQuerySchema,
  TagRefSchema,
} from "./schema.js";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
} from "./channelNames.js";

export { EVENT_CHANNELS, INVOKE_CHANNELS };
export type { EventChannel, InvokeChannel };

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
  collection_set_emoji: z.object({
    id: z.string(),
    emoji: z.string().nullable(),
  }),
  collection_rename: z.object({ id: z.string(), name: z.string().min(1) }),
  collection_add_file: FileTarget.extend({ collectionId: z.string() }),
  collection_remove_file: FileTarget.extend({ collectionId: z.string() }),
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
  file_get: FileTarget,
  file_set_rating: FileTarget.extend({ rating: z.number() }),
  file_set_favorite: FileTarget.extend({ favorite: z.boolean() }),
  file_delete_from_index: FileTarget,
  file_record_play: FileTarget.extend({
    via: z.enum(["browser", "external"]),
    position: z.number().optional(),
  }),
  history_list: z.object({ query: HistoryQuerySchema.optional() }).default({}),
  duplicates_list: z.void(),
  history_clear: z.void(),
  // Same ceiling as tag_rename's `to` and TagRefSchema.name.
  file_add_tag: FileTarget.extend({ name: z.string().min(1).max(64) }),
  file_remove_tag: FileTarget.extend({ tagId: z.number() }),
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
    to: z.string().min(1).max(64),
  }),
  tag_merge: z.object({
    from: z.array(TagRefSchema).min(1),
    into: TagRefSchema,
  }),
  tag_delete: z.object({ tags: z.array(TagRefSchema).min(1) }),
  bookmark_add: FileTarget.extend({ sec: z.number() }),
  bookmark_remove: FileTarget.extend({ bookmarkId: z.number() }),
  thumb_set_offset: FileTarget.extend({ sec: z.number().nullable() }),
  frame_export: FileTarget.extend({ sec: z.number().finite().min(0) }),
  open_external: FileTarget,
  open_folder: FileTarget,
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
        "INVOKE_CHANNELS missing from ChannelInputs",
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

// Return types per channel. Adding a channel here forces both the handler
// signature and the renderer client wrapper to match.
export interface ChannelOutputs {
  app_status: AppStatus;
  about_info: AboutInfo;
  workspace_stats: WorkspaceStats;
  workspaces_list: WorkspacesList;
  workspace_add: { added: boolean; id?: string; scanJobId?: string };
  workspace_remove: void;
  workspace_reorder: void;
  workspace_switch: void;
  workspace_set_emoji: void;
  collection_create: UserCollection;
  collection_remove: void;
  collection_reorder: void;
  collection_set_emoji: void;
  collection_rename: void;
  collection_add_file: void;
  collection_remove_file: void;
  scan_start: string;
  scan_cancel: void;
  files_search: SearchResult;
  files_random: FileRow[];
  file_get: FileDetail | null;
  file_set_rating: void;
  file_set_favorite: void;
  file_delete_from_index: { id: number; relPath: string };
  file_record_play: void;
  history_list: HistoryPage;
  duplicates_list: DuplicatesResult;
  history_clear: void;
  file_add_tag: number;
  file_remove_tag: void;
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
  copy_file_path: void;
  open_url: void;
  open_devtools: boolean;
  window_close: void;
  // null when the check could not reach GitHub (offline / rate-limited).
  update_check: UpdateInfo | null;
  update_get_settings: UpdateSettings;
  update_set_auto_check: void;
  update_ignore: void;
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
        "INVOKE_CHANNELS missing from ChannelOutputs",
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
