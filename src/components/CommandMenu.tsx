import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  Clock,
  Copy,
  CopyCheck,
  DatabaseBackup,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Grid3X3,
  Heart,
  HelpCircle,
  History,
  Info,
  Layers,
  List,
  Moon,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  Tag,
  Tags as TagsIcon,
  Terminal,
  Trash2,
  Wand2,
  Waypoints,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { TagSuggestionLabel } from "@/components/TagSuggestionLabel";
import { useActivateFile } from "@/audio/useActivateFile";
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
import { useTagCompletions } from "@/hooks/useTagCompletions";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useI18n, type Lang, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { api, ALL_ID, collectionTarget } from "@/ipc/client";
import type { FileRow, SearchQuery } from "@/ipc/types";
import { fileNameOf } from "@/lib/relPath";
import { recentSearchKey } from "@/lib/recentSearches";
import { clearAllTarget, describeConditions } from "@/lib/searchConditions";
import { invalidateWorkspaceScoped } from "@/lib/workspaceScope";
import {
  describeSearchQuery,
  type SmartCollection,
} from "@/lib/smartCollections";
import type { ViewMode } from "@/routes/Home/utils";
import { formatChords, GRID_BINDINGS } from "@/settings/keybindings";
import { usePreferences } from "@/settings/PreferencesProvider";
import { useTheme } from "@/themes/ThemeProvider";
import {
  MAX_BULK_FILES,
  TAG_SEARCH_PREFIX,
  tagSearchToken,
} from "@shared/tags";
import { WATCH_LATER_ID } from "@shared/workspaceIds";

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
  onHistory: () => void;
  onDuplicates: () => void;
  onAutoTag: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onOpenDevTools: () => void;
  /** Applies a recent search's conditions (the folder shown stays). */
  onApplySearch: (query: SearchQuery) => void;
  /** Applies a saved search, the way the filter bar's dropdown does. */
  onApplySaved: (collection: SmartCollection) => void;
  /** Sets the full-text query to what was typed. */
  onQuickSearch: (text: string) => void;
  /** Adds a search token (`tag:beach`) to the search, as clicking a tag does. */
  onAddSearchToken: (token: string) => void;
  /** The conditions on screen, which "Clear all filters" resets. */
  filter: SearchQuery;
  onFilterChange: (query: SearchQuery) => void;
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

/**
 * A sub-page: picking a rating or a collection for the file actions, the
 * candidates for a prefix typed at the root (`tag:`, `ws:`, `col:`), or the
 * search to run in the workspace or collection picked from the last two.
 */
type Page = "rating" | "collections" | PrefixPage | "searchIn" | null;

type PrefixPage = "tag" | "ws" | "col";

/**
 * The page a prefix at the very start of the text opens, and what follows it.
 * Any other text, an unknown prefix included, stays a search of the menu.
 */
function prefixPage(text: string): { page: PrefixPage; rest: string } | null {
  const m = /^(tag|ws|col):/i.exec(text);
  if (!m) return null;
  return {
    page: m[1].toLowerCase() as PrefixPage,
    rest: text.slice(m[0].length),
  };
}

/**
 * The page shown and the text its field starts with: what followed a prefix.
 * The search-in page also carries the workspace or collection it searches in.
 */
type PageState =
  | { page: Exclude<Page, "searchIn">; initialSearch: string }
  | { page: "searchIn"; initialSearch: string; item: SwitchItem };

const ROOT_PAGE: PageState = { page: null, initialSearch: "" };

