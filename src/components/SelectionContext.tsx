// Multi-select state for the media list, shared by both view modes.
//
// Selection lives here rather than in each view because the views are swapped
// in and out as the user changes view mode and the selection has to survive
// that — and because the selection bar and the bulk tag dialog sit outside the
// views entirely.
//
// It is held in a small store that components subscribe to per value, rather
// than in React state on a context. With state on a context, every change
// produced a new context value, so each click re-rendered every mounted row —
// and a row holds a thumbnail, tag chips and three of its own controls, so a
// Shift range over a full viewport re-rendered all of that. A row now subscribes
// to its own boolean and React skips it when that boolean has not moved.
//
// A selected row is kept as a whole FileRow snapshot, not just its id, so a row
// that has scrolled out of the loaded window still counts: the bar's number and
// the dialog's totals can never drift apart. Reading a row prefers the version
// the list currently holds, and the snapshot is renewed from it, so an edit
// landing in the query cache is reflected without the selection having to be
// told about it. A row the list does not hold — a picked folder's files, a row
// scrolled out or filtered away — has only its snapshot, so a bulk edit tells
// the selection what it wrote (patch, refreshFolders).
//
// In the folder view a folder card can be selected too. It stands for every
// file below it, fetched (expandFolders) the moment it is picked: the bar and
// the tag dialog are built from rows, and a folder they could not read would be
// a number the user cannot act on. Until its files arrive the selection is
// `pending` and the bulk actions wait.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { FileRow, FolderEntry, FolderFilesResult } from "@/ipc/types";
// The same identity drag-and-drop keys rows by: file ids are unique only
// within a workspace.
import { mediaSortId as selectionKey } from "@/lib/mediaSortId";
import { MAX_FOLDER_FILES_PATHS } from "@shared/folderPath";

/** Modifier keys that change what a click on a card means. */
export interface SelectionClickMods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** What identifies a file to the selection. */
export type FileKey = Pick<FileRow, "id" | "workspaceId">;

/** The selection as a whole — what the bar and the dialog read. */
export interface SelectionView {
  /** Selection mode is on: cards show their checkbox and clicks select. */
  active: boolean;
  /**
   * Files the selection covers. Equal to rows.length, except that a folder
   * whose files were cut short at the bulk-edit cap counts all of them — which
   * is what tells the bar the edit is too large.
   */
  count: number;
  /** Selected rows, in the order they were selected; selected folders' files after. */
  rows: FileRow[];
  /** A selected folder's files are still being fetched. */
  pending: boolean;
  /** How many folders are selected. */
  folderCount: number;
}

/** Fetches selected folders' files (folder_files), injected by the provider. */
export type ExpandFolders = (paths: string[]) => Promise<FolderFilesResult>;

export interface SelectionApi extends SelectionView {
  isSelected: (file: FileRow) => boolean;
  /** A click on a card while selecting, or a modified click that starts it. */
  click: (file: FileRow, index: number, mods: SelectionClickMods) => void;
  /**
   * Take a row out of the selection because the file itself is gone (dropped
   * from the index). A selected row is kept even when the list no longer
   * shows it, so a deleted one has to be removed explicitly.
   */
  forget: (file: FileKey) => void;
  /**
   * Apply to the selection's own copies what a bulk edit wrote to `files`.
   * The list's rows follow the query cache; the rows the list does not hold
   * (see the header) would otherwise keep showing the values from before.
   */
  patch: (files: FileKey[], patch: Partial<FileRow>) => void;
  /**
   * Fetch the picked folders' files again, after an edit whose result cannot
   * be patched in (a bulk tag edit reports counts, not rows).
   */
  refreshFolders: () => void;
  /** Every loaded row. "Loaded" is the honest scope; see the comment on it. */
  selectAll: () => void;
  /** Empty the selection but stay in selection mode. */
  deselectAll: () => void;
  /** Leave selection mode and drop everything. */
  exit: () => void;
  /** A click on a folder card while selecting, or a modified click that starts it. */
  toggleFolder: (entry: FolderEntry) => void;
}

