// Typed IPC wrapper. Uses window.api exposed by the Electron preload.
//
// Channel signatures (input + output types) come from shared/ipc/channels.ts,
// which is also what main validates against — so the renderer wrapper and the
// main handler cannot drift apart.
import type {
  AboutInfo,
  ChannelInput,
  ChannelName,
  ChannelOutput,
} from "@shared/ipc/channels";
import type { PreloadInvokeChannel } from "@shared/ipc/channelNames";
import type {
  LogoId,
  ScanDone,
  ScanProgress,
  TagRef,
  ThumbDone,
  UpdateInfo,
} from "@shared/ipc/schema";
import type { GraphDims } from "@shared/ipc/graph";
import type { AutoTagAssignment, AutoTagConfig } from "@shared/autoTag";

interface Bridge {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
  addDroppedWorkspace(file: File): Promise<unknown>;
}

// Fallback for when the preload hasn't loaded (prevents a blank screen and surfaces the cause).
const fallback: Bridge = {
  invoke: <T>() =>
    Promise.reject<T>(
      new Error(
        "IPC bridge (window.api) is not initialized. The preload script failed to load.",
      ),
    ),
  on: () => () => {},
  addDroppedWorkspace: () =>
    Promise.reject(
      new Error(
        "IPC bridge (window.api) is not initialized. The preload script failed to load.",
      ),
    ),
};

const bridge: Bridge = (window as unknown as { api?: Bridge }).api ?? fallback;

// Channel-name-aware invoke. Args are required when ChannelInput<C> is non-void.
// Preload-only channels are excluded: the preload refuses them from here.
function invoke<C extends Exclude<ChannelName, PreloadInvokeChannel>>(
  channel: C,
  ...args: ChannelInput<C> extends void ? [] : [ChannelInput<C>]
): Promise<ChannelOutput<C>> {
  return bridge.invoke<ChannelOutput<C>>(channel, args[0]);
}

