// IPC channel name lists — zod-free so preload can import without bundling
// validation schemas. ChannelInputs / ChannelOutputs in channels.ts must cover
// every INVOKE_CHANNELS entry (enforced at compile time there).

/** Renderer → main invoke channels (ipcMain.handle). */
export const INVOKE_CHANNELS = [
  "app_status",
  "about_info",
  "workspace_stats",
  "workspaces_list",
  "workspace_add",
  "workspace_remove",
  "workspace_reorder",
  "workspace_switch",
  "workspace_set_emoji",
  "collection_create",
  "collection_remove",
  "collection_reorder",
  "collection_set_emoji",
  "collection_rename",
  "collection_add_file",
  "collection_remove_file",
  "scan_start",
  "scan_cancel",
  "files_search",
  "files_random",
  "file_get",
  "file_set_rating",
  "file_set_favorite",
  "file_delete_from_index",
  "file_record_play",
  "history_list",
  "duplicates_list",
  "history_clear",
  "file_add_tag",
  "file_remove_tag",
  "tags_list",
  "bookmark_add",
  "bookmark_remove",
  "thumb_set_offset",
  "open_external",
  "open_folder",
  "copy_file_path",
  "open_url",
  "open_devtools",
  "window_close",
  "update_check",
  "update_get_settings",
  "update_set_auto_check",
  "update_ignore",
] as const;

/** Main → renderer event channels (webContents.send). */
export const EVENT_CHANNELS = [
  "scan:progress",
  "thumb:done",
  "scan:done",
  "workspace:changed",
  "update:available",
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
