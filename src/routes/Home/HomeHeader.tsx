import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarRange,
  ChevronDown,
  CopyCheck,
  DatabaseBackup,
  FileX,
  FolderOpen,
  FolderTree,
  History,
  Check,
  LayoutGrid,
  List,
  MoreHorizontal,
  Waypoints,
  Pencil,
  RefreshCw,
  Sparkles,
  Tags as TagsIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { UserCollection, WorkspaceInfo } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TitleBarPortal } from "@/components/titleBarSlot";
import { cn } from "@/lib/utils";
import type { TFunc } from "@/i18n/I18nProvider";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import { hasFolderForm, type ViewMode } from "./utils";

/**
 * Display name for a collection. The built-in Watch Later stores an English
 * placeholder name, so its label comes from the catalog and follows the UI
 * language like every other built-in string.
 */
function collectionLabel(collection: UserCollection, t: TFunc): string {
  return collection.id === WATCH_LATER_ID
    ? t("watchLater.name")
    : collection.name;
}

/**
 * Header widths (CSS px, so they hold at any zoom) below which the toolbar
 * folds into its "more" menu, so that it, the search box and the window
 * buttons still fit the title bar: first the page links, then the view
 * controls too. The full toolbar is about 450px, the search box at least
 * 160px.
 */
const FOLD_PAGES_BELOW = 760;
const FOLD_VIEWS_BELOW = 560;

/**
 * An element's width, followed as it changes; Infinity until measured. Takes
 * the element through the returned callback ref: the header mounts only once
 * the title bar's slot exists, after the first render.
 */
function useWidth(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [width, setEl];
}