export const api = {
  appStatus: () => invoke("app_status"),
  /** App + runtime versions for the Settings "About" section. */
  aboutInfo: () => invoke("about_info"),
  workspaceStats: () => invoke("workspace_stats"),
  workspacesList: () => invoke("workspaces_list"),
  workspaceAdd: () => invoke("workspace_add"),
  /** Register a folder dropped from the OS; the preload resolves its path. */
  workspaceAddDropped: (file: File) =>
    bridge.addDroppedWorkspace(file) as Promise<
      ChannelOutput<"workspace_add_path">
    >,
  workspaceRemove: (id: string) => invoke("workspace_remove", { id }),
  workspaceSwitch: (id: string) => invoke("workspace_switch", { id }),
  workspaceReorder: (ids: string[]) => invoke("workspace_reorder", { ids }),
  workspaceSetEmoji: (id: string, emoji: string | null) =>
    invoke("workspace_set_emoji", { id, emoji }),
  collectionCreate: (name: string, emoji?: string) =>
    invoke("collection_create", { name, emoji }),
  collectionRemove: (id: string) => invoke("collection_remove", { id }),
  collectionReorder: (ids: string[]) => invoke("collection_reorder", { ids }),
  /** Order of the files inside one collection — the "manual" sort. */
  collectionReorderItems: (
    collectionId: string,
    items: { workspaceId: string; fileId: number }[],
  ) => invoke("collection_reorder_items", { collectionId, items }),
  collectionSetEmoji: (id: string, emoji: string | null) =>
    invoke("collection_set_emoji", { id, emoji }),
  collectionRename: (id: string, name: string) =>
    invoke("collection_rename", { id, name }),
  collectionAddFile: (collectionId: string, id: number, workspaceId: string) =>
    invoke("collection_add_file", { collectionId, id, workspaceId }),
  collectionRemoveFile: (
    collectionId: string,
    id: number,
    workspaceId: string,
  ) => invoke("collection_remove_file", { collectionId, id, workspaceId }),
  /** Add or remove a whole selection's membership in one write. */
  collectionSetMembership: (
    collectionId: string,
    targets: ChannelInput<"collection_set_membership">["targets"],
    op: ChannelInput<"collection_set_membership">["op"],
  ) => invoke("collection_set_membership", { collectionId, targets, op }),
  scanStart: (includeExcluded?: boolean, rebuild?: boolean) =>
    invoke("scan_start", { includeExcluded, rebuild }),
  scanCancel: (wsId?: string) => invoke("scan_cancel", { wsId }),
  filesSearch: (query: ChannelInput<"files_search">["query"]) =>
    invoke("files_search", { query }),
  filesRandom: (query?: ChannelInput<"files_random">["query"]) =>
    invoke("files_random", { query }),
  /** Child folders of one folder in a workspace (folder view). */
  foldersList: (workspaceId: string, path: string) =>
    invoke("folders_list", { workspaceId, path }),
  /** Selected folders expanded into their files, for a bulk edit. */
  folderFiles: (workspaceId: string, paths: string[]) =>
    invoke("folder_files", { workspaceId, paths }),
  /** The whole graph of the active target for a query (graph view). */
  graphBuild: (
    query: ChannelInput<"graph_build">["query"],
    maxFiles?: number,
  ) => invoke("graph_build", { query, maxFiles }),
  /** Per-day file counts of the active target for a query (contribution graph). */
  activityDays: (input: ChannelInput<"activity_days">) =>
    invoke("activity_days", input),
  timelineCounts: (input: ChannelInput<"timeline_counts">) =>
    invoke("timeline_counts", input),
  graphLayoutGet: (scope: string, dims: GraphDims = 2) =>
    invoke("graph_layout_get", { scope, dims }),
  graphLayoutSet: (
    scope: string,
    keys: string[],
    xy: number[],
    dims: GraphDims = 2,
  ) => invoke("graph_layout_set", { scope, keys, xy, dims }),
  fileGet: (id: number, workspaceId: string) =>
    invoke("file_get", { id, workspaceId }),
  fileSetRating: (id: number, workspaceId: string, rating: number) =>
    invoke("file_set_rating", { id, workspaceId, rating }),
  fileSetFavorite: (id: number, workspaceId: string, favorite: boolean) =>
    invoke("file_set_favorite", { id, workspaceId, favorite }),
  fileDeleteFromIndex: (id: number, workspaceId: string) =>
    invoke("file_delete_from_index", { id, workspaceId }),
  fileAddTag: (id: number, workspaceId: string, name: string) =>
    invoke("file_add_tag", { id, workspaceId, name }),
  fileRemoveTag: (id: number, workspaceId: string, tagId: number) =>
    invoke("file_remove_tag", { id, workspaceId, tagId }),
  /** One tag edit over a whole selection, grouped by workspace (see files_bulk_tag). */
  filesBulkTag: (
    targets: ChannelInput<"files_bulk_tag">["targets"],
    add: string[],
    remove: string[],
  ) => invoke("files_bulk_tag", { targets, add, remove }),
  /** Favorite / rating over a whole selection. Omitted fields are left alone. */
  filesBulkMeta: (
    targets: ChannelInput<"files_bulk_meta">["targets"],
    patch: { favorite?: boolean; rating?: number },
  ) => invoke("files_bulk_meta", { targets, ...patch }),
  /** The targets' rows as they now stand; one that is gone is left out. */
  filesByIds: (targets: ChannelInput<"files_by_ids">["targets"]) =>
    invoke("files_by_ids", { targets }),
  tagsList: (workspaceId: string, prefix: string, limit?: number) =>
    invoke("tags_list", { workspaceId, prefix, limit }),
  /**
   * Whole tag catalog for the tag management screen (scope follows the active
   * view), or of every workspace when asked.
   */
  tagsListAll: (opts?: { allWorkspaces: boolean }) =>
    invoke("tags_list_all", opts),
  tagRename: (from: TagRef, to: string) => invoke("tag_rename", { from, to }),
  tagMerge: (from: TagRef[], into: TagRef) =>
    invoke("tag_merge", { from, into }),
  tagDelete: (tags: TagRef[]) => invoke("tag_delete", { tags }),
  fileRecordPlay: (
    id: number,
    workspaceId: string,
    via: ChannelInput<"file_record_play">["via"],
    position?: number,
  ) => invoke("file_record_play", { id, workspaceId, via, position }),
  /** Where playback of a file stands; see PositionWriter (main) and usePlaybackPosition. */
  fileSavePosition: (
    id: number,
    workspaceId: string,
    report: Omit<ChannelInput<"file_save_position">, "id" | "workspaceId">,
  ) => invoke("file_save_position", { id, workspaceId, ...report }),
  /** Cross-file play-history timeline (scoped to the active workspace, or all for All/collections). */
  historyList: (query?: ChannelInput<"history_list">["query"]) =>
    invoke("history_list", { query }),
  historyClear: () => invoke("history_clear"),
  /** Duplicate groups by (content_hash, size) — same scope rule as historyList. */
  duplicatesList: () => invoke("duplicates_list"),
  bookmarkAdd: (id: number, workspaceId: string, sec: number) =>
    invoke("bookmark_add", { id, workspaceId, sec }),
  bookmarkRemove: (id: number, workspaceId: string, bookmarkId: number) =>
    invoke("bookmark_remove", { id, workspaceId, bookmarkId }),
  /** Regenerate the main thumbnail from the given video offset; pass null to revert to auto. */
  thumbSetOffset: (id: number, workspaceId: string, sec: number | null) =>
    invoke("thumb_set_offset", { id, workspaceId, sec }),
  /** Export the frame at `sec` as a still image via a native save dialog. */
  frameExport: (id: number, workspaceId: string, sec: number) =>
    invoke("frame_export", { id, workspaceId, sec }),
  openExternal: (id: number, workspaceId: string) =>
    invoke("open_external", { id, workspaceId }),
  openFolder: (id: number, workspaceId: string) =>
    invoke("open_folder", { id, workspaceId }),
  /** Open a folder of the folder view in the OS file manager. */
  folderOpenInFileManager: (workspaceId: string, path: string) =>
    invoke("folder_open_in_file_manager", { workspaceId, path }),
  /** Copy a folder of the folder view's absolute path to the clipboard. */
  folderCopyPath: (workspaceId: string, path: string) =>
    invoke("folder_copy_path", { workspaceId, path }),
  copyFilePath: (id: number, workspaceId: string) =>
    invoke("copy_file_path", { id, workspaceId }),
  openUrl: (url: string) => invoke("open_url", { url }),
  openDevTools: () => invoke("open_devtools"),
  /** Close the main window (hides to tray when tray support is enabled). */
  windowClose: () => invoke("window_close"),
  /** Check GitHub for a newer release. `force` bypasses the throttle. null = check failed. */
  updateCheck: (force?: boolean) => invoke("update_check", { force }),
  updateGetSettings: () => invoke("update_get_settings"),
  updateSetAutoCheck: (enabled: boolean) =>
    invoke("update_set_auto_check", { enabled }),
  updateIgnore: (version: string) => invoke("update_ignore", { version }),
  /** Auto-tagging (rules, dictionary, applying), configured app-wide. */
  autoTagGet: () => invoke("auto_tag_get"),
  autoTagSet: (config: AutoTagConfig) => invoke("auto_tag_set", { config }),
  autoTagFiles: () => invoke("auto_tag_files"),
  autoTagApply: (assignments: AutoTagAssignment[]) =>
    invoke("auto_tag_apply", { assignments }),
  autoTagUndo: (undoIds: string[]) => invoke("auto_tag_undo", { undoIds }),
  autoTagReapply: () => invoke("auto_tag_reapply"),
  /** App logo variant (window + tray icon), persisted in main's config.json. */
  logoGet: () => invoke("logo_get"),
  logoSet: (logo: LogoId) => invoke("logo_set", { logo }),
};

