// IPC channel name lists — zod-free so preload can import without bundling
// validation schemas. ChannelInputs / ChannelOutputs in channels.ts must cover
// every INVOKE_CHANNELS entry (enforced at compile time there).

/**
 * Prefixes of the renderer process arguments that carry the app's name and
 * one-character mark from the main process (webPreferences.additionalArguments)
 * to the preload, which exposes them as window.api.appName and appGlyph.
 * Arguments rather than a channel so the renderer has them synchronously,
 * before its first render.
 */
export const APP_NAME_ARG = "--app-name=";
export const APP_GLYPH_ARG = "--app-glyph=";
/**
 * The media server's origin (window.api.mediaOrigin). The same value as
 * app_status's mediaBase, but the renderer's CSP needs it synchronously,
 * before the first request, to allow that one port on 127.0.0.1 instead of
 * all of them (public/media-csp.js).
 */
export const MEDIA_ORIGIN_ARG = "--media-origin=";
/**
 * When the main process started (its performance.timeOrigin, epoch ms), so
 * the renderer's startup timings count from the same point as main's
 * (window.api.startupOrigin, shared/startupTiming.ts).
 */
export const STARTUP_ORIGIN_ARG = "--startup-origin=";

/** Renderer → main invoke channels (ipcMain.handle). */
export const INVOKE_CHANNELS = [
  "app_status",
  "library_merge_retry",
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
  "collection_reorder_items",
  "collection_set_emoji",
  "collection_rename",
  "collection_add_file",
  "collection_remove_file",
  "collection_set_membership",
  "smart_collections_list",
  "smart_collections_import",
  "smart_collection_add",
  "smart_collection_remove",
  "smart_collection_set_default",
  "scan_start",
  "scan_cancel",
  "scan_unreadable_workspaces",
  "files_search",
  "files_random",
  "folders_list",
  "folder_files",
  "graph_build",
  "graph_layout_get",
  "graph_layout_set",
  "activity_days",
  "timeline_counts",
  "file_get",
  "file_download_origin",
  "file_photo_details",
  "file_subtitles",
  "file_set_rating",
  "file_set_favorite",
  "file_set_note",
  "file_delete_from_index",
  "file_record_play",
  "file_save_position",
  "history_list",
  "duplicates_list",
  "missing_files_list",
  "missing_files_purge",
  "history_clear",
  "file_add_tag",
  "files_bulk_tag",
  "files_bulk_meta",
  "files_by_ids",
  "file_remove_tag",
  "tags_list",
  "tags_list_all",
  "ext_list_all",
  "tag_rename",
  "tag_merge",
  "tag_delete",
  "auto_tag_get",
  "auto_tag_set",
  "auto_tag_files",
  "auto_tag_apply",
  "auto_tag_edit",
  "auto_tag_undo",
  "auto_tag_reapply",
  "bookmark_add",
  "bookmark_remove",
  "thumb_set_offset",
  "frame_export",
  "open_external",
  "open_folder",
  "drag_files",
  "folder_open_in_file_manager",
  "folder_copy_path",
  "copy_file_path",
  "open_url",
  "open_devtools",
  "window_close",
  "window_minimize",
  "window_toggle_maximize",
  "window_state",
  "window_title_bar_double_click",
  "window_set_button_position",
  "window_set_button_visibility",
  "update_check",
  "update_get_settings",
  "update_set_auto_check",
  "update_ignore",
  "crash_reports_list",
  "crash_report_delete",
  "crash_reports_open_folder",
  "logo_get",
  "logo_set",
  "logo_images",
  "note_template_get",
  "note_template_set",
  "scan_exclusions_get",
  "scan_exclusions_set_patterns",
  "scan_exclusions_folders",
  "scan_exclusions_add_folder",
  "scan_exclusions_update_folders",
  "scan_exclusions_pick_folder",
  "scan_exclusions_preview",
  "custom_css_get",
  "custom_css_set_enabled",
  "custom_css_open",
  "css_themes_get",
  "css_theme_select",
  "css_themes_open_folder",
] as const;

/**
 * Invoke channels the preload calls itself and never forwards from the
 * renderer's generic `invoke`. They take something the renderer must not be
 * able to forge — a filesystem path resolved from a dropped File — so the
 * preload resolves it and is the only caller. Main still validates them like
 * any other channel.
 */
export const PRELOAD_INVOKE_CHANNELS = ["workspace_add_path"] as const;

/** Main → renderer event channels (webContents.send). */
export const EVENT_CHANNELS = [
  "scan:progress",
  "thumb:done",
  "scan:done",
  "workspace:changed",
  "update:available",
  "library:merge",
  "custom-css:changed",
  "css-themes:changed",
  "window:state",
] as const;

export type PreloadInvokeChannel = (typeof PRELOAD_INVOKE_CHANNELS)[number];
/** Every channel main handles: the whitelisted ones and the preload-only ones. */
export type InvokeChannel =
  (typeof INVOKE_CHANNELS)[number] | PreloadInvokeChannel;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

/**
 * Prefixes of the renderer process arguments that carry an app's own channels
 * (`extraChannels` in startApp()) to the preload, which adds them to its
 * whitelist. Comma-separated, so main builds them with extraChannelArgs().
 */
export const EXTRA_INVOKE_CHANNELS_ARG = "--extra-invoke-channels=";
export const EXTRA_EVENT_CHANNELS_ARG = "--extra-event-channels=";

/** Channels an app adds to the preload's whitelist (see startApp()). */
export interface ExtraChannels {
  invoke: string[];
  events: string[];
}

/**
 * The renderer process arguments for `extra`. Throws on a name that is empty
 * or holds a comma (it would reach the preload as other names), and on a
 * preload-only channel, which would let the renderer forge its input.
 */
export function extraChannelArgs(extra: ExtraChannels): string[] {
  for (const name of [...extra.invoke, ...extra.events]) {
    if (!name || name.includes(",")) {
      throw new Error(`Invalid extra IPC channel name: "${name}"`);
    }
  }
  for (const name of extra.invoke) {
    if ((PRELOAD_INVOKE_CHANNELS as readonly string[]).includes(name)) {
      throw new Error(`Preload-only IPC channel cannot be extra: "${name}"`);
    }
  }
  return [
    `${EXTRA_INVOKE_CHANNELS_ARG}${extra.invoke.join(",")}`,
    `${EXTRA_EVENT_CHANNELS_ARG}${extra.events.join(",")}`,
  ];
}
