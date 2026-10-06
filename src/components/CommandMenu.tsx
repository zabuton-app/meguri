import { useMemo, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  Clock,
  Copy,
  DatabaseBackup,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Grid3X3,
  Heart,
  HelpCircle,
  History,
  List,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Tags as TagsIcon,
  Terminal,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { defaultFilter } from "cmdk";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useSelection } from "@/components/SelectionContext";
import {
  useCollectionMembership,
  useFileActions,
  type FileActions,
} from "@/hooks/useFileActions";
import { getFocusedFile } from "@/hooks/useFocusedFile";
import {
  clearRecentSearches,
  useRecentSearches,
} from "@/hooks/useRecentSearches";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import type { FileRow, SearchQuery } from "@/ipc/types";
import { fileNameOf } from "@/lib/relPath";
import { recentSearchKey } from "@/lib/recentSearches";
import { describeConditions } from "@/lib/searchConditions";
import {
  describeSearchQuery,
  type SmartCollection,
} from "@/lib/smartCollections";
import type { ViewMode } from "@/routes/Home/utils";
import { MAX_BULK_FILES } from "@shared/tags";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
  scanning: boolean;
  devToolsEnabled: boolean;
  onFocusSearch: () => void;
  onScan: (includeExcluded?: boolean) => void;
  onRebuild: () => void;
  onSetView: (view: ViewMode) => void;
  /** Turns the "show by folder" option on or off. */
  onToggleByFolder: () => void;
  /** Whether the file view is shown by folder, which the command undoes. */
  folderView?: boolean;
  /** Folders need one real workspace open (not All or a collection). */
  folderAvailable?: boolean;
  /** Shows or hides the heatmap panel over the list. */
  onToggleHeatmap: () => void;
  /** Whether the heatmap panel is shown, which the command undoes. */
  heatmapOpen?: boolean;
  onDiscover: () => void;
  /** Discovery has something to pick from (the same rule as its button). */
  canDiscover?: boolean;
  onTags: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onOpenDevTools: () => void;
  /** Applies a recent search's conditions (the folder shown stays). */
  onApplySearch: (query: SearchQuery) => void;
  /** Applies a saved search, the way the filter bar's dropdown does. */
  onApplySaved: (collection: SmartCollection) => void;
  /** Sets the full-text query to what was typed. */
  onQuickSearch: (text: string) => void;
  /**
   * The list is what is on screen. Every other screen sits over it (the
   * detail view, the player, Discovery, History, …), and the list's focus
   * then names a file out of sight — not the one the detail view shows, which
   * the list does not follow — so the menu offers no file actions there
   * rather than act on a file other than the one the user is looking at.
   */
  fileActionsAvailable?: boolean;
}

interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/** A sub-page the file actions open: picking a rating or a collection. */
type Page = "rating" | "collections" | null;

/** Recent searches and saved searches show this many until the user types. */
export const COMMAND_GROUP_CAP = 5;

const NO_FILES: FileRow[] = [];

/**
 * cmdk tracks the highlighted row by its value, so two rows sharing one (two
 * collections or saved searches with the same name, two recent searches
 * whose chips read alike) would highlight together and trap the arrow keys.
 * Rows that can repeat therefore take a unique id as their value and carry
 * their text as keywords, and a row with keywords is matched on them alone,
 * so the id never matches what the user types.
 */
function matchKeywords(value: string, search: string, keywords?: string[]) {
  return keywords?.length
    ? defaultFilter(keywords.join(" "), search)
    : defaultFilter(value, search);
}

function shortcutMeta(): string {
  return navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl+K";
}

function shortcutDevTools(): string {
  return navigator.platform.toLowerCase().includes("mac")
    ? "⌘⇧I"
    : "Ctrl+Shift+I";
}

function action(
  t: TFunc,
  key: TranslationKey,
  props: Omit<CommandAction, "label">,
): CommandAction {
  return { ...props, label: t(key) };
}

export function CommandMenu(props: CommandMenuProps) {
  const { open, onOpenChange } = props;
  const { t } = useI18n();
  const [page, setPage] = useState<Page>(null);
  // The focused file is taken as the menu opens and kept until it closes:
  // the focus follows a position in the list, and a list refetched while the
  // menu is up (a scan landing) could put another file there.
  const [focused, setFocused] = useState(() =>
    open ? getFocusedFile() : null,
  );
  // A menu closed from a sub-page opens again at the top.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setPage(null);
    setFocused(open ? getFocusedFile() : null);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("command.title")}
      description={t("command.placeholder")}
      className="max-w-xl border-muted/35 bg-bg shadow-2xl"
      onEscapeKeyDown={(e) => {
        // Esc on a sub-page steps back rather than closing the menu.
        if (page) {
          e.preventDefault();
          setPage(null);
        }
      }}
    >
      {/* The body mounts only while the dialog is open, so the selection,
          recent and saved searches are read when the menu opens rather than
          on every change behind it. Keyed by page so a page starts with an
          empty field and the first row highlighted. */}
      <CommandMenuBody
        key={page ?? "root"}
        {...props}
        focused={focused}
        page={page}
        setPage={setPage}
      />
    </CommandDialog>
  );
}