export {
  ALL_ID,
  COLLECTION_ID_PREFIX,
  collectionTarget,
} from "@shared/workspaceIds";

// --- Events ---
// Re-exported for compatibility with components that imported these from this module.
export type {
  AboutInfo,
  LogoId,
  ScanDone,
  ScanProgress,
  ThumbDone,
  UpdateInfo,
};

// Returns a Promise so existing components can receive the unlisten function via `.then(unlisten => ...)`.
type Unlisten = () => void;
export const events = {
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<Unlisten> =>
    Promise.resolve(bridge.on("scan:progress", (p) => cb(p as ScanProgress))),
  onThumbDone: (cb: (event: ThumbDone) => void): Promise<Unlisten> =>
    Promise.resolve(bridge.on("thumb:done", (p) => cb(p as ThumbDone))),
  onScanDone: (cb: (d: ScanDone) => void): Promise<Unlisten> =>
    Promise.resolve(bridge.on("scan:done", (p) => cb(p as ScanDone))),
  onWorkspaceChanged: (
    cb: (activeId: string | null) => void,
  ): Promise<Unlisten> =>
    Promise.resolve(
      bridge.on("workspace:changed", (p) =>
        cb((p as { activeId: string | null }).activeId),
      ),
    ),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void): Promise<Unlisten> =>
    Promise.resolve(bridge.on("update:available", (p) => cb(p as UpdateInfo))),
};