/**
 * Whether a click should be treated as a selection click at all. Used by the
 * views to decide whether to swallow a card's navigation: in selection mode
 * every plain click selects, and outside it only a modified click does — which
 * is what lets a selection start without first aiming at the checkbox.
 */
export function isSelectionClick(
  active: boolean,
  mods: SelectionClickMods,
): boolean {
  return active || mods.shiftKey || mods.ctrlKey || mods.metaKey;
}

const NO_ROWS: FileRow[] = [];
const EMPTY_VIEW: SelectionView = {
  active: false,
  count: 0,
  rows: NO_ROWS,
  pending: false,
  folderCount: 0,
};

interface FolderPick {
  entry: FolderEntry;
  /** Null until the folder's files have arrived. */
  rows: FileRow[] | null;
  total: number;
}

class SelectionStore {
  /** The list as currently loaded. Ranges and "select all" work on it. */
  private items: FileRow[] = [];
  private scope: string | null = null;
  private active = false;
  private selected = new Map<string, FileRow>();
  /** Folders on screen: what "select all" adds besides the loaded rows. */
  private folderItems: FolderEntry[] = [];
  private folders = new Map<string, FolderPick>();
  private expand: ExpandFolders | null = null;
  /**
   * Where a Shift-click measures its range from: the last row clicked without
   * Shift, held by key rather than by index. The list is a sliding window —
   * pages are dropped from one end as others load, and a new filter replaces it
   * outright — so an index kept across those would silently come to mean a
   * different file.
   */
  private anchorKey: string | null = null;
  private view: SelectionView = EMPTY_VIEW;
  private listeners = new Set<() => void>();
  /** A change made while rendering, announced once the commit is done. */
  private deferred = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes, which is what lets subscribers bail out. */
  getView = (): SelectionView => this.view;

  isSelected = (file: FileRow): boolean =>
    this.selected.has(selectionKey(file));

  isFolderSelected = (path: string): boolean => this.folders.has(path);

  /** Whether the folder is selected and its files have not arrived yet. */
  isFolderPending = (path: string): boolean =>
    this.folders.get(path)?.rows === null;

  /** Read on its own, so entering or leaving selection mode is all a row sees. */
  isActive = (): boolean => this.active;

  /**
   * Called by the provider as it renders, so a list the user has just switched
   * to is never drawn carrying the previous list's selection.
   *
   * `scope` identifies which list `items` is. Changing it drops the selection:
   * rows picked under another workspace or another filter are no longer on
   * screen, and a bulk edit that silently included them would act on files the
   * user cannot see. Paging within one list must NOT change it.
   */
  syncList(
    items: FileRow[],
    scope: string,
    folderView: { folders?: FolderEntry[]; expand?: ExpandFolders } = {},
  ): void {
    const listChanged = this.items !== items;
    this.items = items;
    this.folderItems = folderView.folders ?? [];
    this.expand = folderView.expand ?? null;
    if (this.scope !== scope) {
      const had =
        this.active || this.selected.size > 0 || this.folders.size > 0;
      this.scope = scope;
      this.active = false;
      this.selected = new Map();
      this.folders = new Map();
      this.anchorKey = null;
      if (had) this.rebuild(true);
      return;
    }
    // A selected row that is still loaded is read from the list, so an edit that
    // refreshed the query shows through the next time the selection is read.
    // Its snapshot is renewed too: should the edit take the row off the list
    // (unfavorited under a favorites filter), what is left must not be the
    // row as it was before the edit.
    if (listChanged && (this.selected.size > 0 || this.folders.size > 0)) {
      let next: Map<string, FileRow> | null = null;
      for (const item of items) {
        const key = selectionKey(item);
        const snapshot = this.selected.get(key);
        if (snapshot === undefined || snapshot === item) continue;
        next ??= new Map(this.selected);
        next.set(key, item);
      }
      if (next) this.selected = next;
      this.rebuild(true);
    }
  }

