// English catalog. Must cover exactly the same keys as ja.ts (enforced by the type).
import type { TranslationKey } from "./ja";

export const en: Record<TranslationKey, string> = {
  // common
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.ok": "OK",

  // kind
  "kind.video": "Video",
  "kind.image": "Image",

  // sort
  "sort.added": "Added",
  "sort.name": "Name",
  "sort.rating": "Rating",
  "sort.captured": "Captured",
  "sort.accessed": "Last viewed",
  "sort.hash": "File hash",
  "sort.asc": "Ascending",
  "sort.desc": "Descending",

  // settings
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.appearanceDesc":
    "Switch between light and dark (theme palette is preserved).",
  "settings.light": "Light",
  "settings.dark": "Dark",
  "settings.theme": "Theme",
  "settings.language": "Language",
  "settings.languageDesc": "Switch the display language of the UI.",
  "settings.scenes": "Scene thumbnails",
  "settings.scenesDesc":
    "How many scene thumbnails to generate on the detail screen.",
  "settings.hoverPreview": "Hover preview",
  "settings.hoverPreviewDesc":
    "Preview the scene under the cursor while hovering over a video thumbnail.",
  "settings.keybinding": "Keybinds",
  "settings.keybindingDesc":
    "Key bindings for moving focus in the list, file paging, scrolling, and focusing search.",
  "settings.support": "Support development",
  "settings.supportDesc":
    "If you enjoy this app, please consider supporting its development.",
  "settings.buyMeCoffee": "Buy Me a Coffee",
  "settings.hideSupport": "Hide support link",
  "settings.update": "Updates",
  "settings.updateDesc": "Check whether a newer version is available.",
  "settings.updateCheckNow": "Check now",
  "settings.updateAuto": "Check automatically on startup",
  "update.available": "Version {version} is available",
  "update.availableDesc": "Current version: {current}",
  "update.view": "Open release",
  "update.skip": "Skip this version",
  "update.checking": "Checking…",
  "update.checkFailed": "Couldn't check (you may be offline).",
  "update.upToDate": "You're up to date ({version}).",
  "settings.about": "About",
  "about.version": "Version {version}",
  "about.appLicense": "Meguri is released under the MIT License.",
  "about.ossTitle": "Open-source licenses",
  "about.ossDesc": "This app includes the following open-source software.",
  "about.ffmpegNotice":
    "The bundled FFmpeg / FFprobe binaries are licensed under GPL v3. The full license text and source code are available via the links below.",
  "about.license": "License",
  "about.source": "Source",
  "about.fullDependencies": "View all dependencies (package.json)",
  "keybinding.normal": "Normal",
  "keybinding.vim": "Vim",
  "keybinding.emacs": "Emacs",

  // home
  "home.noDirectory": "(No directory selected)",
  "home.scan": "Scan",
  "home.initError": "Initialization error: {msg}",
  "home.initErrorSchemaMismatchHelp":
    "The database format may not match this version of the app. Delete this workspace from the left sidebar, then register it again.",
  "home.removeChip": "Remove this filter",
  "home.clearAll": "Clear all",
  "home.noWorkspace": "No video directory has been added.",
  "home.addDirectory": "Add directory",
  "home.addFromSidebar": "You can also add or switch from the left sidebar.",
  "home.scanWithDeleted": "Resync including deleted items",
  "home.rebuildIndex": "Rebuild index",
  "home.rebuildConfirm":
    "Discard the file list and thumbnails and rescan from scratch. Favorites, ratings, tags, and play history are preserved, but files you removed from the index will reappear. Continue?",
  "home.scanComplete": "Scan complete",
  "home.resyncComplete": "Resync complete",
  "home.rebuildComplete": "Index rebuild complete",
  "home.scanCompleteDetail":
    "Added {inserted}, updated {updated}, moved {moved}, removed {deleted}.",
  "home.scanCanceled": "Scan canceled",
  "home.escCloseHint": "Press Esc again to close the window",
  "home.scanError": "An error occurred during the scan",
  "home.scanStartFailed": "Could not start scan",
  "home.scanAlreadyRunning": "A scan is already in progress",

  // command menu
  "command.title": "Command menu",
  "command.placeholder": "Search commands...",
  "command.empty": "No matching commands.",
  "command.groupNavigation": "Navigation",
  "command.groupWorkspace": "Workspace",
  "command.groupView": "View",
  "command.focusSearch": "Focus search",
  "command.openDevTools": "Open developer console",
  "command.shortcutHint": "Open with {shortcut}",

  // filter
  "filter.searchPlaceholder": "Search file name or tags",
  "filter.all": "All",
  "filter.playAny": "Play state",
  "filter.played": "Played",
  "filter.unplayed": "Unplayed",
  "filter.sortLabel": "{label}",
  "filter.ratingFilter": "Filter by minimum rating",

  // smart collections
  "smartCollection.title": "Smart collections",
  "smartCollection.shortTitle": "Filters",
  "smartCollection.saveCurrent": "Save current filters",
  "smartCollection.empty": "No saved searches yet.",
  "smartCollection.delete": "Delete collection",
  "smartCollection.saveTitle": "Save search filters",
  "smartCollection.namePlaceholder": "Collection name",
  "smartCollection.save": "Save",
  "smartCollection.allMedia": "All media",
  "smartCollection.defaultFavorites": "Favorites",
  "smartCollection.defaultRating": "★{rating}+",
  "smartCollection.defaultUnplayed": "Unplayed",
  "smartCollection.defaultName": "New collection",

  // media detail
  "media.notFound": "File not found.",
  "media.openExternal": "Open externally",
  "media.openFolder": "Open containing folder",
  "media.copyFilePath": "Copy File Path",
  "media.copyImage": "Copy image",
  "media.imageCopied": "Image copied to clipboard",
  "media.imageCopyFailed": "Failed to copy image",
  "media.invertImageBackground": "Invert image background",
  "media.modalMaximize": "Enlarge modal",
  "media.modalMinimize": "Shrink modal",
  "media.deleteFromIndex": "Delete From Index",
  "media.deleteFromIndexConfirm":
    "Delete this item from the index?\nIt will not be registered again by future scans.",
  "media.moreActions": "More actions",
  "media.prev": "Previous file",
  "media.next": "Next file",
  "shortcuts.title": "Keyboard shortcuts",
  "shortcuts.sectionList": "List",
  "shortcuts.sectionDetail": "Detail & player",
  "shortcuts.commandMenu": "Open command menu",
  "shortcuts.search": "Focus search",
  "shortcuts.scrollDown": "Scroll down",
  "shortcuts.scrollUp": "Scroll up",
  "shortcuts.moveFocus": "Move focus (up/down/left/right)",
  "shortcuts.openFocused": "Open focused item",
  "shortcuts.help": "This help",
  "shortcuts.playPause": "Play / pause",
  "shortcuts.skip5": "Back / forward 5s",
  "shortcuts.skip10": "Back / forward 10s",
  "shortcuts.volume": "Volume up / down",
  "shortcuts.mute": "Toggle mute",
  "shortcuts.fullscreen": "Toggle fullscreen",
  "shortcuts.seekStart": "Jump to start",
  "media.rating": "Rating",
  "media.tags": "Tags",
  "media.metaWorkspace": "Workspace",
  "media.metaKind": "Type",
  "media.metaResolution": "Resolution",
  "media.metaSize": "Size",
  "media.metaDuration": "Duration",
  "media.metaCodec": "Codec",
  "media.metaFps": "FPS",
  "media.playHistory": "Play history",
  "media.scenes": "Scenes",
  "media.bookmarks": "Scene bookmarks",
  "media.bookmarkRemove": "Remove bookmark",
  "media.thumbSet": "Set as main thumbnail",
  "media.thumbClear": "Revert to auto thumbnail",
  "media.thumbApplying": "Applying main thumbnail…",
  "media.currentMainThumb": "Current main thumbnail:",

  // player controls
  "player.play": "Play",
  "player.playKey": "Play (Space)",
  "player.pauseKey": "Pause (Space)",
  "player.back10": "Back 10s (J)",
  "player.forward10": "Forward 10s (L)",
  "player.mute": "Mute (M)",
  "player.unmute": "Unmute (M)",
  "player.fullscreen": "Fullscreen (F)",
  "player.volume": "Volume",
  "player.seek": "Seek",
  "player.playFailed": "Could not play in the built-in player.",
  "player.openExternal": "Open in external player",
  "player.bookmarkAdd": "Bookmark the current position",
  "player.bookmarkRemove": "Remove the bookmark at {time}",

  // playback errors
  "player.errAborted": "Loading was aborted (MEDIA_ERR_ABORTED)",
  "player.errNetwork": "Network error (MEDIA_ERR_NETWORK)",
  "player.errDecode":
    "Failed to decode — codec may be unsupported (MEDIA_ERR_DECODE)",
  "player.errSrcNotSupported":
    "This format cannot be played (MEDIA_ERR_SRC_NOT_SUPPORTED)",
  "player.errUnknown": "Unknown error",
  "player.errCode": "Error code {code}",

  // scenes
  "scene.seekTo": "Seek to {time}",
  "scene.alt": "Scene {time}",

  // scan progress
  "scan.phaseWalk": "Enumerating files",
  "scan.phaseHash": "Checking files",
  "scan.phaseIndex": "Building index",
  "scan.phaseThumbnail": "Generating thumbnails",
  "scan.cancel": "Cancel scan",

  // tag editor
  "tag.none": "No tags",
  "tag.addPlaceholder": "Add a tag and press Enter",
  "tag.remove": "Remove tag",

  // media grid
  "grid.empty": "No media to display.",
  "grid.emptyHint": 'Run "Scan" to list videos and images here.',
  "grid.searchByTag": 'Search for "{name}"',
  "view.grid": "Grid view",
  "view.list": "List view",
  "view.table": "Table view",
  "table.name": "Name",

  // discovery (random recommendations)
  "discover.title": "Discovery",
  "discover.reshuffle": "Reshuffle",
  "discover.play": "Play",
  "discover.open": "Open",
  "discover.progress": "{current} / {total}",
  "discover.empty": "No media to recommend.",
  "discover.emptyHint":
    'Run "Scan" to import videos and images, and they\'ll be recommended here at random.',
  "discover.sceneHint": "Hover to enlarge · click to play from that point",
  "discover.moreScenes": "+{count}",

  // Play history
  "history.title": "Play history",
  "history.empty": "No play history yet.",
  "history.emptyHint": "Play videos or images and they will show up here.",
  "history.clear": "Clear history",
  "history.clearAction": "Clear",
  "history.clearConfirm": "Delete all play history? This cannot be undone.",
  "history.playCount": "{count} plays",
  "history.viaBrowser": "In-app",
  "history.viaExternal": "External player",
  "history.today": "Today",
  "history.yesterday": "Yesterday",

  "duplicates.title": "Duplicate Files",
  "duplicates.empty": "No duplicate files found.",
  "duplicates.emptyHint":
    "Files with identical content (matching hash and size) will appear here.",
  "duplicates.summary": "{groups} groups / {files} files / {size} duplicated",
  "duplicates.fileCount": "{count} files",
  "duplicates.truncated": "Too many groups; showing only the top {max}.",
  "duplicates.filter": "Show only duplicate files",
  "duplicates.chip": "Duplicates",

  // workspace rail
  "workspace.all": "All",
  "workspace.settings": "Settings",
  "workspace.edit": "Edit workspace",
  "workspace.editAction": "Save",
  "workspace.pathReadonly": "The path cannot be changed.",
  "workspace.addDirectory": "Add video directory",
  "workspace.removeFromSidebar": "Delete workspace",
  "workspace.removeTitle": "Delete workspace",
  "workspace.removeConfirm":
    'Delete "{label}"?\nIts database and thumbnails will also be deleted (the media files themselves are kept).',
  "workspace.removeAction": "Delete",
  "workspace.addedToast": "Workspace added",
  "workspace.removedToast": "Workspace deleted",
  "workspace.removedToastDetail": '"{label}" was removed.',

  // user collections
  "collection.create": "Create user collection",
  "collection.createAction": "Create",
  "collection.edit": "Edit collection",
  "collection.editAction": "Save",
  "collection.createFailed": "Could not create collection",
  "collection.namePrompt": "Collection name",
  "collection.removeFromSidebar": "Delete collection",
  "collection.removeTitle": "Delete collection",
  "collection.removeConfirm":
    'Delete "{name}"?\nThe media files themselves are kept.',
  "collection.removeAction": "Delete",
  "collection.removedToast": "Collection deleted",
  "collection.removedToastDetail": '"{name}" was removed.',
  "collection.addToMenu": "Add to collection",
  "collection.addTo": 'Add to "{name}"',
  "collection.removeFrom": 'Remove from "{name}"',
  "collection.addedToast": 'Added to "{name}"',
  "collection.removedFromToast": 'Removed from "{name}"',
  "collection.actionFailed": "Could not update collection",

  // emoji icon
  "emoji.choose": "Choose emoji",
  "emoji.remove": "Remove emoji",
  "emoji.set": "Set emoji",
  "collection.empty": "No collections",

  // rating
  "rating.star": "{n} stars",

  // favorite
  "favorite.add": "Add to favorites",
  "favorite.remove": "Remove from favorites",
  "favorite.filter": "Show favorites only",
  "favorite.chip": "Favorites",

  // status bar
  "statusbar.label": "Status bar",
  "statusbar.lastScan": "Last scan",
  "statusbar.lastScanNever": "Never",
  "statusbar.fileCount": "{count} files",
  "statusbar.status": "Status",
  "statusbar.scanning": "Scanning",
  "statusbar.idle": "Idle",
};