/** Where Esc, or Backspace on an empty field, steps back to. */
function parentPage(state: PageState): PageState {
  return state.page === "searchIn"
    ? { page: state.item.kind, initialSearch: "" }
    : ROOT_PAGE;
}

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
  const { open, onOpenChange, onQuickSearch } = props;
  const { t } = useI18n();
  const { refresh } = useSelection();
  const qc = useQueryClient();
  const [pageState, setPageState] = useState<PageState>(ROOT_PAGE);
  const { page } = pageState;
  // The tag dialog and the workspace switch outlive the menu, which closes
  // as they start.
  const [tagRows, setTagRows] = useState<FileRow[] | null>(null);
  // As the rail's switch does.
  const switchTo = useMutation({
    mutationFn: (id: string) => api.workspaceSwitch(id),
    onSuccess: () => invalidateWorkspaceScoped(qc),
  });
  const openIn = (item: SwitchItem, text: string) => {
    // The search first, while the filter still belongs to the view it was
    // set in: set after the switch, it would carry the old view's folder into
    // the new one. It replaces the text, as "Search for" does.
    if (text) onQuickSearch(text);
    if (!item.active) switchTo.mutate(item.switchId);
    // Back to the list even when nothing switches: the menu may have been
    // opened over another screen.
    if (window.location.hash !== "#/") window.location.hash = "/";
  };
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
    if (!open) setPageState(ROOT_PAGE);
    setFocused(open ? getFocusedFile() : null);
  }

  return (
    <>
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
            setPageState(parentPage(pageState));
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
          pageState={pageState}
          setPageState={setPageState}
          onEditTags={setTagRows}
          onOpenIn={openIn}
        />
      </CommandDialog>
      {/* Mounted only while open so each pass starts from a clean staged edit,
        as the selection layer's does. */}
      {tagRows && (
        <BulkTagDialog
          open
          onOpenChange={(next) => {
            if (!next) setTagRows(null);
          }}
          rows={tagRows}
          onApplied={refresh}
        />
      )}
    </>
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
  onHistory,
  onDuplicates,
  onAutoTag,
  onSettings,
  onHelp,
  onOpenDevTools,
  onApplySearch,
  onApplySaved,
  onQuickSearch,
  onAddSearchToken,
  filter,
  onFilterChange,
  fileActionsAvailable = true,
  focused,
  pageState,
  setPageState,
  onEditTags,
  onOpenIn,
}: CommandMenuProps & {
  focused: FileRow | null;
  pageState: PageState;
  setPageState: (state: PageState) => void;
  onEditTags: (rows: FileRow[]) => void;
  onOpenIn: (item: SwitchItem, text: string) => void;
}) {
  const { t, lang } = useI18n();
  const { page } = pageState;
  const searchIn = pageState.page === "searchIn" ? pageState.item : null;
  const setPage = (next: Exclude<Page, "searchIn">, search = "") =>
    setPageState({ page: next, initialSearch: search });
  const [search, setSearch] = useState(pageState.initialSearch);
  const inputRef = useRef<HTMLInputElement>(null);
  // The body remounts for each page, taking the field the user was typing in
  // with it: give focus back to the new one (the root's too, on the way
  // back), caret after what carried over. On opening, the dialog focuses the
  // same field anyway.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
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
      setPageState(parentPage(pageState));
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

  const onSearchChange = (value: string) => {
    const prefix = page === null ? prefixPage(value) : null;
    if (prefix) setPage(prefix.page, prefix.rest);
    else setSearch(value);
  };

  const filePageBadge =
    page === "rating"
      ? t("command.pageRating")
      : page === "collections"
        ? t("command.pageCollections")
        : null;
  // A prefix page shows the prefix itself: it is what was typed to get there.
  const badge =
    page === "tag" || page === "ws" || page === "col"
      ? `${page}:`
      : searchIn
        ? `${searchIn.kind}:${searchIn.name}`
        : filePageBadge &&
          (targets.length > 1
            ? `${filePageBadge} (${t("command.selectedFiles", { count: targets.length })})`
            : filePageBadge);
  const placeholder =
    page === "rating"
      ? t("command.ratingPlaceholder")
      : page === "collections"
        ? t("command.collectionPlaceholder")
        : page === "tag"
          ? t("command.tagPlaceholder")
          : page === "ws"
            ? t("command.workspacePlaceholder")
            : page === "col"
              ? t("command.collectionOpenPlaceholder")
              : searchIn
                ? t("command.searchInPlaceholder", { name: searchIn.name })
                : t("command.placeholder");

  return (
    <Command
      onKeyDown={onKeyDown}
      filter={matchKeywords}
      // The tag page is ranked by the search box's own matcher; the
      // search-in page's one row is whatever was typed.
      shouldFilter={page !== "tag" && page !== "searchIn"}
    >
      <CommandInput
        ref={inputRef}
        placeholder={placeholder}
        value={search}
        onValueChange={onSearchChange}
        badge={badge}
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
        ) : page === "tag" ? (
          <TagPage
            t={t}
            search={search}
            onPick={(token) => closeThen(() => onAddSearchToken(token))}
            onSearch={(text) => closeThen(() => onQuickSearch(text))}
          />
        ) : page === "ws" || page === "col" ? (
          <SwitchPage
            t={t}
            kind={page}
            onPick={(item) =>
              setPageState({ page: "searchIn", initialSearch: "", item })
            }
          />
        ) : searchIn ? (
          <SearchInPage
            t={t}
            item={searchIn}
            typed={typed}
            onSelect={() => closeThen(() => onOpenIn(searchIn, typed))}
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
                onEditTags={() => closeThen(() => onEditTags(targets))}
              />
            )}
            <RecentSearchesGroup
              t={t}
              lang={lang}
              typing={typed !== ""}
              onApply={(query) => closeThen(() => onApplySearch(query))}
            />
            <SmartCollectionsGroup
              t={t}
              lang={lang}
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
              filter={filter}
              onFilterChange={onFilterChange}
              onFocusSearch={onFocusSearch}
              onScan={onScan}
              onRebuild={onRebuild}
              onSetView={onSetView}
              onToggleByFolder={onToggleByFolder}
              onToggleHeatmap={onToggleHeatmap}
              onDiscover={onDiscover}
              onTags={onTags}
              onHistory={onHistory}
              onDuplicates={onDuplicates}
              onAutoTag={onAutoTag}
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
  onEditTags,
}: {
  t: TFunc;
  targets: FileRow[];
  files: FileActions;
  closeThen: (fn: () => void) => void;
  openPage: (page: "rating" | "collections") => void;
  onEditTags: () => void;
}) {
  const single = files.single;
  const { activate } = useActivateFile();
  const { keybindingPreset } = usePreferences();
  const keys = GRID_BINDINGS[keybindingPreset];
  const editTagsLabel = t("select.editTags");
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
        {single && (
          <>
            <CommandItem
              value={t("fileMenu.open")}
              onSelect={() => closeThen(() => activate(targets[0]))}
            >
              <Play />
              <span>{t("fileMenu.open")}</span>
              <CommandShortcut>{formatChords(keys.open)}</CommandShortcut>
            </CommandItem>
            <CommandItem
              value={t("fileMenu.inspect")}
              onSelect={() =>
                closeThen(() => activate(targets[0], { autoplay: false }))
              }
            >
              <Info />
              <span>{t("fileMenu.inspect")}</span>
              <CommandShortcut>{formatChords(keys.inspect)}</CommandShortcut>
            </CommandItem>
            <CommandItem
              value={t("media.openExternal")}
              onSelect={() => closeThen(single.openExternal)}
            >
              <ExternalLink />
              <span>{t("media.openExternal")}</span>
            </CommandItem>
          </>
        )}
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
        <CommandItem value={editTagsLabel} onSelect={onEditTags}>
          <TagsIcon />
          <span>{editTagsLabel}</span>
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

function TagPage({
  t,
  search,
  onPick,
  onSearch,
}: {
  t: TFunc;
  search: string;
  onPick: (token: string) => void;
  /** Searches for the directive as typed, as the root's "Search for" did. */
  onSearch: (text: string) => void;
}) {
  const typed = search.trim();
  const pending = useMemo(() => ({ value: search }), [search]);
  const { suggestions, held } = useTagCompletions(pending);
  return (
    <CommandGroup heading={t("filter.tagSuggestions")}>
      {suggestions.map((tag) => (
        <CommandItem
          key={tag.qualified}
          value={`tag:${tag.qualified}`}
          className={held(tag) ? undefined : "text-muted"}
          // The token the search box makes of the same pick.
          onSelect={() => onPick(tagSearchToken(tag.name))}
        >
          <Tag />
          <TagSuggestionLabel t={t} tag={tag} held={held(tag)} />
        </CommandItem>
      ))}
      {/* Last, as at the root: a tag the catalog leaves out, or a directive
          followed by words (`tag:beach sunset`), can still be searched for. */}
      {typed !== "" && (
        <CommandItem
          value="search-for"
          onSelect={() => onSearch(`${TAG_SEARCH_PREFIX}:${typed}`)}
        >
          <Search />
          <span className="truncate">
            {t("command.searchFor", { q: `${TAG_SEARCH_PREFIX}:${typed}` })}
          </span>
        </CommandItem>
      )}
    </CommandGroup>
  );
}

/** A row of the `ws:` and `col:` pages: something the rail switches to. */
interface SwitchItem {
  kind: "ws" | "col";
  /** What api.workspaceSwitch takes. */
  switchId: string;
  name: string;
  emoji?: string;
  active: boolean;
}

/**
 * The workspaces (`ws:`) or the collections (`col:`). Picking one moves on to
 * the search-in page, where a search can be typed to run there.
 */
function SwitchPage({
  t,
  kind,
  onPick,
}: {
  t: TFunc;
  kind: "ws" | "col";
  onPick: (item: SwitchItem) => void;
}) {
  const list = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const items: SwitchItem[] =
    kind === "ws"
      ? (list.data?.workspaces ?? []).map((w) => ({
          kind,
          switchId: w.id,
          name: w.id === ALL_ID ? t("workspace.all") : w.label,
          emoji: w.emoji,
          active: w.active,
        }))
      : (list.data?.collections ?? []).map((c) => ({
          kind,
          switchId: collectionTarget(c.id),
          name: c.id === WATCH_LATER_ID ? t("watchLater.name") : c.name,
          emoji: c.emoji,
          active: c.active,
        }));

  return (
    <CommandGroup
      heading={t(
        kind === "ws" ? "command.groupWorkspace" : "command.pageCollections",
      )}
    >
      {items.map((item) => (
        <CommandItem
          key={item.switchId}
          value={`switch:${item.switchId}`}
          keywords={[item.name]}
          onSelect={() => onPick(item)}
        >
          <SwitchItemIcon item={item} />
          <span className="flex-1 truncate">{item.name}</span>
          {item.active && (
            <span className="text-xs text-primary">{t("command.current")}</span>
          )}
          <ChevronRight className="text-muted" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function SwitchItemIcon({ item }: { item: SwitchItem }) {
  if (item.emoji) {
    return (
      <span className="w-4 shrink-0 text-center" aria-hidden>
        {item.emoji}
      </span>
    );
  }
  if (item.switchId === ALL_ID) return <Layers />;
  if (item.switchId === collectionTarget(WATCH_LATER_ID)) return <Clock />;
  return item.kind === "ws" ? <FolderOpen /> : <Folder />;
}

/**
 * One row: open the picked workspace or collection, searching for what was
 * typed there. With nothing typed it only opens it, as the rail does.
 */
function SearchInPage({
  t,
  item,
  typed,
  onSelect,
}: {
  t: TFunc;
  item: SwitchItem;
  typed: string;
  onSelect: () => void;
}) {
  const label = typed
    ? t("command.searchIn", { q: typed, name: item.name })
    : t("command.openItem", { name: item.name });
  return (
    <CommandGroup>
      <CommandItem value="search-in" onSelect={onSelect}>
        {typed ? <Search /> : <SwitchItemIcon item={item} />}
        <span className="truncate">{label}</span>
        <CommandShortcut>↵</CommandShortcut>
      </CommandItem>
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
  lang,
  typing,
  onApply,
}: {
  t: TFunc;
  lang: Lang;
  typing: boolean;
  onApply: (query: SearchQuery) => void;
}) {
  const recent = useRecentSearches();
  const entries = useMemo(
    () =>
      recent.map((query) => {
        const labels = describeConditions(query, t, lang)
          .filter((c) => c.chip)
          .map((c) => c.label);
        return {
          query,
          key: recentSearchKey(query),
          // A search narrowed only by something without a chip of its own
          // still needs something to show and to match.
          chips: labels.length ? labels : [describeSearchQuery(t, lang, query)],
        };
      }),
    [recent, t, lang],
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
  lang,
  typing,
  onApply,
}: {
  t: TFunc;
  lang: Lang;
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
          const summary = describeSearchQuery(t, lang, c.query);
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
  filter,
  onFilterChange,
  onFocusSearch,
  onScan,
  onRebuild,
  onSetView,
  onToggleByFolder,
  onToggleHeatmap,
  onDiscover,
  onTags,
  onHistory,
  onDuplicates,
  onAutoTag,
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
  filter: SearchQuery;
  onFilterChange: (query: SearchQuery) => void;
  onFocusSearch: () => void;
  onScan: (includeExcluded?: boolean) => void;
  onRebuild: () => void;
  onSetView: (view: ViewMode) => void;
  onToggleByFolder: () => void;
  onToggleHeatmap: () => void;
  onDiscover: () => void;
  onTags: () => void;
  onHistory: () => void;
  onDuplicates: () => void;
  onAutoTag: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onOpenDevTools: () => void;
}) {
  const { lang } = useI18n();
  const { mode, setMode } = useTheme();
  const nextMode = mode === "dark" ? "light" : "dark";
  // The filter bar's "Clear all", enabled on the same rule as the one in its
  // popover: something is narrowing (or sorting) the list.
  const { defaultQuery } = useSmartCollections();
  const canClearFilters =
    describeConditions(filter, t, lang, defaultQuery).length > 0;

  const navigation: CommandAction[] = [
    action(t, "command.focusSearch", {
      id: "focus-search",
      icon: Search,
      shortcut: "/",
      run: () => closeThen(onFocusSearch),
    }),
    action(t, "command.clearFilters", {
      id: "clear-filters",
      icon: X,
      disabled: !canClearFilters,
      run: () =>
        closeThen(() => onFilterChange(clearAllTarget(filter, defaultQuery))),
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
    // Never disabled, like their buttons in the header.
    action(t, "history.title", {
      id: "history",
      icon: History,
      run: () => closeThen(onHistory),
    }),
    action(t, "duplicates.title", {
      id: "duplicates",
      icon: CopyCheck,
      run: () => closeThen(onDuplicates),
    }),
    action(t, "autoTag.title", {
      id: "auto-tag",
      icon: Wand2,
      run: () => closeThen(onAutoTag),
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
    // The header's toggle: the counterpart in the current theme family.
    action(
      t,
      nextMode === "dark" ? "theme.switchToDark" : "theme.switchToLight",
      {
        id: "theme-toggle",
        icon: nextMode === "dark" ? Moon : Sun,
        run: () => closeThen(() => setMode(nextMode)),
      },
    ),
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