  /** Announces what syncList changed: notifying during render is not allowed. */
  flush = (): void => {
    if (!this.deferred) return;
    this.deferred = false;
    this.emit();
  };

  click = (file: FileRow, index: number, mods: SelectionClickMods): void => {
    const next = new Map(this.selected);
    const key = selectionKey(file);
    // The anchor is resolved against the list as it is now. If the row it named
    // has since been paged out, there is no meaningful range to draw and the
    // click falls back to picking this one row.
    const from = this.anchorKey
      ? this.items.findIndex((row) => selectionKey(row) === this.anchorKey)
      : -1;
    if (mods.shiftKey && from !== -1) {
      // A range always adds: dragging a selection out over rows already picked
      // should not punch holes in it. Shift also leaves the anchor where it is,
      // so a second Shift-click re-measures from the same start.
      const [lo, hi] = from <= index ? [from, index] : [index, from];
      for (const row of this.items.slice(lo, hi + 1)) {
        next.set(selectionKey(row), row);
      }
    } else {
      if (next.has(key)) next.delete(key);
      else next.set(key, file);
      this.anchorKey = key;
    }
    this.active = true;
    this.selected = next;
    this.rebuild(false);
  };

  forget = (file: FileKey): void => {
    const key = selectionKey(file);
    let changed = false;
    if (this.selected.has(key)) {
      const next = new Map(this.selected);
      next.delete(key);
      this.selected = next;
      if (this.anchorKey === key) this.anchorKey = null;
      changed = true;
    }
    // A picked folder holds its files as fetched; the file goes from there
    // too, and from the folder's count.
    const folders = new Map(this.folders);
    for (const [path, pick] of this.folders) {
      if (!pick.rows) continue;
      const rows = pick.rows.filter((row) => selectionKey(row) !== key);
      if (rows.length === pick.rows.length) continue;
      folders.set(path, { ...pick, rows, total: pick.total - 1 });
      changed = true;
    }
    if (!changed) return;
    this.folders = folders;
    this.rebuild(false);
  };

  patch = (files: FileKey[], patch: Partial<FileRow>): void => {
    const keys = new Set(files.map(selectionKey));
    let changed = false;
    const selected = new Map(this.selected);
    for (const [key, row] of this.selected) {
      if (!keys.has(key)) continue;
      selected.set(key, { ...row, ...patch });
      changed = true;
    }
    const folders = new Map(this.folders);
    for (const [path, pick] of this.folders) {
      if (!pick.rows?.some((row) => keys.has(selectionKey(row)))) continue;
      const rows = pick.rows.map((row) =>
        keys.has(selectionKey(row)) ? { ...row, ...patch } : row,
      );
      folders.set(path, { ...pick, rows });
      changed = true;
    }
    if (!changed) return;
    this.selected = selected;
    this.folders = folders;
    this.rebuild(false);
  };

  // The files shown stay until the new ones arrive, and stay if they never
  // do: the selection does not go back to pending.
  refreshFolders = (): void => {
    this.fetchFolders(
      [...this.folders]
        .filter(([, pick]) => pick.rows !== null)
        .map(([path]) => path),
    );
  };

  // "All" is everything the list has loaded, not everything the filter matches:
  // the rows are what the tally and the edit are built from, so a count that
  // included rows the dialog cannot read would be a number the user cannot act
  // on. Scrolling further and pressing it again widens it.
  selectAll = (): void => {
    this.active = true;
    this.selected = new Map(
      this.items.map((row) => [selectionKey(row), row] as const),
    );
    this.anchorKey = null;
    // Folders on screen join too; those already picked keep their files.
    const added: FolderEntry[] = [];
    const next = new Map(this.folders);
    for (const entry of this.folderItems) {
      if (next.has(entry.path)) continue;
      next.set(entry.path, { entry, rows: null, total: entry.count });
      added.push(entry);
    }
    this.folders = next;
    this.rebuild(false);
    this.fetchFolders(added.map((e) => e.path));
  };

