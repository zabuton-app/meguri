// List screen. Header (root/scan/theme) + filters + condition badges + progress +
// infinite-scroll grid. On thumb:done, reload the corresponding thumbnail.
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus, PlayCircle, Sparkles } from "lucide-react";
import { api, events, ALL_ID, type ThumbDone } from "@/ipc/client";
import { COLLECTION_ID_PREFIX, WATCH_LATER_ID } from "@shared/workspaceIds";
import type {
  FileRow,
  SearchQuery,
  SearchResult,
  UserCollection,
  WorkspaceInfo,
} from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { MANUAL_SORT } from "@shared/sortDir";
import { MediaGrid } from "@/components/MediaGrid";
import { HeatmapView } from "@/heatmap/HeatmapView";
import { MediaList } from "@/components/MediaList";
import {
  MediaNavProvider,
  PlaylistNavProvider,
} from "@/components/MediaNavContext";
import { CollectionEditDialog } from "@/components/CollectionEditDialog";
import { WorkspaceEditDialog } from "@/components/WorkspaceEditDialog";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { usePreferences } from "@/settings/PreferencesProvider";
import { NAV_BINDINGS, isHelpKey, matchAny } from "@/settings/keybindings";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/FilterBar";
import { ScanProgress } from "@/components/ScanProgress";
import { CommandMenu } from "@/components/CommandMenu";
import { Pet } from "@/components/pet/Pet";
import { dropPass } from "@/routes/Player/detour";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  highlightSearchToken,
  onApplyTagFilter,
  onOpenCommandMenu,
  onOpenShortcuts,
} from "@/lib/ui-events";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { recordRecentSearch } from "@/hooks/useRecentSearches";
import { useAppStatus } from "@/hooks/useAppStatus";
import { setScanning, useScanning } from "@/hooks/useScanning";
import { useFilesSearch } from "@/hooks/useFilesSearch";
import { filesSearchListOffset } from "@/lib/filesSearch";
import { TimelineView } from "@/timeline/TimelineView";
import { useTimelineView } from "./useTimelineView";
import { usePeekDocked } from "@/routes/MediaDetail/peekDocked";
import { PEEK_INSET_DOCK_PROPS } from "@/routes/MediaDetail/usePeekResize";
import { SelectionProvider } from "@/components/SelectionContext";
import { walksPlaybackOrder } from "@/lib/playbackOrder";
import { readInBulkBatches } from "@/lib/bulkEdit";
import { FolderHeader } from "@/components/FolderHeader";
import { hasFilterConditions, loadInitialFilter } from "@/lib/smartCollections";
import { useFolderNav } from "./useFolderNav";
import { useFolderFilter } from "./useFolderFilter";
import { useHeatmapFilter } from "./useHeatmapFilter";
import { setListCounts, type ListCounts } from "@/hooks/useListCounts";
import { useFolderNavKeys } from "./useFolderNavKeys";
import { useFolderPlaylist } from "./useFolderPlaylist";
import { HomeHeader } from "./HomeHeader";
import { SelectionLayer } from "./SelectionLayer";
import {
  VIEW_KEY,
  type ViewMode,
  addSearchTokens,
  discoverPath,
  BY_FOLDER_KEY,
  LIST_MAIN_ID,
  hasFolderForm,
  isFolderView,
  parseViewMode,
  scrollListByPage,
} from "./utils";

// The graph view carries WebGL and graph libraries the list views never need,
// so it is loaded the first time it is shown.
const GraphView = lazy(() =>
  import("@/graph/GraphView").then((m) => ({ default: m.GraphView })),
);

// A second Esc within this window (ms) confirms closing to tray.
const ESC_CLOSE_CONFIRM_MS = 2000;
// Fewest ms between folder listing refreshes while thumbnails are generated.
const FOLDER_REFRESH_MS = 2000;
// A search is remembered for the command menu once it has stayed put this
// long (ms), not at every keystroke on the way to it.
const RECENT_SEARCH_SETTLE_MS = 1500;