/**
 * What the file actions act on: the selection while one is being built, and
 * otherwise the file focused when the menu opened. A selection whose folders
 * are still being fetched, or that is past the bulk cap, offers nothing — the
 * same rule as the selection bar.
 */
function useCommandTargets(
  focused: FileRow | null,
  available: boolean,
): FileRow[] {
  const { active, count, pending, rows } = useSelection();
  return useMemo(() => {
    if (!available) return NO_FILES;
    if (active && count > 0) {
      return pending || count > MAX_BULK_FILES ? NO_FILES : rows;
    }
    return focused ? [focused] : NO_FILES;
  }, [available, active, count, pending, rows, focused]);
}

function CommandMenuBody({
  onOpenChange,
  ready,
  scanning,
  devToolsEnabled,
  onFocusSearch,
  onScan,
  onRebuild,
  onSetView,
  onToggleByFolder,
  folderView = false,
  folderAvailable = false,
  onToggleHeatmap,
  heatmapOpen = false,
  onDiscover,
  canDiscover = ready,
  onTags,
  onSettings,
  onHelp,
  onOpenDevTools,
  onApplySearch,
  onApplySaved,
  onQuickSearch,
  fileActionsAvailable = true,
  focused,
  page,
  setPage,
}: CommandMenuProps & {
  focused: FileRow | null;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const targets = useCommandTargets(focused, fileActionsAvailable);
  const watchLater = useWatchLater();
  const files = useFileActions(targets, watchLater);
  const closeThen = (fn: () => void) => {
    onOpenChange(false);
    window.setTimeout(fn, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!page) return;
    if (e.key === "Backspace" && search === "") {
      e.preventDefault();
      setPage(null);
      return;
    }
    // A digit picks the rating outright.
    if (
      page === "rating" &&
      /^[0-5]$/.test(e.key) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      const rating = Number(e.key);
      closeThen(() => files.setRating(rating));
    }
  };

  const badge =
    page === "rating"
      ? t("command.pageRating")
      : page === "collections"
        ? t("command.pageCollections")
        : null;
  const placeholder =
    page === "rating"
      ? t("command.ratingPlaceholder")
      : page === "collections"
        ? t("command.collectionPlaceholder")
        : t("command.placeholder");

  return (
    <Command onKeyDown={onKeyDown} filter={matchKeywords}>
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
        badge={
          badge &&
          (targets.length > 1
            ? `${badge} (${t("command.selectedFiles", { count: targets.length })})`
            : badge)
        }
      />
      <CommandList>
        {/* Not while the quick search row is up: cmdk does not count a
            force-mounted row, and would call a menu holding one empty. */}
        {(page !== null || typed === "") && (
          <CommandEmpty>{t("command.empty")}</CommandEmpty>
        )}
        {page === "rating" ? (
          <RatingPage t={t} files={files} closeThen={closeThen} />
        ) : page === "collections" ? (
          <CollectionsPage
            t={t}
            typing={typed !== ""}
            targets={targets}
            files={files}
            closeThen={closeThen}
          />
        ) : (
          <>
            {targets.length > 0 && (
              <FileActionsGroup
                t={t}
                targets={targets}
                files={files}
                closeThen={closeThen}
                openPage={setPage}
              />
            )}
            <RecentSearchesGroup
              t={t}
              typing={typed !== ""}
              onApply={(query) => closeThen(() => onApplySearch(query))}
            />
            <SmartCollectionsGroup
              t={t}
              typing={typed !== ""}
              onApply={(c) => closeThen(() => onApplySaved(c))}
            />
            <FixedGroups
              t={t}
              ready={ready}
              scanning={scanning}
              devToolsEnabled={devToolsEnabled}
              folderView={folderView}
              folderAvailable={folderAvailable}
              heatmapOpen={heatmapOpen}
              canDiscover={canDiscover}
              closeThen={closeThen}
              onFocusSearch={onFocusSearch}
              onScan={onScan}
              onRebuild={onRebuild}
              onSetView={onSetView}
              onToggleByFolder={onToggleByFolder}
              onToggleHeatmap={onToggleHeatmap}
              onDiscover={onDiscover}
              onTags={onTags}
              onSettings={onSettings}
              onHelp={onHelp}
              onOpenDevTools={onOpenDevTools}
            />
            {typed !== "" && (
              // Always offered, and always last: whatever else matched, the
              // text can still be searched for as typed.
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`search-for ${typed}`}
                  onSelect={() => closeThen(() => onQuickSearch(typed))}
                >
                  <Search />
                  <span className="truncate">
                    {t("command.searchFor", { q: typed })}
                  </span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-xs text-muted">
        {t("command.shortcutHint", { shortcut: shortcutMeta() })}
      </div>
    </Command>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-xs tracking-wider text-warn" aria-hidden>
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

/** A row with a second line under its label. */
function Label({ text, sub }: { text: string; sub?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{text}</span>
      {sub != null && (
        <span className="truncate text-xs text-muted">{sub}</span>
      )}
    </span>
  );
}

function FileActionsGroup({
  t,
  targets,
  files,
  closeThen,
  openPage,
}: {
  t: TFunc;
  targets: FileRow[];
  files: FileActions;
  closeThen: (fn: () => void) => void;
  openPage: (page: Page) => void;
}) {
  const single = files.single;
  const name =
    targets.length === 1
      ? fileNameOf(targets[0].relPath)
      : t("command.selectedFiles", { count: targets.length });
  const favoriteLabel =
    files.favorite === "all" ? t("favorite.remove") : t("favorite.add");
  const watchLaterLabel =
    files.watchLater === "all" ? t("watchLater.remove") : t("watchLater.add");
  const ratingLabel = t("command.rating");
  const collectionsLabel = t("command.collections");
  const { toggleFavorite, toggleWatchLater } = files;

  return (
    <>
      <CommandGroup
        heading={
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">{t("command.groupFile")}</span>
            <span className="truncate text-fg" data-testid="command-file-name">
              {name}
            </span>
          </span>
        }
      >
        <CommandItem
          value={favoriteLabel}
          onSelect={() => closeThen(toggleFavorite)}
        >
          <Heart />
          <span>{favoriteLabel}</span>
        </CommandItem>
        <CommandItem
          value={watchLaterLabel}
          disabled={!toggleWatchLater}
          onSelect={() => toggleWatchLater && closeThen(toggleWatchLater)}
        >
          <Clock />
          <span>{watchLaterLabel}</span>
        </CommandItem>
        <CommandItem value={ratingLabel} onSelect={() => openPage("rating")}>
          <Star />
          <Label
            text={ratingLabel}
            sub={
              files.rating == null ? (
                t("command.ratingMixed")
              ) : (
                <Stars rating={files.rating} />
              )
            }
          />
          <ChevronRight className="text-muted" />
        </CommandItem>
        <CommandItem
          value={collectionsLabel}
          onSelect={() => openPage("collections")}
        >
          <FolderPlus />
          <span className="flex-1">{collectionsLabel}</span>
          <ChevronRight className="text-muted" />
        </CommandItem>
        {single && (
          <>
            <CommandItem
              value={t("media.openFolder")}
              onSelect={() => closeThen(single.openFolder)}
            >
              <FolderOpen />
              <span>{t("media.openFolder")}</span>
            </CommandItem>
            <CommandItem
              value={t("media.copyFilePath")}
              onSelect={() => closeThen(single.copyPath)}
            >
              <Copy />
              <span>{t("media.copyFilePath")}</span>
            </CommandItem>
            <CommandItem
              value={t("media.deleteFromIndex")}
              className="text-error data-[selected=true]:text-error"
              onSelect={() => closeThen(() => void single.deleteFromIndex())}
            >
              <Trash2 />
              <span>{t("media.deleteFromIndex")}</span>
            </CommandItem>
          </>
        )}
      </CommandGroup>
      <CommandSeparator />
    </>
  );
}

function RatingPage({
  t,
  files,
  closeThen,
}: {
  t: TFunc;
  files: FileActions;
  closeThen: (fn: () => void) => void;
}) {
  return (
    <CommandGroup heading={t("command.pageRating")}>
      {[5, 4, 3, 2, 1, 0].map((n) => {
        const label =
          n === 0
            ? t("command.ratingNone")
            : t("command.ratingStars", { rating: n });
        return (
          <CommandItem
            key={n}
            value={label}
            onSelect={() => closeThen(() => files.setRating(n))}
          >
            <Star />
            <Label
              text={label}
              sub={n > 0 ? <Stars rating={n} /> : undefined}
            />
            {files.rating === n && (
              <span className="text-xs text-primary">
                {t("command.current")}
              </span>
            )}
            <CommandShortcut>{n}</CommandShortcut>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function CollectionsPage({
  t,
  typing,
  targets,
  files,
  closeThen,
}: {
  t: TFunc;
  typing: boolean;
  targets: FileRow[];
  files: FileActions;
  closeThen: (fn: () => void) => void;
}) {
  const collections = useCollectionMembership(targets);
  const { shown, hidden } = capped(collections, typing);
  return (
    <CommandGroup heading={t("command.pageCollections")}>
      {shown.map((c) => (
        <CommandItem
          key={c.id}
          value={`collection:${c.id}`}
          keywords={[c.name]}
          onSelect={() => closeThen(() => files.toggleCollection(c))}
        >
          {c.emoji ? (
            <span className="w-4 shrink-0 text-center" aria-hidden>
              {c.emoji}
            </span>
          ) : (
            <FolderPlus />
          )}
          <Label
            text={c.name}
            sub={
              c.included === "all"
                ? t("command.inCollection")
                : c.included === "some"
                  ? t("command.inCollectionSome")
                  : undefined
            }
          />
        </CommandItem>
      ))}
      <MoreHint t={t} count={hidden} />
    </CommandGroup>
  );
}

/** Until the user types, a long group shows its first few and says how many more. */
function capped<T>(
  items: T[],
  typing: boolean,
): { shown: T[]; hidden: number } {
  if (typing || items.length <= COMMAND_GROUP_CAP) {
    return { shown: items, hidden: 0 };
  }
  return {
    shown: items.slice(0, COMMAND_GROUP_CAP),
    hidden: items.length - COMMAND_GROUP_CAP,
  };
}

function MoreHint({ t, count }: { t: TFunc; count: number }) {
  if (count === 0) return null;
  return (
    <div className="px-2 pb-1.5 pl-8 text-xs text-muted">
      {t("command.more", { count })}
    </div>
  );
}

function RecentSearchesGroup({
  t,
  typing,
  onApply,
}: {
  t: TFunc;
  typing: boolean;
  onApply: (query: SearchQuery) => void;
}) {
  const recent = useRecentSearches();
  const entries = useMemo(
    () =>
      recent.map((query) => {
        const labels = describeConditions(query, t)
          .filter((c) => c.chip)
          .map((c) => c.label);
        return {
          query,
          key: recentSearchKey(query),
          // A search narrowed only by something without a chip of its own
          // still needs something to show and to match.
          chips: labels.length ? labels : [describeSearchQuery(t, query)],
        };
      }),
    [recent, t],
  );
  if (entries.length === 0) return null;
  const { shown, hidden } = capped(entries, typing);
  const clearLabel = t("command.clearRecent");

  return (
    <>
      <CommandGroup heading={t("command.groupRecent")}>
        {shown.map(({ query, key, chips }) => (
          <CommandItem
            key={key}
            value={`recent:${key}`}
            keywords={chips}
            onSelect={() => onApply(query)}
          >
            <History />
            <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {chips.map((label, i) => (
                <span
                  key={i}
                  className="shrink-0 whitespace-nowrap rounded-full bg-overlay px-2 py-0.5 text-xs text-fg"
                >
                  {label}
                </span>
              ))}
            </span>
          </CommandItem>
        ))}
        <MoreHint t={t} count={hidden} />
        <CommandItem value={clearLabel} onSelect={clearRecentSearches}>
          <X />
          <span>{clearLabel}</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
    </>
  );
}

function SmartCollectionsGroup({
  t,
  typing,
  onApply,
}: {
  t: TFunc;
  typing: boolean;
  onApply: (collection: SmartCollection) => void;
}) {
  // Read when the menu opens: the dropdown keeps its own copy, and saving
  // there while the menu is closed is the only way the list changes.
  const { collections } = useSmartCollections();
  if (collections.length === 0) return null;
  const { shown, hidden } = capped(collections, typing);

  return (
    <>
      <CommandGroup heading={t("smartCollection.title")}>
        {shown.map((c) => {
          const summary = describeSearchQuery(t, c.query);
          return (
            <CommandItem
              key={c.id}
              value={`saved:${c.id}`}
              keywords={[c.name, summary]}
              onSelect={() => onApply(c)}
            >
              <Bookmark />
              <Label text={c.name} sub={summary} />
            </CommandItem>
          );
        })}
        <MoreHint t={t} count={hidden} />
      </CommandGroup>
      <CommandSeparator />
    </>
  );
}

function FixedGroups({
  t,
  ready,
  scanning,
  devToolsEnabled,
  folderView,
  folderAvailable,
  heatmapOpen,
  canDiscover,
  closeThen,
  onFocusSearch,
  onScan,
  onRebuild,
  onSetView,
  onToggleByFolder,
  onToggleHeatmap,
  onDiscover,
  onTags,
  onSettings,
  onHelp,
  onOpenDevTools,
}: {
  t: TFunc;
  ready: boolean;
  scanning: boolean;
  devToolsEnabled: boolean;
  folderView: boolean;
  folderAvailable: boolean;
  heatmapOpen: boolean;
  canDiscover: boolean;
  closeThen: (fn: () => void) => void;
  onFocusSearch: () => void;
  onScan: (includeExcluded?: boolean) => void;
  onRebuild: () => void;
  onSetView: (view: ViewMode) => void;
  onToggleByFolder: () => void;
  onToggleHeatmap: () => void;
  onDiscover: () => void;
  onTags: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onOpenDevTools: () => void;
}) {
  const navigation: CommandAction[] = [
    action(t, "command.focusSearch", {
      id: "focus-search",
      icon: Search,
      shortcut: "/",
      run: () => closeThen(onFocusSearch),
    }),
    action(t, "discover.title", {
      id: "discover",
      icon: Sparkles,
      disabled: !canDiscover,
      run: () => closeThen(onDiscover),
    }),
    action(t, "tags.title", {
      id: "tags",
      icon: TagsIcon,
      disabled: !ready,
      run: () => closeThen(onTags),
    }),
    action(t, "settings.title", {
      id: "settings",
      icon: Settings,
      run: () => closeThen(onSettings),
    }),
    action(t, "shortcuts.title", {
      id: "help",
      icon: HelpCircle,
      shortcut: "?",
      run: () => closeThen(onHelp),
    }),
  ];
  if (devToolsEnabled) {
    navigation.push(
      action(t, "command.openDevTools", {
        id: "open-devtools",
        icon: Terminal,
        shortcut: shortcutDevTools(),
        run: () => closeThen(onOpenDevTools),
      }),
    );
  }

  const workspace = [
    action(t, "home.scan", {
      id: "scan",
      icon: RefreshCw,
      disabled: scanning || !ready,
      run: () => closeThen(() => onScan()),
    }),
    action(t, "home.scanWithDeleted", {
      id: "resync",
      icon: RefreshCw,
      disabled: scanning || !ready,
      run: () => closeThen(() => onScan(true)),
    }),
    action(t, "home.rebuildIndex", {
      id: "rebuild",
      icon: DatabaseBackup,
      disabled: scanning || !ready,
      run: () => closeThen(onRebuild),
    }),
  ];

  const view = [
    action(t, "view.grid", {
      id: "view-grid",
      icon: Grid3X3,
      run: () => closeThen(() => onSetView("grid")),
    }),
    action(t, "view.list", {
      id: "view-list",
      icon: List,
      run: () => closeThen(() => onSetView("list")),
    }),
    action(t, "view.timeline", {
      id: "view-timeline",
      icon: CalendarRange,
      run: () => closeThen(() => onSetView("timeline")),
    }),
    action(t, "view.graph", {
      id: "view-graph",
      icon: Waypoints,
      run: () => closeThen(() => onSetView("graph")),
    }),
    // A toggle, unlike the view actions above it: named for what it will do.
    action(t, folderView ? "view.folderOff" : "view.folder", {
      id: "view-folder",
      icon: FolderTree,
      disabled: !folderAvailable,
      run: () => closeThen(onToggleByFolder),
    }),
    // A panel over the list in any view, toggled like the folder option.
    action(t, heatmapOpen ? "view.heatmapOff" : "view.heatmap", {
      id: "view-heatmap",
      icon: CalendarDays,
      run: () => closeThen(onToggleHeatmap),
    }),
  ];

  return (
    <>
      <CommandActionGroup
        heading={t("command.groupNavigation")}
        actions={navigation}
      />
      <CommandSeparator />
      <CommandActionGroup
        heading={t("command.groupWorkspace")}
        actions={workspace}
      />
      <CommandSeparator />
      <CommandActionGroup heading={t("command.groupView")} actions={view} />
    </>
  );
}

function CommandActionGroup({
  heading,
  actions,
}: {
  heading: string;
  actions: CommandAction[];
}) {
  return (
    <CommandGroup heading={heading}>
      {actions.map(({ id, label, shortcut, disabled, icon: Icon, run }) => (
        <CommandItem key={id} value={label} disabled={disabled} onSelect={run}>
          <Icon />
          <span>{label}</span>
          {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