  toggleFolder = (entry: FolderEntry): void => {
    const next = new Map(this.folders);
    const picking = !next.has(entry.path);
    if (picking) {
      next.set(entry.path, { entry, rows: null, total: entry.count });
    } else {
      next.delete(entry.path);
    }
    this.active = true;
    this.folders = next;
    this.rebuild(false);
    if (picking) this.fetchFolders([entry.path]);
  };

  deselectAll = (): void => {
    this.selected = new Map();
    this.folders = new Map();
    this.anchorKey = null;
    this.rebuild(false);
  };

  exit = (): void => {
    this.active = false;
    this.selected = new Map();
    this.folders = new Map();
    this.anchorKey = null;
    this.rebuild(false);
  };

  /**
   * Fetch picked folders' files and fill them in. A result is dropped when the
   * pick it answers is gone — deselected, re-picked, or swept away by a list
   * change — so a slow answer can never resurrect a selection. A failed first
   * fetch un-picks its folders rather than leaving them pending forever.
   *
   * A pick that already had its files when they were asked for again
   * (refreshFolders) can be replaced while the answer is on its way, by an
   * edit patched in or by another refresh. That answer may predate the edit,
   * so it is dropped like any other — and asked for once more, or the folder
   * would keep the files it had before the refresh.
   */
  private fetchFolders(paths: string[]): void {
    const expand = this.expand;
    if (paths.length === 0) return;
    if (!expand) {
      this.dropFolders(paths);
      return;
    }
    for (let i = 0; i < paths.length; i += MAX_FOLDER_FILES_PATHS) {
      const batch = paths.slice(i, i + MAX_FOLDER_FILES_PATHS);
      const picks = new Map(batch.map((p) => [p, this.folders.get(p)]));
      expand(batch).then(
        (results) => {
          let changed = false;
          const again: string[] = [];
          const next = new Map(this.folders);
          for (const { path, rows, total } of results) {
            const pick = next.get(path);
            if (!pick) continue;
            if (pick !== picks.get(path)) {
              // Not a fresh pick with a fetch of its own under way.
              if (pick.rows !== null) again.push(path);
              continue;
            }
            next.set(path, { ...pick, rows, total });
            changed = true;
          }
          if (changed) {
            this.folders = next;
            this.rebuild(false);
          }
          this.fetchFolders(again);
        },
        () => {
          // Only a pick still waiting for its first files: one being read
          // again keeps the files it has.
          this.dropFolders(
            batch.filter((p) => {
              const pick = this.folders.get(p);
              return pick === picks.get(p) && pick?.rows === null;
            }),
          );
        },
      );
    }
  }

  private dropFolders(paths: string[]): void {
    if (paths.length === 0) return;
    const next = new Map(this.folders);
    for (const p of paths) next.delete(p);
    this.folders = next;
    this.rebuild(false);
  }