export default function Home() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const { keybindingPreset } = usePreferences();
  // Shared with the StatusBar, which App mounts outside the router.
  const scanning = useScanning();
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  // Opens on the default saved search, if one is set (see loadInitialFilter).
  const [filter, setFilter] = useState<SearchQuery>(loadInitialFilter);
  // Compared by identity below: every later filter is a new object.
  const openedWith = useRef(filter);
  const [thumbVersion, setThumbVersion] = useState<Record<string, number>>({});
  const manualScanJobs = useRef(
    new Map<string, "scan" | "resync" | "rebuild">(),
  );
  const [view, setViewMode] = useLocalStorage<ViewMode>(
    VIEW_KEY,
    "grid",
    parseViewMode,
  );
  const [byFolder, setByFolder] = useLocalStorage<boolean>(
    BY_FOLDER_KEY,
    false,
    (raw) => raw === "true",
  );
  const status = useAppStatus();
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const activeCollection =
    workspaces.data?.collections.find((c) => c.active) ?? null;
  // The active real workspace (excludes the virtual "All", which has no emoji).
  const activeWorkspace =
    workspaces.data?.workspaces.find((w) => w.active && w.id !== ALL_ID) ??
    null;
  // Snapshot the collection being edited when the dialog opens, so a background
  // workspace switch (which clears activeCollection) can't yank the dialog out
  // from under the user mid-edit and leave `pointer-events: none` stuck on <body>.
  const [editCollection, setEditCollection] = useState<UserCollection | null>(
    null,
  );
  // Same snapshot rationale as editCollection: hold the workspace being edited so a
  // background switch can't pull the dialog out from under the user mid-edit.
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceInfo | null>(
    null,
  );

  // The "show by folder" option works inside one real workspace: over "All"
  // or a collection the file view is drawn flat (see isFolderView).
  const workspaceId = status.data?.workspaceId ?? null;
  const folderAvailable =
    (status.data?.ready ?? false) &&
    !!workspaceId &&
    workspaceId !== ALL_ID &&
    !workspaceId.startsWith(COLLECTION_ID_PREFIX);
  const folderView = isFolderView({ byFolder, folderAvailable, view });
  // The one way the option changes, from the header and the command menu.
  const toggleByFolder = useCallback(
    () => setByFolder((on) => !on),
    [setByFolder],
  );
  const folderNav = useFolderNav(workspaceId);
  // With nothing narrowing the list a folder shows its own contents (child
  // folders as cards, then its direct files); a search or filter covers
  // everything below it instead, as a flat result.
  const folderSearching = folderView && hasFilterConditions(filter);
  // The folder rides on the query sent, never on `filter` itself: that state
  // is what Discover opens with, which scopes to the folder its own way. The
  // filter bar reads the folder back through `filterValue` instead.
  // The timeline orders the list itself, by its axis: the sort rides on the
  // query the same way, and the filter keeps the one the other views use.
  const timeline = useTimelineView({ view, workspaceId, filter });
  const searchQuery = useMemo<SearchQuery>(
    () =>
      view === "timeline"
        ? timeline.searchQuery
        : folderView
          ? {
              ...filter,
              folder: { path: folderNav.path, recursive: folderSearching },
            }
          : filter,
    [
      filter,
      view,
      timeline.searchQuery,
      folderView,
      folderNav.path,
      folderSearching,
    ],
  );

  // The graph has no folder form (see hasFolderForm): a folder opened from
  // outside the list — a saved search that carries one, "show in library" —
  // would be dropped without a word there, so it leaves the graph for the grid.
  const showByFolder = useCallback(
    (on: boolean) => {
      setByFolder(on);
      if (on) setViewMode((v) => (hasFolderForm(v) ? v : "grid"));
    },
    [setByFolder, setViewMode],
  );

  const { filterValue, onFilterChange, onApplySaved, onApplyRecent } =
    useFolderFilter({
      folderView,
      folderNav,
      filter,
      setFilter,
      setByFolder: showByFolder,
    });
  const heatmap = useHeatmapFilter({ filterValue, onFilterChange });
  // What the heatmap counts over: the filter, within the folder shown and
  // everything below it — what the list becomes once a day narrows it (a
  // condition turns a folder's own files into a search of its subtree).
  const heatmapQuery = useMemo<SearchQuery>(
    () =>
      folderView
        ? { ...filter, folder: { path: folderNav.path, recursive: true } }
        : filter,
    [filter, folderView, folderNav.path],
  );

  // Include the workspace ID in the key so switching workspaces (incl. "All") refetches separately.
  const search = useFilesSearch(
    status.data?.workspaceId,
    searchQuery,
    status.data?.ready ?? false,
    timeline.anchor,
  );

  const folderListing = useQuery({
    queryKey: ["folders_list", workspaceId, folderNav.path],
    queryFn: () => api.foldersList(workspaceId ?? "", folderNav.path),
    // Not while searching: the results are flat, with no cards or summary.
    enabled: folderView && !!workspaceId && !folderSearching,
  });
  // The folder shown can disappear under the view (deleted, renamed, all of
  // it excluded); the main process answers with its nearest remaining
  // ancestor, and the view moves there.
  const listedPath = folderListing.data?.path;
  const { replace: replaceFolder } = folderNav;
  useEffect(() => {
    if (listedPath == null || listedPath === folderNav.path) return;
    replaceFolder(listedPath);
    toast.info(t("folder.moved"), { id: "folder-moved" });
  }, [listedPath, folderNav.path, replaceFolder, t]);
  const folderEntries =
    folderView && !folderSearching ? folderListing.data?.folders : undefined;
  // By folder, the view waits for the folders as well as the files: drawing
  // the files first would push them down (and move keyboard focus) when the
  // folders arrive, or flash the empty state for a folder of folders.
  const listLoading =
    (search.isLoading ||
      (folderView && !folderSearching && folderListing.isLoading)) &&
    (status.data?.ready ?? false);
  // Picking a folder selects every file below it (see SelectionContext).
  const expandFolders = useCallback(
    (paths: string[]) => api.folderFiles(workspaceId ?? "", paths),
    [workspaceId],
  );
  // A bulk edit has the selection read its rows again (see SelectionContext).
  const readFiles = useCallback(
    (rows: FileRow[]) => readInBulkBatches(rows, api.filesByIds),
    [],
  );

  const items = useMemo(
    () => search.data?.pages.flatMap((p) => p.items) ?? [],
    [search.data],
  );
  const listOffset = filesSearchListOffset(search.data?.pageParams);

  // What the view is showing, for the status bar (see useListCounts):
  // browsing a folder, its own files and child folders; narrowed by a search
  // or filter, the files loaded so far ("+" while more pages remain); with
  // nothing narrowing it, the whole scope (null: the status bar's total).
  const browsing =
    folderView && !folderSearching && listedPath === folderNav.path;
  const narrowed = folderView || hasFilterConditions(filter);
  const listCounts = useMemo<ListCounts>(
    () =>
      browsing && folderListing.data
        ? {
            files: folderListing.data.fileCount,
            more: false,
            folders: folderListing.data.folders.length,
          }
        : {
            files: narrowed ? listOffset + items.length : null,
            more: narrowed && !!search.hasNextPage,
            folders: null,
          },
    [
      browsing,
      folderListing.data,
      narrowed,
      listOffset,
      items.length,
      search.hasNextPage,
    ],
  );
  useEffect(() => {
    setListCounts(listCounts);
  }, [listCounts]);
  useEffect(() => () => setListCounts(null), []);
  // Browsing by folder, the playlist and Discovery both draw from the whole
  // folder, not just the direct files the list shows (see useFolderPlaylist).
  // Its size is known from the listing: the direct files plus every child
  // folder's (recursive) count.
  const subtreeCount =
    browsing && folderListing.data
      ? folderListing.data.fileCount +
        folderListing.data.folders.reduce((n, f) => n + f.count, 0)
      : null;
  // Nothing to play or pick from means no entry point at all, rather than a
  // player or queue that opens onto an empty screen (spec FR-016). The two
  // buttons share it: they draw from the same pool.
  const hasPool =
    (status.data?.ready ?? false) && (subtreeCount ?? items.length) > 0;

  // The playlist's order while browsing by folder: everything below the
  // folder, in the list's chosen sort — by name when none is chosen, which
  // plays folder by folder. Fetched only while the player is open.

  // The player, or the detail view it detoured to (`from=player`, and the
  // files stepped to from there), is open: only then is the folder's playing
  // order worth fetching.
  const playing =
    location.pathname.startsWith("/play") ||
    (location.pathname.startsWith("/file/") &&
      walksPlaybackOrder(new URLSearchParams(location.search)));
  const { subtreeFilter, playlistNav } = useFolderPlaylist({
    workspaceId: status.data?.workspaceId,
    ready: status.data?.ready ?? false,
    filter,
    folderView,
    path: folderNav.path,
    browsing,
    playing,
  });

  // Drag-to-reorder edits the collection's own item order, so it is offered only
  // where that order is both stored (a collection) and visible (manual sort).
  const manualSort = filter.sort === MANUAL_SORT;
  // (The timeline shows its own order whatever the sort says.)
  const reorderCollectionId =
    activeCollection && manualSort && view !== "timeline"
      ? activeCollection.id
      : null;

  // Manual order belongs to a collection. Leaving one would otherwise leave the
  // sort set to a value the picker no longer offers — a blank control over a
  // list the main process has quietly fallen back to the default order for.
  useEffect(() => {
    if (activeCollection || !manualSort) return;
    // Settles in one pass: clearing the sort makes manualSort false, so the
    // guard above stops the next run.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilter((f) => {
      const next = { ...f };
      delete next.sort;
      delete next.sortDir;
      return next;
    });
  }, [activeCollection, manualSort]);
  const reorder = useMemo(
    () =>
      reorderCollectionId
        ? {
            onReorder: (next: FileRow[]) => {
              // Patch the loaded pages first so the drop lands instantly, then
              // persist. Only the loaded window is described; the main process
              // rearranges exactly those slots and leaves the rest alone.
              qc.setQueryData<InfiniteData<SearchResult>>(
                ["files_search", status.data?.workspaceId ?? null, searchQuery],
                (prev) => {
                  if (!prev) return prev;
                  let at = 0;
                  const pages = prev.pages.map((page) => ({
                    ...page,
                    items: page.items.map(() => next[at++]),
                  }));
                  return { ...prev, pages };
                },
              );
              void api
                .collectionReorderItems(
                  reorderCollectionId,
                  next.map((f) => ({
                    workspaceId: f.workspaceId,
                    fileId: f.id,
                  })),
                )
                .catch(() => {
                  // Fall back to the stored order if the write did not land.
                  void qc.invalidateQueries({ queryKey: ["files_search"] });
                });
            },
          }
        : undefined,
    [reorderCollectionId, qc, searchQuery, status.data?.workspaceId],
  );

  // Keyboard focus navigation in the views (arrow keys between cards) runs only
  // while nothing else can want those keys: no detail/settings/discover route
  // open — a docked side peek included, its player takes the arrows — and no
  // help/command overlay on top.
  const navActive = location.pathname === "/" && !helpOpen && !commandOpen;

  // Folder view moves (back / up), while the list is in front — a docked side
  // peek included it is not, as its player owns those keys.
  const { onMouseUp: onListMouseUp } = useFolderNavKeys({
    active: folderView && navActive,
    goBack: folderNav.goBack,
    goUp: folderNav.goUp,
  });

  useEffect(() => {
    document.title = status.data?.root
      ? `Meguri — ${status.data.root}`
      : "Meguri";
  }, [status.data?.root]);

  // On thumb:done, bump the version for that id to force the thumbnail to reload.
  // Events arrive dozens of times per second during bulk thumbnail generation and
  // each state update re-renders the whole Home tree, so coalesce them into one
  // update per flush window instead of one per event.
  const pendingThumbs = useRef(new Map<string, number>());
  // Read by the flush below, which must stay reference-stable.
  const folderViewRef = useRef(folderView);
  useEffect(() => {
    folderViewRef.current = folderView;
  }, [folderView]);
  const thumbFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A folder card's mosaic prefers files that already have a thumbnail, so the
  // listing is re-read as thumbnails land — but at most every
  // FOLDER_REFRESH_MS: a listing costs far more than the 100ms flush, and one
  // query worker serves the file list too.
  const folderRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFolderRefresh = useCallback(() => {
    if (folderRefreshTimer.current) return;
    folderRefreshTimer.current = setTimeout(() => {
      folderRefreshTimer.current = null;
      if (folderViewRef.current) {
        void qc.invalidateQueries({ queryKey: ["folders_list"] });
      }
    }, FOLDER_REFRESH_MS);
  }, [qc]);
  useEffect(
    () => () => {
      if (thumbFlushTimer.current) clearTimeout(thumbFlushTimer.current);
      if (folderRefreshTimer.current) clearTimeout(folderRefreshTimer.current);
    },
    [],
  );
  const onThumbDone = useCallback(
    (event: ThumbDone) => {
      const key = event.workspaceId
        ? `${event.workspaceId}:${event.id}`
        : String(event.id);
      const pending = pendingThumbs.current;
      pending.set(key, (pending.get(key) ?? 0) + 1);
      if (thumbFlushTimer.current) return;
      thumbFlushTimer.current = setTimeout(() => {
        thumbFlushTimer.current = null;
        const batch = pendingThumbs.current;
        pendingThumbs.current = new Map();
        setThumbVersion((v) => {
          const next = { ...v };
          for (const [k, n] of batch) next[k] = (next[k] ?? 0) + n;
          return next;
        });
        if (folderViewRef.current) scheduleFolderRefresh();
      }, 100);
    },
    [scheduleFolderRefresh],
  );

  // Recent searches for the command menu. A query that narrows nothing is
  // ignored there (see pushRecentSearch), and so is the one the list opened
  // with: the default saved search was not searched for, and would otherwise
  // head the recents after every launch.
  useEffect(() => {
    if (filter === openedWith.current) return;
    const timer = window.setTimeout(
      () => recordRecentSearch(filter),
      RECENT_SEARCH_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [filter]);

  // Stabilize the reference so MediaCard's memo stays effective.
  // A click AND-appends an exact tag condition rather than overwriting the
  // free-text box, which used to also match file names.
  // The click handler has to stay reference-stable for MediaCard's memo, but it
  // also needs the current filter to tell "added" from "already there". A ref
  // synced in an effect gives it both; an updater cannot, because dispatching an
  // event from one is a side effect StrictMode would run twice.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  const onTagClick = useCallback((token: string) => {
    const current = filterRef.current;
    const next = addSearchTokens(current, [token]);
    // Same reference means the condition was already there. Point at the chip
    // instead of doing nothing, which reads as a dead click.
    if (next === current) highlightSearchToken(token);
    else setFilter(next);
  }, []);

  // Refresh search results for every scan path (startup, workspace add/switch, manual scan).
  useEffect(() => {
    let un: (() => void) | undefined;
    void events
      .onScanDone((done) => {
        setScanning(false);
        void status.refetch();
        void search.refetch();
        // Folders appear, fill up and empty out with a scan like files do.
        void qc.invalidateQueries({ queryKey: ["folders_list"] });
        void qc.invalidateQueries({ queryKey: ["graph_build"] });
        void qc.invalidateQueries({ queryKey: ["activity_days"] });
        void qc.invalidateQueries({ queryKey: ["timeline_counts"] });
        // A scan can add tags (new files, the derived-tag backfill), so a tag
        // screen left open would otherwise show a stale catalog.
        void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
        const mode = manualScanJobs.current.get(done.jobId);
        manualScanJobs.current.delete(done.jobId);
        // Cancel/error are explicit, user-visible outcomes: notify regardless of
        // whether the scan was started manually (mode) or automatically (startup/switch).
        // Fixed toast IDs coalesce the per-workspace done events in the "All" view
        // into a single toast instead of one per workspace.
        if (done.aborted) {
          toast.info(t("home.scanCanceled"), { id: "scan-canceled" });
          return;
        }
        if (done.error) {
          toast.error(t("home.scanError"), { id: "scan-error" });
          return;
        }
        // The success toast is only for manual scans (avoid noise on every auto-scan).
        if (!mode) return;
        toast.success(
          t(
            mode === "rebuild"
              ? "home.rebuildComplete"
              : mode === "resync"
                ? "home.resyncComplete"
                : "home.scanComplete",
          ),
          {
            description: t("home.scanCompleteDetail", done.stats),
          },
        );
      })
      .then((u) => (un = u));
    return () => un?.();
    // search/status are react-query results; only their stable `refetch` is used.
    // Depending on the whole objects would re-subscribe the listener every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.refetch, status.refetch, t]);

  // Empty-state add button (the rail's "+" lives in WorkspaceRail). Mirror its
  // toast + scan-job tracking so the first workspace also notifies on add/sync.
  const onAddWorkspace = async () => {
    const r = await api.workspaceAdd();
    if (r.added) {
      toast.success(t("workspace.addedToast"));
      if (r.scanJobId) manualScanJobs.current.set(r.scanJobId, "scan");
    }
  };

  const onScan = async (includeExcluded = false, rebuild = false) => {
    setScanning(true);
    try {
      const jobId = await api.scanStart(includeExcluded, rebuild);
      if (!jobId) {
        setScanning(false);
        toast.error(
          t(
            status.data?.ready ? "home.scanAlreadyRunning" : "home.noWorkspace",
          ),
          { id: "scan-start-unavailable" },
        );
        return;
      }
      manualScanJobs.current.set(
        jobId,
        rebuild ? "rebuild" : includeExcluded ? "resync" : "scan",
      );
      // Reflect into the list shortly after the walk (items appear gradually as the walk completes, so poll lightly).
      setTimeout(() => void search.refetch(), 800);
    } catch (error) {
      setScanning(false);
      toast.error(t("home.scanStartFailed"), {
        id: "scan-start-failed",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Rebuild discards the file index and thumbnails and rescans from scratch. Manual
  // metadata (favorites/ratings/tags/history) is keyed independently and is preserved.
  const onRebuild = async () => {
    const ok = await confirm({
      title: t("home.rebuildIndex"),
      message: t("home.rebuildConfirm"),
    });
    if (ok) void onScan(false, true);
  };

  const focusSearch = useCallback(() => {
    const input = document.getElementById(
      "list-search-input",
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, []);

  const openDiscover = useCallback(() => {
    void navigate(discoverPath(subtreeFilter));
  }, [subtreeFilter, navigate]);

  const openTags = useCallback(() => {
    void navigate("/tags");
  }, [navigate]);

  const openSettings = useCallback(() => {
    void navigate("/settings");
  }, [navigate]);

  const openDevTools = useCallback(() => {
    void api.openDevTools();
  }, []);

  // Delegate infinite scroll to MediaGrid's virtualization (last-row detection).
  // Depend on the stable react-query method (not the whole `search` result object,
  // which is a new reference every render) so the memoized views don't re-render.
  const fetchNextPage = useCallback(() => {
    void search.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.fetchNextPage]);

  const fetchPreviousPage = useCallback(() => {
    void search.fetchPreviousPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.fetchPreviousPage]);

  // "?" opens the shortcuts overlay (works over any screen; ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (isHelpKey(e)) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  // List-level keyboard: "/" focuses search, page keys scroll the list.
  // Only while the list is foreground: no detail/settings/discover modal on
  // top — or the detail docked beside it as a side peek, which leaves the
  // list in use. (Card focus navigation stays off then: its arrow keys would
  // fight the player's.)
  const peekDocked = usePeekDocked();
  const listShortcutsActive = location.pathname === "/" || peekDocked;
  useEffect(() => {
    if (!listShortcutsActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      const b = NAV_BINDINGS[keybindingPreset];
      if (matchAny(e, b.focusSearch)) {
        // Let the key type normally if a field already has focus.
        if (typing) return;
        e.preventDefault();
        focusSearch();
        return;
      }
      if (typing) return;
      // Page keys pressed with focus inside the docked side peek page the
      // peek's own content (the browser default), not the list beside it.
      if (el?.closest('[data-presentation="peek"]')) return;
      if (matchAny(e, b.pageDown)) {
        e.preventDefault();
        scrollListByPage(1);
      } else if (matchAny(e, b.pageUp)) {
        e.preventDefault();
        scrollListByPage(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listShortcutsActive, keybindingPreset, helpOpen, focusSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const unCommand = onOpenCommandMenu(() => setCommandOpen(true));
    const unShortcuts = onOpenShortcuts(() => setHelpOpen(true));
    // The tag screen is a child route, so it asks the list to filter rather than
    // reaching into this component's state.
    const unApplyTags = onApplyTagFilter((tokens) =>
      setFilter((f) => addSearchTokens(f, tokens)),
    );
    return () => {
      unCommand();
      unShortcuts();
      unApplyTags();
    };
  }, []);

  // Esc on the bare list screen closes the window (hides to tray). Only when
  // nothing else consumes Esc: no child-route modal, no overlay/dialog/popup
  // open, and no field focused. Snapshot the "something is open" check
  // synchronously (before Esc-handlers dismiss it), then defer the close past
  // the other keydown listeners so any handler that claimed this Esc via
  // preventDefault can still veto.
  // Closing is two-step: the first Esc only arms and shows a hint toast; a
  // second Esc within ESC_CLOSE_CONFIRM_MS actually closes.
  const escCloseArmedUntil = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      const overlayOpen =
        location.pathname !== "/" ||
        helpOpen ||
        commandOpen ||
        !!editCollection ||
        !!editWorkspace ||
        // Radix dialogs/popups (confirm, dropdowns, …) and other modals.
        !!document.querySelector(
          '[role="dialog"], [role="alertdialog"], [data-state="open"]',
        );
      if (typing || overlayOpen) {
        escCloseArmedUntil.current = 0;
        return;
      }
      setTimeout(() => {
        if (e.defaultPrevented) return;
        if (Date.now() <= escCloseArmedUntil.current) {
          escCloseArmedUntil.current = 0;
          toast.dismiss("esc-close");
          void api.windowClose();
        } else {
          escCloseArmedUntil.current = Date.now() + ESC_CLOSE_CONFIRM_MS;
          toast.info(t("home.escCloseHint"), {
            id: "esc-close",
            duration: ESC_CLOSE_CONFIRM_MS,
          });
        }
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    location.pathname,
    helpOpen,
    commandOpen,
    editCollection,
    editWorkspace,
    t,
  ]);

  // Changing it scrolls the list back to its top, as another folder does.
  const listResetKey = folderView ? `folder:${folderNav.path}` : undefined;
  // Names the list on screen: the workspace, how it is browsed and the filter.
  const listScope = `${status.data?.workspaceId ?? ""}|${view === "graph" ? "graph" : view === "timeline" ? `timeline:${timeline.axis}` : (listResetKey ?? "flat")}|${JSON.stringify(filter)}`;
  // A pass the playlist parked belongs to the list it was playing. Once the
  // list becomes another one it is dropped, so nothing (the pet's "Resume
  // playback") can pick it back up and graft the new list onto the old queue.
  useEffect(() => dropPass, [listScope]);

  return (
    <div className="flex h-full flex-col">
      <HomeHeader
        root={status.data?.root}
        rootFetched={status.isFetched}
        collection={activeCollection}
        onEditCollection={() => setEditCollection(activeCollection)}
        workspace={activeWorkspace}
        onEditWorkspace={() => setEditWorkspace(activeWorkspace)}
        view={view}
        onSetView={setViewMode}
        folderView={folderView}
        onToggleByFolder={toggleByFolder}
        folderAvailable={folderAvailable}
        scanning={scanning}
        ready={status.data?.ready ?? false}
        onScan={() => void onScan()}
        onScanWithDeleted={() => void onScan(true)}
        onRebuild={() => void onRebuild()}
        t={t}
      />

      {/* Selectable: this carries the raw main-process error users report. */}
      {status.data?.initError && (
        <div className="select-text border-b border-border bg-destructive px-4 py-2 text-sm text-destructive-foreground">
          <p>{t("home.initError", { msg: status.data.initError })}</p>
          {status.data.initErrorKind === "schema_mismatch" && (
            <p className="mt-1 text-xs">
              {t("home.initErrorSchemaMismatchHelp")}
            </p>
          )}
        </div>
      )}

      <FilterBar
        value={filterValue}
        onChange={onFilterChange}
        manualSortAvailable={!!activeCollection}
        sortNote={view === "timeline" ? t("timeline.sortLocked") : undefined}
        workspaceId={folderAvailable ? workspaceId : null}
        onApplySaved={onApplySaved}
        onToggleHeatmap={heatmap.toggle}
        heatmapOpen={heatmap.open}
      />

      {/* The heatmap: a panel under the filter bar, over whichever view is
          shown. It counts what the list would hold (the folder shown
          included) and writes the days picked into the filter. */}
      {heatmap.open && (status.data?.ready ?? false) && (
        <HeatmapView
          scope={status.data?.workspaceId ?? ""}
          query={heatmapQuery}
          ready={!!status.data?.workspaceId}
          metric={heatmap.metric}
          onMetricChange={heatmap.setMetric}
          onRangeChange={heatmap.pickRange}
        />
      )}

      {folderView && (
        <FolderHeader
          workspaceId={workspaceId ?? undefined}
          rootLabel={activeWorkspace?.label ?? t("folder.root")}
          path={folderNav.path}
          onNavigate={folderNav.goTo}
          canGoBack={folderNav.canGoBack}
          onBack={folderNav.goBack}
          onUp={folderNav.goUp}
          onOpenInFileManager={() => {
            api
              .folderOpenInFileManager(workspaceId ?? "", folderNav.path)
              .catch((error: unknown) =>
                toast.error(t("folder.openFailed"), {
                  id: "folder-open-failed",
                  description:
                    error instanceof Error ? error.message : String(error),
                }),
              );
          }}
          onCopyPath={() => {
            api.folderCopyPath(workspaceId ?? "", folderNav.path).then(
              () =>
                toast.success(t("folder.pathCopied"), {
                  id: "folder-path-copied",
                }),
              (error: unknown) =>
                toast.error(t("folder.copyFailed"), {
                  id: "folder-copy-failed",
                  description:
                    error instanceof Error ? error.message : String(error),
                }),
            );
          }}
          summary={
            // What the folder itself holds; a search shows its own results.
            // (and only once the listing is the folder named: a vanished
            // folder is answered with an ancestor until the view moves there).
            !folderSearching && folderListing.data?.path === folderNav.path
              ? t("folder.summary", {
                  folders: folderListing.data.folders.length,
                  files: folderListing.data.fileCount,
                })
              : undefined
          }
        />
      )}

      <ScanProgress onThumbDone={onThumbDone} wsId={status.data?.workspaceId} />

      {/* The list row: the detail side peek (see MediaModal) docks here as a
          flex sibling of the list, under the header and filter bar and above
          the player and status bars, and the list narrows to make room. */}
      {/* The scope key drops the selection when the list itself changes
          (workspace, folder or filter), but not while paging within one list: rows
          picked under a different list are off screen, and a bulk edit that
          quietly included them would act on files the user cannot see. */}
      <SelectionProvider
        items={items}
        scope={listScope}
        // Only the folders on screen: once the window has moved past the top
        // neither view draws them, and "select all" must not pick them.
        folders={listOffset === 0 ? folderEntries : undefined}
        expandFolders={expandFolders}
        readFiles={readFiles}
      >
        <div className="relative flex min-h-0 flex-1">
          {/* min-w-60 = the 240px the side peek leaves the list (LIST_MIN_WIDTH
          in usePeekResize); the two must agree. */}
          <main
            id={LIST_MAIN_ID}
            className="min-h-0 min-w-60 flex-1"
            onMouseUp={onListMouseUp}
          >
            {status.isFetched && !status.data?.ready ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted">
                <FolderPlus className="size-10 opacity-60" />
                <p className="text-sm">{t("home.noWorkspace")}</p>
                <Button size="sm" onClick={() => void onAddWorkspace()}>
                  <FolderPlus />
                  {t("home.addDirectory")}
                </Button>
                <p className="text-xs opacity-70">{t("home.addFromSidebar")}</p>
              </div>
            ) : view === "graph" ? (
              // Keyed by scope: another workspace or collection is another
              // graph, with its own positions and camera.
              <Suspense fallback={null}>
                <GraphView
                  key={status.data?.workspaceId ?? ""}
                  scope={status.data?.workspaceId ?? ""}
                  query={filter}
                  ready={
                    (status.data?.ready ?? false) && !!status.data?.workspaceId
                  }
                  keysActive={navActive}
                  onFilterToken={onTagClick}
                />
              </Suspense>
            ) : view === "timeline" ? (
              <TimelineView
                scope={status.data?.workspaceId ?? ""}
                query={filter}
                axis={timeline.axis}
                onAxisChange={timeline.setAxis}
                ready={
                  (status.data?.ready ?? false) && !!status.data?.workspaceId
                }
                items={items}
                listOffset={listOffset}
                loading={listLoading}
                mediaBase={status.data?.mediaBase ?? ""}
                thumbVersion={thumbVersion}
                onTagClick={onTagClick}
                hasNextPage={search.hasNextPage}
                fetchNextPage={fetchNextPage}
                isFetchingNextPage={search.isFetchingNextPage}
                hasPreviousPage={search.hasPreviousPage}
                fetchPreviousPage={fetchPreviousPage}
                isFetchingPreviousPage={search.isFetchingPreviousPage}
                onAnchor={timeline.onAnchor}
                navActive={navActive}
                watchLater={activeCollection?.id === WATCH_LATER_ID}
              />
            ) : view === "list" ? (
              <MediaList
                items={items}
                mediaBase={status.data?.mediaBase ?? ""}
                workspaceId={status.data?.workspaceId ?? ""}
                listOffset={listOffset}
                loading={listLoading}
                thumbVersion={thumbVersion}
                onTagClick={onTagClick}
                hasNextPage={search.hasNextPage}
                fetchNextPage={fetchNextPage}
                isFetchingNextPage={search.isFetchingNextPage}
                hasPreviousPage={search.hasPreviousPage}
                fetchPreviousPage={fetchPreviousPage}
                isFetchingPreviousPage={search.isFetchingPreviousPage}
                navActive={navActive}
                watchLater={activeCollection?.id === WATCH_LATER_ID}
                reorder={reorder}
                folders={folderEntries}
                onOpenFolder={folderNav.enter}
                resetKey={listResetKey}
                inFolder={folderSearching}
              />
            ) : (
              // By folder, either view gets the folders ahead of the files
              // (folders is unset otherwise).
              <MediaGrid
                items={items}
                mediaBase={status.data?.mediaBase ?? ""}
                workspaceId={status.data?.workspaceId ?? ""}
                listOffset={listOffset}
                loading={listLoading}
                thumbVersion={thumbVersion}
                onTagClick={onTagClick}
                hasNextPage={search.hasNextPage}
                fetchNextPage={fetchNextPage}
                isFetchingNextPage={search.isFetchingNextPage}
                hasPreviousPage={search.hasPreviousPage}
                fetchPreviousPage={fetchPreviousPage}
                isFetchingPreviousPage={search.isFetchingPreviousPage}
                navActive={navActive}
                watchLater={activeCollection?.id === WATCH_LATER_ID}
                reorder={reorder}
                folders={folderEntries}
                onOpenFolder={folderNav.enter}
                resetKey={listResetKey}
                inFolder={folderSearching}
              />
            )}
          </main>

          {/* The /file/:id detail overlays here — as a modal over the window or as
          a side peek docked to this list area (the list stays mounted either
          way). Share the current list order so the detail can step prev/next. */}
          <MediaNavProvider
            value={{
              items,
              listOffset,
              fetchNextPage,
              hasNextPage: search.hasNextPage,
              isFetchingNextPage: search.isFetchingNextPage,
              fetchPreviousPage,
              hasPreviousPage: search.hasPreviousPage,
              isFetchingPreviousPage: search.isFetchingPreviousPage,
              isLoading: search.isLoading,
            }}
          >
            <PlaylistNavProvider value={playlistNav}>
              <Outlet />
            </PlaylistNavProvider>
          </MediaNavProvider>

          {/* The graph has no cards to pick; entering it also drops the
              selection (see the scope key above). */}
          {view !== "graph" && <SelectionLayer active={navActive} />}
        </div>

        {/* Inside the selection provider: its file actions act on the
            selection when there is one. */}
        <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          ready={status.data?.ready ?? false}
          scanning={scanning}
          devToolsEnabled={status.data?.devMode ?? false}
          onFocusSearch={focusSearch}
          onScan={(includeExcluded) => void onScan(includeExcluded)}
          onRebuild={() => void onRebuild()}
          onSetView={setViewMode}
          onToggleByFolder={toggleByFolder}
          onToggleHeatmap={heatmap.toggle}
          heatmapOpen={heatmap.open}
          folderView={folderView}
          folderAvailable={folderAvailable && hasFolderForm(view)}
          onDiscover={openDiscover}
          canDiscover={hasPool}
          onTags={openTags}
          onSettings={openSettings}
          onHelp={() => setHelpOpen(true)}
          onOpenDevTools={openDevTools}
          onApplySearch={onApplyRecent}
          onApplySaved={onApplySaved}
          onQuickSearch={(text) => onFilterChange({ ...filterValue, q: text })}
          fileActionsAvailable={location.pathname === "/"}
        />
      </SelectionProvider>

      {/* The two FABs, wrapped so the side peek can publish its width on this
          element alone (see PEEK_INSET_DOCK_PROPS) rather than on <html>. */}
      <div className="contents" {...PEEK_INSET_DOCK_PROPS}>
        {/* Play the list as a playlist. No params: the player reads the very list
          order shared through MediaNavContext below, so whatever sort/filter is
          on screen is what plays — collection, Watch Later or plain search.
          Browsing by folder it plays the whole folder instead (PlaylistNav).
          Accent-filled like the discovery button beside it: both start a way of
          watching, and neither is subordinate to the other. */}
        <Link
          to="/play"
          title={t("playlist.start")}
          aria-label={t("playlist.start")}
          aria-disabled={!hasPool}
          tabIndex={hasPool ? undefined : -1}
          className={cn(
            // Stacked above the discovery button; both lift together when the
            // audio player bar is showing, and both move left of the detail
            // side peek while it is docked (each variable is 0 otherwise).
            "fixed bottom-[calc(6rem+var(--meguri-player-bar-inset))] right-[calc(1.25rem+var(--meguri-peek-inset))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-black/25 transition hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !hasPool && "pointer-events-none opacity-45",
          )}
        >
          <PlayCircle className="size-6" />
        </Link>

        <Link
          to={discoverPath(subtreeFilter)}
          title={t("discover.title")}
          aria-label={t("discover.title")}
          aria-disabled={!hasPool}
          tabIndex={hasPool ? undefined : -1}
          className={cn(
            // Lifted clear of the audio player bar when one is showing (the
            // variable is 0 otherwise, keeping the original offset).
            "fixed bottom-[calc(1.25rem+var(--meguri-player-bar-inset))] right-[calc(1.25rem+var(--meguri-peek-inset))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-black/25 transition hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !hasPool && "pointer-events-none opacity-45",
          )}
        >
          <Sparkles className="size-6" />
        </Link>
      </div>

      {/* The zabuton pet. It sits below the routed modals in the stacking
          order, so their backdrop covers it — and it rests while one does.
          Docked as a side peek the detail leaves the list in use, pet included. */}
      <Pet
        active={listShortcutsActive}
        hasPool={hasPool}
        onDiscover={openDiscover}
      />

      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}

      <CollectionEditDialog
        open={!!editCollection}
        onOpenChange={(open) => {
          if (!open) setEditCollection(null);
        }}
        collection={editCollection}
      />

      <WorkspaceEditDialog
        open={!!editWorkspace}
        onOpenChange={(open) => {
          if (!open) setEditWorkspace(null);
        }}
        workspace={editWorkspace}
      />
    </div>
  );
}
