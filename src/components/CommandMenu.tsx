import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  CalendarRange,
  Film,
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
import { SearchChipLabel } from "@/components/SearchChipLabel";
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
import { useSearchDraft, type SearchDraft } from "@/hooks/useSearchDraft";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import { useTagCompletions } from "@/hooks/useTagCompletions";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useI18n, type Lang, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { api, ALL_ID, collectionTarget } from "@/ipc/client";
import type { FileRow, SearchQuery } from "@/ipc/types";
import { commandMenuShortcut } from "@/lib/platform";
import { fileNameOf } from "@/lib/relPath";
import { recentSearchKey } from "@/lib/recentSearches";
import {
  namespaceSuggestions,
  pendingDirective,
  plainWordAtCaret,
  joinQueryChips,
} from "@/lib/searchTokens";
import { searchTokenLabel, tagNamespaceLabel } from "@/lib/tagLabel";
import { cn } from "@/lib/utils";
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
import { MAX_BULK_FILES, TAG_SEARCH_PREFIX } from "@shared/tags";
import { WATCH_LATER_ID } from "@shared/workspaceIds";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
  scanning: boolean;
  devToolsEnabled: boolean;
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
  /** Sets the search to `q`: the field's chips and its text. */
  onSearch: (q: string) => void;
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
 * candidates for a prefix typed at the root (`ws:`, `col:`), or the search to
 * run in the workspace or collection picked from them.
 */
type Page = "rating" | "collections" | PrefixPage | "searchIn" | null;

type PrefixPage = "ws" | "col";

/**
 * The page a prefix at the very start of the text opens, and what follows it.
 * Any other text, an unknown prefix included, stays a search of the menu.
 */