  private rebuild(duringRender: boolean): void {
    if (this.selected.size === 0 && this.folders.size === 0) {
      this.view = this.active ? { ...EMPTY_VIEW, active: true } : EMPTY_VIEW;
    } else {
      const byKey = new Map(
        this.items.map((item) => [selectionKey(item), item] as const),
      );
      const rows = new Map<string, FileRow>();
      for (const [key, snapshot] of this.selected) {
        rows.set(key, byKey.get(key) ?? snapshot);
      }
      let pending = false;
      // Files a folder holds beyond the rows fetched for it: only past the
      // bulk-edit cap, where the fetch stops early.
      let uncounted = 0;
      for (const pick of this.folders.values()) {
        if (pick.rows === null) {
          pending = true;
          continue;
        }
        for (const row of pick.rows) {
          const key = selectionKey(row);
          if (!rows.has(key)) rows.set(key, byKey.get(key) ?? row);
        }
        uncounted += Math.max(0, pick.total - pick.rows.length);
      }
      this.view = {
        active: this.active,
        count: rows.size + uncounted,
        rows: [...rows.values()],
        pending,
        folderCount: this.folders.size,
      };
    }
    if (duringRender) this.deferred = true;
    else this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const StoreContext = createContext<SelectionStore | null>(null);

function useStore(): SelectionStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useSelection outside SelectionProvider");
  return store;
}

/** The selection as a whole. For the bar and the dialog, which show all of it. */
export function useSelection(): SelectionApi {
  const store = useStore();
  const view = useSyncExternalStore(store.subscribe, store.getView);
  return useMemo(
    () => ({
      ...view,
      isSelected: store.isSelected,
      click: store.click,
      forget: store.forget,
      patch: store.patch,
      refreshFolders: store.refreshFolders,
      selectAll: store.selectAll,
      deselectAll: store.deselectAll,
      exit: store.exit,
      toggleFolder: store.toggleFolder,
    }),
    [view, store],
  );
}

/**
 * One row's view of the selection: whether selection mode is on, and a reader
 * for its own membership.
 *
 * Both are subscribed as booleans rather than taken from {@link useSelection},
 * so a row re-renders only when its own membership moves. Entering or leaving
 * selection mode does re-render every row, which is the point: that is when the
 * checkboxes appear and disappear.
 */
export function useSelectionMode(): {
  active: boolean;
  click: SelectionApi["click"];
} {
  const store = useStore();
  const active = useSyncExternalStore(store.subscribe, store.isActive);
  return { active, click: store.click };
}

/** A folder card's view of the selection: picked, and still being fetched. */
export function useFolderSelection(path: string): {
  active: boolean;
  selected: boolean;
  pending: boolean;
  toggle: SelectionApi["toggleFolder"];
} {
  const store = useStore();
  const active = useSyncExternalStore(store.subscribe, store.isActive);
  const readSelected = () => store.isFolderSelected(path);
  const readPending = () => store.isFolderPending(path);
  const selected = useSyncExternalStore(
    store.subscribe,
    readSelected,
    readSelected,
  );
  const pending = useSyncExternalStore(
    store.subscribe,
    readPending,
    readPending,
  );
  return { active, selected, pending, toggle: store.toggleFolder };
}

/**
 * Reads the selection at the moment it is called, without subscribing: for an
 * event handler (a drag starting) that needs the selection once and must not
 * re-render its row every time the selection changes.
 */
export function useReadSelection(): () => SelectionView {
  return useStore().getView;
}

const noForget = (): void => {};

/**
 * {@link SelectionApi.forget} for a view that may sit outside the list (the
 * detail view opens from other screens too): a no-op where there is no
 * selection to forget from.
 */
export function useForgetSelected(): SelectionApi["forget"] {
  return useContext(StoreContext)?.forget ?? noForget;
}

/** Whether this one row is selected, as its own subscription. */
export function useIsSelected(file: FileRow): boolean {
  const store = useStore();
  const read = () => store.isSelected(file);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function SelectionProvider({
  items,
  scope = "",
  folders,
  expandFolders,
  children,
}: {
  /** The list as currently loaded. Range selection and "select all" work on it. */
  items: FileRow[];
  /** Identifies which list `items` is; see SelectionStore.syncList. */
  scope?: string;
  /** Folders on screen (shown by folder), which "select all" also picks. */
  folders?: FolderEntry[];
  /** Fetches a picked folder's files. Without it folders cannot be selected. */
  expandFolders?: ExpandFolders;
  children: ReactNode;
}) {
  const [store] = useState(() => new SelectionStore());
  // Read while rendering so the views below never paint one frame with a
  // selection that belongs to the previous list; announced after the commit.
  store.syncList(items, scope, { folders, expand: expandFolders });
  useEffect(() => store.flush());
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}
