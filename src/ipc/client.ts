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
import type {
  LogoId,
  ScanDone,
  ScanProgress,
  TagRef,
  ThumbDone,
  UpdateInfo,
} from "@shared/ipc/schema";

interface Bridge {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
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
};

const bridge: Bridge = (window as unknown as { api?: Bridge }).api ?? fallback;

// Channel-name-aware invoke. Args are required when ChannelInput<C> is non-void.
function invoke<C extends ChannelName>(
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
  scanStart: (includeExcluded?: boolean, rebuild?: boolean) =>
    invoke("scan_start", { includeExcluded, rebuild }),
  scanCancel: (wsId?: string) => invoke("scan_cancel", { wsId }),
  filesSearch: (query: ChannelInput<"files_search">["query"]) =>
    invoke("files_search", { query }),
  filesRandom: (query?: ChannelInput<"files_random">["query"]) =>
    invoke("files_random", { query }),
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
  tagsList: (workspaceId: string, prefix: string, limit?: number) =>
    invoke("tags_list", { workspaceId, prefix, limit }),
  /** Whole tag catalog for the tag management screen (scope follows the active view). */
  tagsListAll: () => invoke("tags_list_all"),
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
