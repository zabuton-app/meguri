// List screen. Header (root/scan/theme) + filters + condition badges + progress +
// infinite-scroll grid. On thumb:done, reload the corresponding thumbnail.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus, Sparkles } from "lucide-react";
import { resolveSortDir } from "@shared/sortDir";
import { api, events, ALL_ID, type ThumbDone } from "@/ipc/client";
import type { SearchQuery, UserCollection, WorkspaceInfo } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { MediaGrid } from "@/components/MediaGrid";
import { MediaList } from "@/components/MediaList";
import { MediaTable } from "@/components/MediaTable";
import { MediaNavProvider } from "@/components/MediaNavContext";
import { CollectionEditDialog } from "@/components/CollectionEditDialog";
import { WorkspaceEditDialog } from "@/components/WorkspaceEditDialog";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { usePreferences } from "@/settings/PreferencesProvider";
import {
  NAV_BINDINGS,
  HELP_KEY,
  matchAny,
  matchChord,
} from "@/settings/keybindings";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/FilterBar";
import { ScanProgress } from "@/components/ScanProgress";
import { StatusBar } from "@/components/StatusBar";
import { CommandMenu } from "@/components/CommandMenu";
import { useConfirm } from "@/components/ConfirmDialog";
import { onOpenCommandMenu, onOpenShortcuts } from "@/lib/ui-events";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useFilesSearch } from "@/hooks/useFilesSearch";
import { filesSearchListOffset } from "@/lib/filesSearch";
import { HomeHeader } from "./HomeHeader";
import { ActiveFilterChips, type ChipEntry } from "./ActiveFilterChips";
import {
  VIEW_KEY,
  type ViewMode,
  discoverPath,
  isViewMode,
  scrollListByPage,
  sortLabel,
} from "./utils";

// A second Esc within this window (ms) confirms closing to tray.
const ESC_CLOSE_CONFIRM_MS = 2000;