export function HomeHeader({
  root,
  rootFetched,
  collection,
  onEditCollection,
  workspace,
  onEditWorkspace,
  view,
  onSetView,
  folderView,
  onToggleByFolder,
  folderAvailable,
  scanning,
  ready,
  onScan,
  onScanWithDeleted,
  onRebuild,
  search,
  t,
}: {
  root: string | null | undefined;
  rootFetched: boolean;
  /** The active user collection, when one is selected (null for a normal workspace). */
  collection: UserCollection | null;
  onEditCollection: () => void;
  /** The active real workspace, when one is selected (null for a collection or "All"). */
  workspace: WorkspaceInfo | null;
  onEditWorkspace: () => void;
  view: ViewMode;
  onSetView: (v: ViewMode) => void;
  /** The file view is drawn by folder (see isFolderView). */
  folderView: boolean;
  onToggleByFolder: () => void;
  /** Folders need one real workspace open (not All or a collection). */
  folderAvailable: boolean;
  scanning: boolean;
  ready: boolean;
  onScan: () => void;
  onScanWithDeleted: () => void;
  onRebuild: () => void;
  /** The list's search box, drawn in the middle of the bar. */
  search?: ReactNode;
  t: TFunc;
}) {
  // In the title bar's slot, beside the logo (TitleBar.tsx): what is not a
  // control here moves the window. The two sides share the room left over,
  // so the search box between them sits about the middle; the path has a
  // base width of its own, so that the search box gives way to it too.
  const [width, headerRef] = useWidth();
  const foldPages = width < FOLD_PAGES_BELOW;
  const foldViews = width < FOLD_VIEWS_BELOW;
  const pages = [
    { to: "/history", label: t("history.title"), Icon: History },
    { to: "/duplicates", label: t("duplicates.title"), Icon: CopyCheck },
    { to: "/tags", label: t("tags.title"), Icon: TagsIcon },
    { to: "/auto-tag", label: t("autoTag.title"), Icon: Sparkles },
  ];
  const views = [
    { mode: "grid", label: t("view.grid"), Icon: LayoutGrid },
    { mode: "list", label: t("view.list"), Icon: List },
    { mode: "timeline", label: t("view.timeline"), Icon: CalendarRange },
    { mode: "graph", label: t("view.graph"), Icon: Waypoints },
  ] as const;
  const folderDisabled = !folderAvailable || !hasFolderForm(view);
  const folderTitle =
    view === "graph"
      ? t("view.folderUnavailableGraph")
      : view === "timeline"
        ? t("view.folderUnavailableTimeline")
        : folderAvailable
          ? t("view.folder")
          : t("view.folderUnavailable");
  return (
    <TitleBarPortal>
      <header
        ref={headerRef}
        data-slot="home-header"
        className="flex min-w-0 flex-1 items-center gap-3 pr-2"
      >
        <div className="flex min-w-0 flex-[1_1_120px] items-center">
          {collection ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg">
              {collection.emoji ? (
                <span className="shrink-0 leading-none">
                  {collection.emoji}
                </span>
              ) : (
                <FolderOpen className="size-3.5 shrink-0" />
              )}
              <span
                className="truncate font-medium"
                title={collectionLabel(collection, t)}
              >
                {collectionLabel(collection, t)}
              </span>
              {/* Built-in collections can't be renamed or re-iconed, so no pencil.
              The main process rejects those edits anyway; offering the dialog
              here would look like it worked and then silently revert. */}
              {!collection.locked && (
                <button
                  type="button"
                  onClick={onEditCollection}
                  aria-label={t("collection.edit")}
                  title={t("collection.edit")}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-fg"
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              {workspace?.emoji ? (
                <span className="shrink-0 leading-none">{workspace.emoji}</span>
              ) : (
                <FolderOpen className="size-3.5 shrink-0" />
              )}
              <span className="truncate" title={root ?? undefined}>
                {root ?? (rootFetched ? t("home.noDirectory") : "…")}
              </span>
              {workspace && (
                <button
                  type="button"
                  onClick={onEditWorkspace}
                  aria-label={t("workspace.edit")}
                  title={t("workspace.edit")}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-fg"
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </span>
          )}
        </div>
        {search && (
          // The box grows downward as it wraps search terms, over the list
          // rather than pushing the bar taller. All of it takes its clicks
          // rather than moving the window (data-title-bar-control).
          <div
            data-title-bar-control=""
            className="relative h-8 min-w-40 flex-[0_1_480px]"
          >
            <div className="absolute inset-x-0 top-0 z-30">{search}</div>
          </div>
        )}
        <div className="flex flex-1 items-center justify-end gap-2">
          {foldPages ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={t("home.moreTools")}
                  aria-label={t("home.moreTools")}
                  className="flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {foldViews && (
                  <>
                    <DropdownMenuGroup>
                      {views.map(({ mode, label, Icon }) => (
                        <DropdownMenuItem
                          key={mode}
                          role="menuitemradio"
                          aria-checked={view === mode}
                          onSelect={() => onSetView(mode)}
                        >
                          <Icon />
                          <span className="flex-1">{label}</span>
                          {view === mode && <Check />}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem
                        role="menuitemcheckbox"
                        aria-checked={folderView}
                        disabled={folderDisabled}
                        onSelect={onToggleByFolder}
                      >
                        <FolderTree />
                        {/* A disabled item takes no hover, so the reason
                            a tooltip gives on the button is written out. */}
                        <span className="flex flex-1 flex-col">
                          {t("view.folder")}
                          {folderDisabled && (
                            <span className="text-xs text-muted">
                              {folderTitle}
                            </span>
                          )}
                        </span>
                        {folderView && <Check />}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  {pages.map(({ to, label, Icon }) => (
                    <DropdownMenuItem key={to} asChild>
                      <Link to={to}>
                        <Icon />
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            pages.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                title={label}
                aria-label={label}
                className="flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg"
              >
                <Icon className="size-4" />
              </Link>
            ))
          )}
          {!foldViews && (
            <>
              <div
                data-tour="view-mode"
                className="flex items-center rounded-md border border-border"
              >
                {views.map(({ mode, label, Icon }, i) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onSetView(mode)}
                    aria-label={label}
                    aria-pressed={view === mode}
                    title={label}
                    className={cn(
                      "flex size-7 items-center justify-center transition",
                      i === 0 && "rounded-l-md",
                      i === views.length - 1 && "rounded-r-md",
                      view === mode
                        ? "bg-primary/20 text-fg"
                        : "text-muted hover:bg-fg/10 hover:text-fg",
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
              {/* Applies to the grid and the list alike. Disabled over All or a
            collection, where there are no folders to show; the stored choice
            is kept for the next workspace. */}
              <button
                type="button"
                onClick={onToggleByFolder}
                aria-label={t("view.folder")}
                aria-pressed={folderView}
                disabled={folderDisabled}
                title={folderTitle}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border border-border transition disabled:cursor-not-allowed disabled:opacity-40",
                  folderView
                    ? "bg-primary/20 text-fg"
                    : "text-muted hover:bg-fg/10 hover:text-fg",
                )}
              >
                <FolderTree className="size-4" />
              </button>
            </>
          )}
          <ButtonGroup className="[&>button]:border [&>button]:border-muted/35 [&>button]:bg-surface [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-[1]">
            <Button
              size="sm"
              variant="outline"
              className="border border-muted/35 bg-surface"
              onClick={onScan}
              disabled={scanning || !ready}
            >
              <RefreshCw className={scanning ? "animate-spin" : ""} />
              {t("home.scan")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border border-muted/35 bg-surface px-2"
                  disabled={scanning || !ready}
                  aria-label={t("home.scan")}
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-56 border border-muted/35 bg-surface p-0"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="rounded-none px-3 py-2 text-xs"
                    onSelect={onScanWithDeleted}
                  >
                    <RefreshCw />
                    {t("home.scanWithDeleted")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
                  <DropdownMenuItem
                    className="rounded-none px-3 py-2 text-xs"
                    onSelect={onRebuild}
                  >
                    <DatabaseBackup />
                    {t("home.rebuildIndex")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
                  <DropdownMenuItem
                    asChild
                    className="rounded-none px-3 py-2 text-xs"
                  >
                    <Link to="/missing">
                      <FileX />
                      {t("missing.title")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
          <ThemeToggle />
        </div>
      </header>
    </TitleBarPortal>
  );
}