function prefixPage(text: string): { page: PrefixPage; rest: string } | null {
  const m = /^(ws|col):/i.exec(text);
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
  const { open, onOpenChange, onSearch, filter } = props;
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
  // The search being edited, held here rather than in the body: it outlives
  // the pages, and Esc (handled by the dialog) needs to see its highlight.
  const draft = useSearchDraft(open ? (filter.q ?? "") : "");
  const openIn = (item: SwitchItem, text: string) => {
    // The search first, while the filter still belongs to the view it was
    // set in: set after the switch, it would carry the old view's folder into
    // the new one. The text typed there replaces the field's, as "Search for"
    // does; the chips go along.
    if (text) onSearch(joinQueryChips(draft.chips, text));
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
  // Where the menu goes, taken as it opens: over the search it opens from.
  const [anchor, setAnchor] = useState<ReturnType<typeof searchAnchor>>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setPageState(ROOT_PAGE);
    setFocused(open ? getFocusedFile() : null);
    if (open) {
      setAnchor(searchAnchor());
      // The field starts from the search on screen.
      draft.reset(filter.q ?? "");
    }
  }
  // The search moves with the window's width (and the zoom, which fires a
  // resize too): the menu follows it while open.
  useEffect(() => {
    if (!open) return;
    const follow = () => setAnchor(searchAnchor());
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, [open]);

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("command.title")}
        description={t("command.placeholder")}
        // Over the title bar's search, its field where the search was
        // (searchAnchor); just below the bar without one. z-[80]: above the
        // window buttons (TitleBar.tsx), which a narrow window puts under it.
        style={anchor ?? undefined}
        className="z-[80] top-[calc(var(--meguri-title-bar-height)+0.25rem)] rounded-card max-h-[calc(100vh-1rem)] max-w-xl translate-y-0 border-muted/35 bg-bg shadow-2xl"
        onEscapeKeyDown={(e) => {
          // An Esc that cancels an input method's conversion is its own: the
          // menu stays, and with it what was typed.
          if (e.isComposing) {
            e.preventDefault();
            return;
          }
          // Esc on a sub-page steps back rather than closing the menu, and
          // on a highlighted chip goes back to the text.
          if (page) {
            e.preventDefault();
            setPageState(parentPage(pageState));
          } else if (draft.picked !== null) {
            e.preventDefault();
            draft.aim(null);
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
          draft={draft}
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

/** The menu's widest (its max-w-xl: change both together) and the room it
 * keeps from the window's sides. */
const MENU_MAX_WIDTH = 576;
const MENU_MARGIN = 8;
/** From the menu's top edge to its field's: its border and the field's
 * wrapper padding (CommandInput's p-1). */
const FIELD_INSET = 5;

/**
 * Where the menu goes to lay its field over the title bar's search, as VS
 * Code's does: one field on screen, the commands under it. Centered on the
 * search, kept inside the window (centered on it when too narrow to move);
 * null on a screen without the search.
 */
function searchAnchor(): { top: number; left?: number } | null {
  const box = document
    .querySelector("[data-command-menu-anchor]")
    ?.getBoundingClientRect();
  if (!box) return null;
  const top = Math.max(0, box.top - FIELD_INSET);
  if (window.innerWidth < MENU_MAX_WIDTH + 2 * MENU_MARGIN) return { top };
  const half = MENU_MAX_WIDTH / 2;
  const x = box.left + box.width / 2;
  return {
    top,
    left: Math.min(
      Math.max(x, half + MENU_MARGIN),
      window.innerWidth - half - MENU_MARGIN,
    ),
  };
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
  onSearch,
  filter,
  onFilterChange,
  fileActionsAvailable = true,
  focused,
  pageState,
  setPageState,
  onEditTags,
  onOpenIn,
  draft,
}: CommandMenuProps & {
  focused: FileRow | null;
  pageState: PageState;
  setPageState: (state: PageState) => void;
  onEditTags: (rows: FileRow[]) => void;
  onOpenIn: (item: SwitchItem, text: string) => void;
  draft: SearchDraft;
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
  // At the root the field edits the search (the draft); a page's field is
  // its own.
  const value = page === null ? draft.text : search;
  // The field starts from the search on screen. Until it is edited, that is
  // only the search shown again: the rows are not filtered by it, nothing is
  // completed and there is no search to run, so the menu opens on every
  // command as an empty field would.
  const edited = page !== null || draft.edited;
  const typed = edited ? value.trim() : "";
  // Completion runs only with the caret at the end of the text, since a pick
  // replaces the last token, and not while an input method composes: the
  // text is not final yet, and its own candidate window opens there.
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [composing, setComposing] = useState(false);
  const trackCaret = (field: HTMLInputElement) =>
    setCaretAtEnd(
      field.selectionStart === field.value.length &&
        field.selectionEnd === field.value.length,
    );
  const completing =
    page === null &&
    edited &&
    caretAtEnd &&
    !composing &&
    draft.picked === null;
  const directiveValue = completing
    ? (pendingDirective(draft.text)?.value ?? null)
    : null;
  const word =
    completing && directiveValue === null ? plainWordAtCaret(draft.text) : null;
  // The search row: first once the field is edited, and while a search is
  // only shown again too, so Enter on the field as opened (`/` then Enter,
  // as in a search box) runs that search rather than whichever command
  // heads the list. An empty field has none, so Enter takes the first row.
  const searchRow = page === null && (edited || draft.query !== "");
  const pending = useMemo(
    () =>
      directiveValue !== null
        ? { value: directiveValue }
        : word !== null
          ? { value: word, namesOnly: true }
          : null,
    [directiveValue, word],
  );
  const completions = useTagCompletions(pending);
  // A word that begins a generated namespace's name or label (`tempo`) is
  // offered its directive (`tag:audio_tempo:`), whose values come next.
  const namespaces = useMemo(
    () =>
      word === null
        ? []
        : namespaceSuggestions(word, (ns) => tagNamespaceLabel(t, ns)),
    [word, t],
  );
  // The row Enter takes. cmdk highlights the first row as the text changes,
  // but not one that turns up later (the catalog arriving, a chip removed):
  // the first row is put back on whenever it changes.
  const firstRow =
    directiveValue !== null && completions.suggestions.length > 0
      ? `complete-tag ${completions.suggestions[0].qualified}`
      : searchRow
        ? `search-for ${draft.query}`
        : null;
  const [highlighted, setHighlighted] = useState("");
  const [seenFirstRow, setSeenFirstRow] = useState<string | null>(null);
  if (firstRow !== seenFirstRow) {
    setSeenFirstRow(firstRow);
    // Without one, back to cmdk's own first row: the one that went away
    // would leave nothing highlighted.
    setHighlighted(firstRow ?? "");
  }
  const targets = useCommandTargets(focused, fileActionsAvailable);
  const watchLater = useWatchLater();
  const files = useFileActions(targets, watchLater);
  const closeThen = (fn: () => void) => {
    onOpenChange(false);
    window.setTimeout(fn, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!page) {
      // Keys an input method takes are its own.
      if (!e.nativeEvent.isComposing && inputRef.current)
        draft.onKey(e, inputRef.current);
      return;
    }
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

  const onSearchChange = (next: string) => {
    if (page !== null) {
      setSearch(next);
      return;
    }
    const prefix = prefixPage(next);
    if (prefix) {
      draft.clearText();
      setPage(prefix.page, prefix.rest);
    } else draft.apply(next);
  };
  /** After a pick that keeps the menu open: back to typing in the field. */
  const refocus = () => inputRef.current?.focus();

  const filePageBadge =
    page === "rating"
      ? t("command.pageRating")
      : page === "collections"
        ? t("command.pageCollections")
        : null;
  // A prefix page shows the prefix itself: it is what was typed to get there.
  const badge =
    page === "ws" || page === "col"
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
        : page === "ws"
          ? t("command.workspacePlaceholder")
          : page === "col"
            ? t("command.collectionOpenPlaceholder")
            : searchIn
              ? t("command.searchInPlaceholder", { name: searchIn.name })
              : draft.chips.length > 0
                ? undefined
                : t("command.placeholder");

  return (
    <Command
      onKeyDown={onKeyDown}
      filter={matchKeywords}
      // The search-in page's one row is whatever was typed.
      shouldFilter={page !== "searchIn" && edited}
      value={highlighted}
      onValueChange={setHighlighted}
    >
      <CommandInput
        ref={inputRef}
        placeholder={placeholder}
        aria-label={t("command.placeholder")}
        value={value}
        onValueChange={onSearchChange}
        onSelect={(e) => trackCaret(e.currentTarget)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => {
          // In the search field Home and End move the caret, as in any
          // field (back to the chips, say), rather than cmdk's first and
          // last rows.
          if (page === null && (e.key === "Home" || e.key === "End"))
            e.stopPropagation();
        }}
        badge={badge}
        leading={
          page === null && draft.chips.length > 0 ? (
            <DraftChips t={t} draft={draft} onFocusField={refocus} />
          ) : undefined
        }
      />
      <CommandList>
        {/* Not while the search row is up: cmdk does not count a
            force-mounted row, and would call a menu holding one empty. */}
        {(page !== null || !searchRow) && (
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
            {/* After `tag:`, Enter takes the highlighted tag, so the tags come
                first; over a word, the search does (#542). */}
            {directiveValue !== null && (
              <TagCompletions
                t={t}
                completions={completions}
                namespaces={[]}
                draft={draft}
                onPicked={refocus}
              />
            )}
            {searchRow && (
              // First while text is typed, so Enter searches for what the
              // field holds: a recent or saved search, or a command, that
              // happens to match is a pick away below, not what Enter does.
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`search-for ${draft.query}`}
                  onSelect={() => closeThen(() => onSearch(draft.query))}
                >
                  <Search />
                  <span className="truncate">
                    {draft.query === ""
                      ? t("filter.clearSearch")
                      : t("command.searchFor", { q: draft.query })}
                  </span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            )}
            {word !== null && (
              <TagCompletions
                t={t}
                completions={completions}
                namespaces={namespaces}
                draft={draft}
                onPicked={refocus}
              />
            )}
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
          </>
        )}
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-xs text-muted">
        {t("command.shortcutHint", { shortcut: commandMenuShortcut() })}
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

/**
 * The tags the end of the field completes to: after `tag:`, the whole
 * catalog's matches; over an ordinary word, the tags whose names hold it, and
 * the generated namespaces it begins (#542). Picking one keeps the menu open,
 * the tag a chip in the field, so the search can go on being typed.
 */
function TagCompletions({
  t,
  completions: { suggestions, held },
  namespaces,
  draft,
  onPicked,
}: {
  t: TFunc;
  completions: ReturnType<typeof useTagCompletions>;
  namespaces: string[];
  draft: SearchDraft;
  onPicked: () => void;
}) {
  if (suggestions.length === 0 && namespaces.length === 0) return null;
  return (
    // Force-mounted: they match the end of the field, not the whole of it,
    // which is what the menu filters its rows by.
    <CommandGroup heading={t("filter.tagSuggestions")} forceMount>
      {namespaces.map((ns) => (
        <CommandItem
          key={ns}
          forceMount
          value={`complete-namespace ${ns}`}
          onSelect={() => {
            // Left open, so its values are offered next.
            draft.startNamespace(ns);
            onPicked();
          }}
        >
          <Tag />
          <span className="truncate">
            <span className="text-muted">{TAG_SEARCH_PREFIX}:</span>
            {ns}:
          </span>
          <span className="truncate text-xs text-muted">
            {tagNamespaceLabel(t, ns)}
          </span>
        </CommandItem>
      ))}
      {suggestions.map((tag) => (
        <CommandItem
          key={tag.qualified}
          forceMount
          value={`complete-tag ${tag.qualified}`}
          className={held(tag) ? undefined : "text-muted"}
          onSelect={() => {
            draft.accept(tag);
            onPicked();
          }}
        >
          <Tag />
          <TagSuggestionLabel t={t} tag={tag} held={held(tag)} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/**
 * The search's conditions, in the field ahead of its text. They look like
 * SearchTrigger's chips (the same data-slot, which themes style): change the
 * two together.
 */
function DraftChips({
  t,
  draft,
  onFocusField,
}: {
  t: TFunc;
  draft: SearchDraft;
  onFocusField: () => void;
}) {
  return draft.chips.map((token, i) => (
    <span
      key={`${token}-${i}`}
      data-slot="search-chip"
      data-selected={i === draft.picked ? "true" : undefined}
      title={searchTokenLabel(t, token) ?? undefined}
      // Focus stays in the field: the chips are a rendering of the query.
      onMouseDown={(e) => e.preventDefault()}
      // Mouse parity with the arrow keys: a click aims at the chip.
      onClick={() => {
        draft.aim(i);
        onFocusField();
      }}
      className={cn(
        "flex h-5 min-w-0 shrink-0 items-center gap-0.5 rounded py-0 pl-1.5 pr-0.5 text-xs",
        i === draft.picked ? "bg-primary/25 ring-1 ring-ring" : "bg-fg/10",
      )}
    >
      <SearchChipLabel t={t} token={token} />
      <button
        type="button"
        // Out of the tab order: focus stays in the field, where Backspace
        // removes a chip, and an Enter here would reach the menu's rows.
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          draft.removeChip(i);
          onFocusField();
        }}
        aria-label={t("home.removeChip")}
        className="rounded-full p-0.5 transition hover:bg-fg/15"
      >
        <X className="size-3" />
      </button>
    </span>
  ));
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
  // The same cache entry the filter bar's menu reads, so a search saved
  // there shows here.
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
    action(t, "view.filmstrip", {
      id: "view-filmstrip",
      icon: Film,
      run: () => closeThen(() => onSetView("filmstrip")),
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