export default function Home() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const { keybindingPreset } = usePreferences();
  const [scanning, setScanning] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [filter, setFilter] = useState<SearchQuery>({});
  const [thumbVersion, setThumbVersion] = useState<Record<string, number>>({});
  const manualScanJobs = useRef(
    new Map<string, "scan" | "resync" | "rebuild">(),
  );
  const [view, setViewMode] = useLocalStorage<ViewMode>(
    VIEW_KEY,
    "grid",
    (raw) => (isViewMode(raw) ? raw : "grid"),
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

  // Include the workspace ID in the key so switching workspaces (incl. "All") refetches separately.
  const search = useFilesSearch(
    status.data?.workspaceId,
    filter,
    status.data?.ready ?? false,
  );

  const items = useMemo(
    () => search.data?.pages.flatMap((p) => p.items) ?? [],
    [search.data],
  );
  const listOffset = filesSearchListOffset(search.data?.pageParams);

  // Keyboard focus navigation in the views runs only while the list is foreground
  // (no detail/settings/discover modal, and no help/command overlay on top).
  const navActive = location.pathname === "/" && !helpOpen && !commandOpen;

  // Turn active search conditions into badges (remove individually via ✗).
  const patchFilter = (p: Partial<SearchQuery>) =>
    setFilter((f) => ({ ...f, ...p }));
  const activeChips: ChipEntry[] = [];
  if (filter.q)
    activeChips.push({
      key: "q",
      label: `"${filter.q}"`,
      clear: () => patchFilter({ q: undefined }),
    });
  if (filter.kind)
    activeChips.push({
      key: "kind",
      label: filter.kind === "video" ? t("kind.video") : t("kind.image"),
      clear: () => patchFilter({ kind: undefined }),
    });
  if (filter.ratingMin)
    activeChips.push({
      key: "rating",
      label: `★${filter.ratingMin}+`,
      clear: () => patchFilter({ ratingMin: undefined }),
    });
  if (filter.favorite)
    activeChips.push({
      key: "favorite",
      label: `♥ ${t("favorite.chip")}`,
      clear: () => patchFilter({ favorite: undefined }),
    });
  if (filter.played != null)
    activeChips.push({
      key: "played",
      label: filter.played ? t("filter.played") : t("filter.unplayed"),
      clear: () => patchFilter({ played: undefined }),
    });
  if (filter.sort || filter.sortDir) {
    const sort = filter.sort ?? "added";
    const sortDir = resolveSortDir(sort, filter.sortDir);
    activeChips.push({
      key: "sort",
      label: `${sortLabel(t, sort)} / ${t(sortDir === "asc" ? "sort.asc" : "sort.desc")}`,
      clear: () => patchFilter({ sort: undefined, sortDir: undefined }),
    });
  }
  (filter.tags ?? []).forEach((tag, i) =>
    activeChips.push({
      key: `tag-${i}`,
      label: `${t("media.tags")}: ${tag}`,
      clear: () =>
        setFilter((f) => ({
          ...f,
          tags: (f.tags ?? []).filter((_, j) => j !== i),
        })),
    }),
  );

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
  const thumbFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (thumbFlushTimer.current) clearTimeout(thumbFlushTimer.current);
    },
    [],
  );
  const onThumbDone = useCallback((event: ThumbDone) => {
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
    }, 100);
  }, []);

  // Stabilize the reference so MediaCard's memo stays effective.
  const onTagClick = useCallback(
    (name: string) => setFilter((f) => ({ ...f, q: name })),
    [],
  );

  // Refresh search results for every scan path (startup, workspace add/switch, manual scan).
  useEffect(() => {
    let un: (() => void) | undefined;
    void events
      .onScanDone((done) => {
        setScanning(false);
        void status.refetch();
        void search.refetch();
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
          t(status.data?.ready ? "home.scanAlreadyRunning" : "home.noWorkspace"),
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
        description:
          error instanceof Error ? error.message : String(error),
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
    void navigate(discoverPath(filter));
  }, [filter, navigate]);

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
      if (matchChord(e, HELP_KEY)) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  // List-level keyboard: "/" focuses search, page keys scroll the list.
  // Only while the list is foreground (no detail/settings/discover modal on top).
  useEffect(() => {
    if (location.pathname !== "/") return;
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
  }, [location.pathname, keybindingPreset, helpOpen, focusSearch]);

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
    return () => {
      unCommand();
      unShortcuts();
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
  }, [location.pathname, helpOpen, commandOpen, editCollection, editWorkspace, t]);

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
        scanning={scanning}
        ready={status.data?.ready ?? false}
        onScan={() => void onScan()}
        onScanWithDeleted={() => void onScan(true)}
        onRebuild={() => void onRebuild()}
        t={t}
      />

      {status.data?.initError && (
        <div className="border-b border-border bg-destructive px-4 py-2 text-sm text-destructive-foreground">
          <p>{t("home.initError", { msg: status.data.initError })}</p>
          {status.data.initErrorKind === "schema_mismatch" && (
            <p className="mt-1 text-xs">
              {t("home.initErrorSchemaMismatchHelp")}
            </p>
          )}
        </div>
      )}

      <FilterBar value={filter} onChange={setFilter} />

      <ActiveFilterChips
        chips={activeChips}
        onClearAll={() => setFilter({})}
        t={t}
      />
      <ScanProgress onThumbDone={onThumbDone} wsId={status.data?.workspaceId} />

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
        onDiscover={openDiscover}
        onSettings={openSettings}
        onHelp={() => setHelpOpen(true)}
        onOpenDevTools={openDevTools}
      />

      <main id="list-main" className="min-h-0 flex-1">
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
        ) : view === "list" ? (
          <MediaList
            items={items}
            mediaBase={status.data?.mediaBase ?? ""}
            workspaceId={status.data?.workspaceId ?? ""}
            listOffset={listOffset}
            loading={search.isLoading && (status.data?.ready ?? false)}
            thumbVersion={thumbVersion}
            onTagClick={onTagClick}
            hasNextPage={search.hasNextPage}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            hasPreviousPage={search.hasPreviousPage}
            fetchPreviousPage={fetchPreviousPage}
            isFetchingPreviousPage={search.isFetchingPreviousPage}
            navActive={navActive}
          />
        ) : view === "table" ? (
          <MediaTable
            items={items}
            mediaBase={status.data?.mediaBase ?? ""}
            workspaceId={status.data?.workspaceId ?? ""}
            listOffset={listOffset}
            loading={search.isLoading && (status.data?.ready ?? false)}
            thumbVersion={thumbVersion}
            onTagClick={onTagClick}
            hasNextPage={search.hasNextPage}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            hasPreviousPage={search.hasPreviousPage}
            fetchPreviousPage={fetchPreviousPage}
            isFetchingPreviousPage={search.isFetchingPreviousPage}
            navActive={navActive}
          />
        ) : (
          <MediaGrid
            items={items}
            mediaBase={status.data?.mediaBase ?? ""}
            workspaceId={status.data?.workspaceId ?? ""}
            listOffset={listOffset}
            loading={search.isLoading && (status.data?.ready ?? false)}
            thumbVersion={thumbVersion}
            onTagClick={onTagClick}
            hasNextPage={search.hasNextPage}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            hasPreviousPage={search.hasPreviousPage}
            fetchPreviousPage={fetchPreviousPage}
            isFetchingPreviousPage={search.isFetchingPreviousPage}
            navActive={navActive}
          />
        )}
      </main>

      <StatusBar workspaceId={status.data?.workspaceId} scanning={scanning} />

      <Link
        to={discoverPath(filter)}
        title={t("discover.title")}
        aria-label={t("discover.title")}
        aria-disabled={!status.data?.ready}
        tabIndex={status.data?.ready ? undefined : -1}
        className={cn(
          "fixed bottom-5 right-5 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-black/25 transition hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !status.data?.ready && "pointer-events-none opacity-45",
        )}
      >
        <Sparkles className="size-6" />
      </Link>

      {/* The /file/:id detail overlays here as a modal (the list stays mounted).
          Share the current list order so the detail can step prev/next. */}
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
        }}
      >
        <Outlet />
      </MediaNavProvider>

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
