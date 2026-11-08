// Workspace (scan root) management. In addition to persisting the config, it caches
// Core per workspace ID (the hash of the root path) so any workspace can be resolved
// by ID. The media server uses this to serve without depending on the active workspace.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Core } from "./index.js";
import type {
  LibraryMergeFailure,
  LibraryMergeFailureReason,
  LibraryMergeProgress,
} from "../../shared/ipc/schema.js";
import {
  loadConfig,
  saveConfig,
  cleanupStaleTemp,
  normalizeDir,
  type AppConfig,
  type UserCollectionConfig,
  type UserCollectionItemConfig,
} from "./appConfig.js";
import {
  backupDbPathForDataDir,
  dataDirForRoot,
  dbPathForDataDir,
  libraryDbPath,
  pathHash,
} from "./paths.js";
import log from "./logger.js";
import {
  errorCode,
  nowUnix,
  openLibraryReadonly,
  usesOwnMetadata,
} from "./db.js";
import {
  recordedWorkspaceIds,
  syncTagIndexes as syncTagIndexesOf,
} from "./library.js";

export interface WorkspaceInfo {
  id: string;
  path: string;
  label: string;
  active: boolean;
  /** Optional emoji icon; falls back to label initials when unset. */
  emoji?: string;
}

export {
  ALL_ID,
  COLLECTION_ID_PREFIX,
  WATCH_LATER_ID,
  collectionTarget,
} from "../../shared/workspaceIds.js";
import {
  ALL_ID,
  COLLECTION_ID_PREFIX,
  WATCH_LATER_ID,
  collectionTarget,
} from "../../shared/workspaceIds.js";

export type InitErrorKind = "schema_mismatch" | "unknown";

interface WorkspaceInitError {
  message: string;
  kind: InitErrorKind;
}

/** A workspace a merge left on its own tables, and why. */
interface PendingFailure {
  path: string;
  reason: LibraryMergeFailureReason;
}

export class Workspaces {
  private config: AppConfig;
  private cores = new Map<string, Core>();
  private errors = new Map<string, WorkspaceInitError>();
  /** Set by closeAll(): no Core may be (re)opened afterwards. */
  private closed = false;
  /**
   * Roots whose metadata may still need merging into the library (see
   * bootstrap and mergePending), and how far mergePending has got. While it is
   * set, nothing but mergePending and remove() opens one of those roots
   * (coreForPath): opening one merges it on the spot, outside the progress the
   * window shows.
   */
  private merge: { pending: string[]; done: number; total: number } | null =
    null;
  /** How many workspaces the last mergePending moved into the library. */
  private mergedLast = 0;
  /** Above zero while metadataCores opens workspaces, which catches the
   *  others' keyword indexes up once at the end rather than after each. */
  private holdingTagSync = 0;
  /** The workspaces the last mergePending could not merge, and why. */
  private mergeFailed: PendingFailure[] = [];

  constructor() {
    this.config = loadConfig();
    this.seedWatchLater();
  }

  /**
   * Persist our snapshot, refreshing the fields this class never owns first.
   * `update` and `autoTag` are written independently via `updateConfig()`, so
   * spreading our startup snapshot back wholesale would silently revert the
   * user's update preferences and their auto-tagging rules. Every write below goes
   * through here rather than calling saveConfig directly.
   */
  private persist(): void {
    const { update, autoTag } = loadConfig();
    this.config.update = update;
    this.config.autoTag = autoTag;
    saveConfig(this.config);
  }

  /**
   * Ensure the built-in "Watch Later" collection exists *and is locked*. Runs on
   * every load rather than behind a one-time migration flag, so a config that
   * was hand-edited self-heals on the next launch.
   *
   * The lock is repaired rather than assumed: an entry that kept its id but lost
   * `locked` would pass the "already exists" check while `isLocked()` reported
   * false, leaving the list renamable/removable/reorderable and breaking the
   * guarantee this collection is supposed to carry.
   */
  private seedWatchLater(): void {
    const existing = this.config.collections.find(
      (c) => c.id === WATCH_LATER_ID,
    );
    if (existing) {
      if (existing.locked !== true) {
        existing.locked = true;
        existing.updatedAt = nowUnix();
        this.persist();
      }
      return;
    }
    const now = nowUnix();
    this.config.collections.unshift({
      id: WATCH_LATER_ID,
      // Display name comes from the renderer's i18n ("watchLater.name"); this is
      // only a fallback for any surface that reads the stored name directly.
      name: "Watch Later",
      emoji: "🕒",
      items: [],
      createdAt: now,
      updatedAt: now,
      locked: true,
    });
    this.persist();
  }

  /** Root path → stable workspace ID (matches Core's data directory name). */
  static idFor(p: string): string {
    return pathHash(normalizeDir(p));
  }

  list(): WorkspaceInfo[] {
    // The virtual "All" workspace is always listed first.
    const all: WorkspaceInfo = {
      id: ALL_ID,
      path: "",
      label: "All",
      active: this.config.activePath === ALL_ID,
    };
    return [
      all,
      ...this.config.roots.map((p) => {
        const id = Workspaces.idFor(p);
        return {
          id,
          path: p,
          label: path.basename(p) || p,
          active: p === this.config.activePath,
          emoji: this.config.workspaceEmojis[id],
        };
      }),
    ];
  }

  collections() {
    return this.config.collections.map((collection) => ({
      ...collection,
      active: this.config.activePath === collectionTarget(collection.id),
      locked: collection.locked === true,
    }));
  }

  get activePath(): string | null {
    return this.config.activePath;
  }

  get activeId(): string | null {
    const collectionId = activeCollectionId(this.config.activePath);
    if (collectionId) return collectionTarget(collectionId);
    if (this.config.activePath === ALL_ID) return ALL_ID;
    return this.config.activePath
      ? Workspaces.idFor(this.config.activePath)
      : null;
  }

  /** Whether the virtual "All" (cross-workspace) view is active. */
  isAll(): boolean {
    return this.config.activePath === ALL_ID;
  }

  isCollection(): boolean {
    return activeCollectionId(this.config.activePath) != null;
  }

  activeCollection() {
    const id = activeCollectionId(this.config.activePath);
    return id
      ? (this.config.collections.find((c) => c.id === id) ?? null)
      : null;
  }

  /** How many roots are registered, including any whose DB fails to open. */
  rootCount(): number {
    return this.config.roots.length;
  }

  /**
   * Close every cached Core (quit path) and refuse to open any more. No writer
   * handle may outlive process teardown: a live better-sqlite3 connection at
   * exit is a native-crash risk, and a late media request or IPC during the
   * quit window must not quietly reopen one.
   */
  closeAll(): void {
    this.closed = true;
    for (const core of this.cores.values()) core.close();
    this.cores.clear();
    this.errors.clear();
  }

  /**
   * Bring every open workspace's keyword index up to date with tag changes
   * made through any workspace (library.ts). Call after anything that writes
   * user tags; never throws. A workspace opened later catches up as it opens
   * (Core.init).
   */
  syncTagIndexes(): void {
    syncTagIndexesOf([...this.cores.values()].map((core) => core.db));
  }

  /**
   * The Cores a write meant for every workspace's metadata runs on (tag
   * rename, merge and delete; clearing the play history). One that uses the
   * shared library reaches every workspace on it at once, so a Core already
   * open is used. A workspace still on its own metadata tables (its merge has
   * not run) is reached only through its own, and would bring old names back
   * when merged later: every registered workspace the library has no record
   * of is opened, which merges it or finds it on the library already. One
   * whose DB cannot be opened misses the write, worth a line in the log.
   */
  metadataCores(): { id: string; core: Core }[] {
    let merged = false;
    const open = (p: string) => {
      // Not left for mergePending: a workspace skipped here would bring the
      // old names back when it merges. Its merge may change tags the others
      // index: they are caught up once, below, rather than after each open.
      this.holdingTagSync++;
      try {
        const core = this.coreForPath(p, { merging: true });
        if (core?.mergedOnOpen) merged = true;
        return core ? { id: Workspaces.idFor(p), core } : null;
      } finally {
        this.holdingTagSync--;
      }
    };
    const opened = () =>
      this.config.roots.flatMap((p) => {
        const core = this.cores.get(Workspaces.idFor(p));
        return core ? [{ id: Workspaces.idFor(p), core }] : [];
      });
    // Any Core reads the library's record; open one if none is.
    if (opened().length === 0) {
      for (const p of this.config.roots) if (open(p)) break;
    }
    const reader = opened()[0];
    if (!reader) return [];
    const recorded = recordedWorkspaceIds(reader.core.db, "lib");
    let missed = 0;
    for (const p of this.config.roots) {
      if (this.cores.has(Workspaces.idFor(p))) continue;
      if (recorded.has(Core.dataIdFor(p))) continue;
      if (!open(p)) missed++;
    }
    // Every open one still on its own tables: the library itself is reached
    // through one that uses it, opened among those it records.
    if (!opened().some(({ core }) => !usesOwnMetadata(core.db))) {
      for (const p of this.config.roots) {
        if (this.cores.has(Workspaces.idFor(p))) continue;
        const o = open(p);
        if (o && !usesOwnMetadata(o.core.db)) break;
      }
    }
    if (missed > 0) {
      log.warn(
        `a write to every workspace missed ${missed} that could not be opened`,
      );
    }
    if (merged) this.syncTagIndexes();
    const cores = opened();
    const own = cores.filter(({ core }) => usesOwnMetadata(core.db));
    const shared = cores.find(({ core }) => !usesOwnMetadata(core.db));
    return shared ? [shared, ...own] : own;
  }

  /** All registered workspaces resolved to Cores, skipping any that fail to initialize. */
  allCores(): { id: string; core: Core }[] {
    const out: { id: string; core: Core }[] = [];
    for (const p of this.config.roots) {
      const core = this.coreForPath(p);
      if (core) out.push({ id: Workspaces.idFor(p), core });
    }
    return out;
  }

  /**
   * The Cores a list query should run against: every workspace when "All" is active,
   * otherwise just the active one (empty if none/failed). Search handlers use only this.
   */
  queryCores(): { id: string; core: Core }[] {
    if (this.isAll()) return this.allCores();
    // A collection has no Core of its own; never resolve "collection:xxx" as a
    // root path (Core.init would create a bogus workspace DB for it).
    if (this.isCollection()) return [];
    const core = this.active();
    return core && this.activeId ? [{ id: this.activeId, core }] : [];
  }

  /** Workspace ID → registered root path. */
  pathOf(id: string): string | null {
    return this.config.roots.find((p) => Workspaces.idFor(p) === id) ?? null;
  }

  /** The active Core (null if none selected). */
  active(): Core | null {
    // "All" and collections are virtual: they have no Core of their own, and
    // their activePath is not a real root path (resolving it via coreForPath
    // would make Core.init create a bogus workspace DB).
    if (!this.config.activePath || this.isAll() || this.isCollection())
      return null;
    return this.coreForPath(this.config.activePath);
  }

  /** Get a Core by ID (opening it if needed). Returns null for unregistered IDs. */
  byId(id: string): Core | null {
    const p = this.pathOf(id);
    return p ? this.coreForPath(p) : null;
  }

  /** The active workspace's initialization error (if any). "All" has none of its own. */
  initError(): string | null {
    if (
      !this.config.activePath ||
      this.config.activePath === ALL_ID ||
      this.isCollection()
    )
      return null;
    return (
      this.errors.get(Workspaces.idFor(this.config.activePath))?.message ?? null
    );
  }

  /** A broad classification for the active workspace's initialization error. */
  initErrorKind(): InitErrorKind | null {
    if (
      !this.config.activePath ||
      this.config.activePath === ALL_ID ||
      this.isCollection()
    )
      return null;
    return (
      this.errors.get(Workspaces.idFor(this.config.activePath))?.kind ?? null
    );
  }

  /** Register a root and return its normalized path (duplicates are ignored). */
  add(p: string): string {
    return this.addRoot(p).path;
  }

  /**
   * Register a root, reporting whether it was new. `path` is the stored
   * (normalized) path: for a folder already registered, the stored casing.
   */
  addRoot(p: string): { path: string; added: boolean } {
    const np = normalizeDir(p);
    // Windows paths are case-insensitive; don't register the same folder
    // twice under a different casing. Return the already-registered casing so
    // callers (setActive / idFor) keep matching the stored entry.
    const existing =
      process.platform === "win32"
        ? this.config.roots.find((r) => r.toLowerCase() === np.toLowerCase())
        : this.config.roots.find((r) => r === np);
    if (existing !== undefined) return { path: existing, added: false };
    this.config.roots.push(np);
    this.persist();
    return { path: np, added: true };
  }

  /**
   * Remove a root from the list and delete its DB and thumbnails on disk.
   * The media files themselves are never touched. If active, switch to another root.
   */
  remove(p: string): void {
    const id = Workspaces.idFor(p);
    // The removal keeps the metadata, as its confirmation says. One the
    // library records complete has it there already, and its database can go
    // without being opened. Any other is opened first, so its merge runs;
    // when it cannot run (a full disk, a database that does not open), the
    // workspace is unregistered but its data directory stays, metadata and
    // all, and comes back when the folder is added again.
    const merged =
      !this.cores.has(id) && completeWorkspaceIds().has(Core.dataIdFor(p));
    const core = merged
      ? (this.cores.get(id) ?? undefined)
      : (this.coreForPath(p, { merging: true }) ?? undefined);
    const keepData =
      !merged &&
      (!core || !!core.mergeFailureReason || usesOwnMetadata(core.db));
    if (keepData) {
      log.warn(
        `removing workspace ${id} whose metadata could not be merged into the library; its data directory is kept`,
      );
    }
    this.cores.delete(id);
    this.errors.delete(id);
    this.config.roots = this.config.roots.filter((r) => r !== p);
    delete this.config.workspaceEmojis[id];
    for (const collection of this.config.collections) {
      collection.items = collection.items.filter(
        (item) => item.workspaceId !== id,
      );
    }
    if (this.config.activePath === p) {
      this.config.activePath = this.config.roots[0] ?? null;
    } else if (
      this.config.activePath === ALL_ID &&
      this.config.roots.length === 0
    ) {
      // "All" is meaningless with no workspaces left.
      this.config.activePath = null;
    }
    this.persist();

    // Close the DB handle first so the files can be removed (Windows locks open files).
    const dir = core?.dataDir ?? dataDirForRoot(Core.resolveRoot(p));
    core?.close();
    if (keepData) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      log.error(`Failed to delete workspace data at ${dir}:`, e);
    }
  }

  addCollection(name: string, emoji?: string): UserCollectionConfig {
    const now = nowUnix();
    const collection: UserCollectionConfig = {
      id: randomUUID(),
      name: name.trim(),
      emoji: emoji?.trim() || undefined,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    this.config.collections.unshift(collection);
    this.config.activePath = collectionTarget(collection.id);
    this.persist();
    return collection;
  }

  /**
   * Whether a collection is built-in and therefore protected from delete/rename/
   * reorder/re-icon. Enforced here rather than only in the renderer: a stale
   * renderer build or a bug in the menu-hiding logic must not be able to remove
   * or reposition Watch Later.
   */
  private isLocked(id: string): boolean {
    return this.config.collections.find((c) => c.id === id)?.locked === true;
  }

  /** Whether the collection was removed: false for a locked or unknown one. */
  removeCollection(id: string): boolean {
    if (this.isLocked(id)) return false;
    const before = this.config.collections.length;
    this.config.collections = this.config.collections.filter(
      (c) => c.id !== id,
    );
    if (this.config.collections.length === before) return false;
    if (this.config.activePath === collectionTarget(id)) {
      // "All" is only valid with at least one registered workspace (same invariant
      // bootstrap() enforces); fall back to null when nothing is registered.
      this.config.activePath = this.config.roots.length > 0 ? ALL_ID : null;
    }
    this.persist();
    return true;
  }

  /** Set (or clear, when emoji is null/empty) a collection's emoji icon. */
  setCollectionEmoji(id: string, emoji: string | null): void {
    if (this.isLocked(id)) return;
    const collection = this.config.collections.find((c) => c.id === id);
    if (!collection) return;
    const next = emoji?.trim() || undefined;
    if (collection.emoji === next) return;
    collection.emoji = next;
    collection.updatedAt = nowUnix();
    this.persist();
  }

  /** Rename a collection. No-op when the collection is missing or the name is unchanged/empty. */
  renameCollection(id: string, name: string): void {
    if (this.isLocked(id)) return;
    const collection = this.config.collections.find((c) => c.id === id);
    if (!collection) return;
    const next = name.trim();
    if (!next || collection.name === next) return;
    collection.name = next;
    collection.updatedAt = nowUnix();
    this.persist();
  }

  /** Set (or clear, when emoji is null/empty) a registered workspace's emoji icon. */
  setWorkspaceEmoji(id: string, emoji: string | null): void {
    const next = emoji?.trim() || undefined;
    if ((this.config.workspaceEmojis[id] || undefined) === next) return;
    if (next) this.config.workspaceEmojis[id] = next;
    else delete this.config.workspaceEmojis[id];
    this.persist();
  }

  addToCollection(
    collectionId: string,
    workspaceId: string,
    fileId: number,
  ): void {
    const collection = this.config.collections.find(
      (c) => c.id === collectionId,
    );
    if (!collection) return;
    if (
      collection.items.some(
        (item) => item.workspaceId === workspaceId && item.fileId === fileId,
      )
    ) {
      return;
    }
    const now = nowUnix();
    // Appended, not prepended: items[] is the collection's manual play order, so
    // a new file has to land in a spot that leaves the existing order untouched.
    collection.items.push({ workspaceId, fileId, addedAt: now });
    collection.updatedAt = now;
    this.persist();
  }

  removeFromCollection(
    collectionId: string,
    workspaceId: string,
    fileId: number,
  ): void {
    const collection = this.config.collections.find(
      (c) => c.id === collectionId,
    );
    if (!collection) return;
    const next = collection.items.filter(
      (item) => item.workspaceId !== workspaceId || item.fileId !== fileId,
    );
    if (next.length === collection.items.length) return;
    collection.items = next;
    collection.updatedAt = nowUnix();
    this.persist();
  }

  /**
   * Add or remove many files at once, in one write.
   *
   * A diff, not a replacement — `op` says which direction, and files it is not
   * given are left as they are. Named for that: setCollectionMembers would read
   * as "make this the membership", which it is not.
   *
   * Collections live in config.json, which persist() rewrites whole, so driving
   * a selection through addToCollection would mean one disk write per file.
   * Returns how many files actually changed membership: adding a file already on
   * the collection is not a change, and neither is removing one that is not.
   */
  updateCollectionMembership(
    collectionId: string,
    files: { workspaceId: string; fileId: number }[],
    op: "add" | "remove",
  ): number {
    const collection = this.config.collections.find(
      (c) => c.id === collectionId,
    );
    if (!collection) return 0;
    const key = (workspaceId: string, fileId: number) =>
      `${workspaceId}:${fileId}`;
    const present = new Set(
      collection.items.map((item) => key(item.workspaceId, item.fileId)),
    );
    const now = nowUnix();
    let changed = 0;

    if (op === "add") {
      // Appended in the order given, for the same reason addToCollection
      // appends: items[] is the collection's manual play order.
      for (const { workspaceId, fileId } of files) {
        const k = key(workspaceId, fileId);
        if (present.has(k)) continue;
        present.add(k);
        collection.items.push({ workspaceId, fileId, addedAt: now });
        changed++;
      }
    } else {
      const drop = new Set(
        files.map(({ workspaceId, fileId }) => key(workspaceId, fileId)),
      );
      const next = collection.items.filter(
        (item) => !drop.has(key(item.workspaceId, item.fileId)),
      );
      changed = collection.items.length - next.length;
      collection.items = next;
    }

    if (changed === 0) return 0;
    collection.updatedAt = now;
    this.persist();
    return changed;
  }

  /**
   * Drop a file from the built-in Watch Later collection. Called wherever a
   * play is recorded (the `file_record_play` and `open_external` IPC handlers:
   * the in-app player's first `play` event, opening in an external player, and
   * an image's detail view, since images have no player and a view already
   * counts as a play): "watch later" means "not watched yet", so playing an
   * entry is what takes it off the list. Merely opening a video's detail view
   * without starting playback leaves it listed. Only the Watch Later
   * membership changes — the file itself and every other collection are left
   * alone.
   *
   * Callers deliberately do not broadcast workspace:changed for this: refetching
   * the list while the detail view is open would drop the file being viewed out
   * of the prev/next order. The renderer refreshes on close instead. The boolean
   * return reports whether the file was actually listed (used by tests).
   */
  removeFromWatchLater(workspaceId: string, fileId: number): boolean {
    const watchLater = this.config.collections.find(
      (c) => c.id === WATCH_LATER_ID,
    );
    if (!watchLater) return false;
    const next = watchLater.items.filter(
      (item) => item.workspaceId !== workspaceId || item.fileId !== fileId,
    );
    if (next.length === watchLater.items.length) return false;
    watchLater.items = next;
    watchLater.updatedAt = nowUnix();
    this.persist();
    return true;
  }

  /**
   * Drop a file from every collection it belongs to. Called when the file is
   * removed from its workspace index so collections don't keep orphan refs.
   * Returns true if any collection actually changed (so the caller can skip a
   * needless workspace:changed broadcast when the file was in no collection).
   */
  removeFileFromAllCollections(workspaceId: string, fileId: number): boolean {
    const now = nowUnix();
    let changed = false;
    for (const collection of this.config.collections) {
      const next = collection.items.filter(
        (item) => item.workspaceId !== workspaceId || item.fileId !== fileId,
      );
      if (next.length !== collection.items.length) {
        collection.items = next;
        collection.updatedAt = now;
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  /**
   * Reorder registered roots to match the given workspace ID order (the "All"
   * sentinel must not be included). Any roots not listed in `ids` are kept at the
   * end in their original order. Does not change the active workspace.
   */
  reorder(ids: string[]): void {
    const byId = new Map(
      this.config.roots.map((p) => [Workspaces.idFor(p), p]),
    );
    const ordered: string[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p) {
        ordered.push(p);
        byId.delete(id);
      }
    }
    // Preserve any roots not mentioned in `ids` (robustness against stale input).
    for (const p of this.config.roots) {
      if (byId.has(Workspaces.idFor(p))) ordered.push(p);
    }
    this.config.roots = ordered;
    this.persist();
  }

  /**
   * Reorder collections to match the given ID order. Any collections not listed
   * in `ids` are kept at the end in their original order (robustness against
   * stale input). Does not change the active collection.
   */
  reorderCollections(ids: string[]): void {
    // Locked collections keep their pinned position at the front and never take
    // part in reordering, so a stale/hostile id list can't displace them.
    const locked = this.config.collections.filter((c) => c.locked);
    const byId = new Map(
      this.config.collections.filter((c) => !c.locked).map((c) => [c.id, c]),
    );
    const ordered: UserCollectionConfig[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (c) {
        ordered.push(c);
        byId.delete(id);
      }
    }
    for (const c of this.config.collections) {
      if (byId.has(c.id)) ordered.push(c);
    }
    this.config.collections = [...locked, ...ordered];
    this.persist();
  }

  /**
   * Reorder the FILES inside one collection — this array order *is* the manual
   * sort.
   *
   * The rearrangement is slot-preserving: the listed items are redistributed
   * across the positions they already occupy, and every unlisted item stays
   * exactly where it is. That matters because the renderer only ever holds a
   * window of a long collection, so it can only ever describe the order of the
   * part it has loaded; treating the rest as "everything else, at the end"
   * would fling unloaded items around. Unknown refs are ignored, and no item
   * can be added or dropped here.
   *
   * Allowed on locked collections too: the lock forbids removing/renaming/
   * re-iconing the collection itself, not arranging what is inside it.
   */
  reorderCollectionItems(
    collectionId: string,
    order: { workspaceId: string; fileId: number }[],
  ): void {
    const collection = this.config.collections.find(
      (c) => c.id === collectionId,
    );
    if (!collection) return;
    const key = (i: { workspaceId: string; fileId: number }) =>
      `${i.workspaceId}:${i.fileId}`;
    const byKey = new Map(collection.items.map((item) => [key(item), item]));

    // Resolve to real items, dropping unknown refs and repeats so the moved
    // list and the slot list stay the same length.
    const taken = new Set<string>();
    const moving: UserCollectionItemConfig[] = [];
    for (const ref of order) {
      const k = key(ref);
      if (taken.has(k)) continue;
      const item = byKey.get(k);
      if (!item) continue;
      taken.add(k);
      moving.push(item);
    }
    if (moving.length === 0) return;

    const next = collection.items.slice();
    let at = 0;
    for (let i = 0; i < next.length; i++) {
      if (taken.has(key(next[i]))) next[i] = moving[at++];
    }
    collection.items = next;
    collection.updatedAt = nowUnix();
    this.persist();
  }

  /** Switch the active workspace (accepts the "All" sentinel). */
  setActive(p: string): void {
    if (p === ALL_ID) {
      this.config.activePath = ALL_ID;
      this.persist();
      return;
    }
    const collectionId = activeCollectionId(p);
    if (collectionId) {
      if (!this.config.collections.some((c) => c.id === collectionId)) return;
      this.config.activePath = p;
      this.persist();
      return;
    }
    if (!this.config.roots.includes(p)) return;
    this.config.activePath = p;
    this.persist();
  }

  /** At startup: take in the CLI/env-var root, settle the active workspace, and pre-open it. */
  bootstrap(cliRoot: string | null): void {
    cleanupStaleTemp();
    if (cliRoot) {
      const np = this.add(cliRoot);
      this.config.activePath = np;
    }
    if (this.config.activePath === ALL_ID) {
      // "All" is valid only when at least one workspace is registered.
      if (this.config.roots.length === 0) this.config.activePath = null;
    } else if (this.isCollection()) {
      if (!this.activeCollection())
        this.config.activePath = this.config.roots[0] ?? null;
    } else if (
      !this.config.activePath ||
      !this.config.roots.includes(this.config.activePath)
    ) {
      this.config.activePath = this.config.roots[0] ?? null;
    }
    this.persist();
    // The workspaces the library has no record of may still hold their own
    // metadata (the first launch after the upgrade). Their merge is left to
    // mergePending, which runs once the window can show it.
    const recorded = completeWorkspaceIds();
    // One with no database yet has nothing to merge: it starts on the library.
    const pending = this.config.roots.filter(
      (p) =>
        !recorded.has(Core.dataIdFor(p)) &&
        fs.existsSync(dbPathForDataDir(dataDirForRoot(Core.resolveRoot(p)))),
    );
    if (pending.length > 0) {
      this.merge = { pending, done: 0, total: pending.length };
    }
    // Pre-open the active workspace (the virtual "All" has no Core of its own).
    if (
      this.config.activePath &&
      this.config.activePath !== ALL_ID &&
      !this.isCollection() &&
      !pending.includes(this.config.activePath)
    ) {
      this.coreForPath(this.config.activePath);
    }
  }

  /**
   * Delete the copies workspaces took of themselves before moving their
   * metadata into the library (library.ts, writeBackup), once a copy of the
   * library taken after them holds what they guarded: `copiedAt` is when that
   * copy was taken (ms). Only for a workspace the library records as merged;
   * until then its copy is the one way back. Never throws.
   */
  dropCoveredBackups(copiedAt: number | null): void {
    if (copiedAt === null) return;
    const recorded = completeWorkspaceIds();
    for (const p of this.config.roots) {
      if (!recorded.has(Core.dataIdFor(p))) continue;
      const backup = backupDbPathForDataDir(
        dataDirForRoot(Core.resolveRoot(p)),
      );
      try {
        if (fs.statSync(backup).mtimeMs < copiedAt) {
          fs.rmSync(backup, { force: true });
        }
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          log.warn(`could not delete the backup ${backup}:`, e);
        }
      }
    }
  }

  /** How far the merge of workspaces into the library has got, while one is
   *  due or running (see mergePending); null otherwise. */
  mergeProgress(): LibraryMergeProgress | null {
    return this.merge
      ? { done: this.merge.done, total: this.merge.total }
      : null;
  }

  /**
   * Open, one at a time, the workspaces bootstrap found the library has no
   * record of, so each merges its metadata into it (Core.init). Between two,
   * control goes back to the event loop, so the window can show how far it
   * has got (`onProgress`). Returns the workspaces whose metadata could not be
   * merged, and why: they keep working on their own tables, and the next
   * launch, or retryMerge, tries again.
   */
  async mergePending(
    onProgress: (progress: LibraryMergeProgress) => void,
  ): Promise<LibraryMergeFailure[]> {
    const merge = this.merge;
    if (!merge) return [];
    const failed: PendingFailure[] = [];
    this.mergedLast = 0;
    try {
      for (const p of merge.pending) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        // Quitting: what is left merges at the next launch.
        if (this.closed) break;
        // Removed meanwhile: opening it would bring its directory back.
        if (!this.config.roots.includes(p)) {
          merge.done++;
          continue;
        }
        const core = this.coreForPath(p, { merging: true });
        if (core?.mergedOnOpen) this.mergedLast++;
        if (!core) failed.push({ path: p, reason: "open" });
        // Still on its own tables, or merged from its backup without success
        // (it has no own tables then, and its backup is all that is left).
        else if (core.mergeFailureReason || usesOwnMetadata(core.db)) {
          failed.push({ path: p, reason: core.mergeFailureReason ?? "merge" });
        }
        merge.done++;
        onProgress({ done: merge.done, total: merge.total });
      }
    } finally {
      // Whatever happened, the window is not held: what was not merged is
      // opened, and merged, when something reaches it.
      this.merge = null;
    }
    // Opened only to merge: the view reopens what it needs. The active one,
    // and every one when the view spans them, stay.
    if (!this.isAll() && !this.isCollection()) {
      for (const p of merge.pending) {
        if (p !== this.config.activePath) this.evict(Workspaces.idFor(p));
      }
    }
    // The tags the merges changed reach the indexes of what stays open.
    this.syncTagIndexes();
    this.mergeFailed = failed;
    return this.mergeFailures();
  }

  /** How many workspaces the last merge moved into the library: none (all
   *  failed, or were on it already) leaves it as it was. */
  mergedInLastRun(): number {
    return this.mergedLast;
  }

  /** The workspaces the last merge could not merge (still registered), and why. */
  mergeFailures(): LibraryMergeFailure[] {
    const labels = new Map(this.list().map((w) => [w.path, w.label]));
    return this.mergeFailed.flatMap(({ path: p, reason }) => {
      const label = labels.get(p);
      return label === undefined ? [] : [{ label, reason }];
    });
  }

  /**
   * Start trying the workspaces the last merge could not merge again: they
   * are pending once more (mergeProgress), so the window shows the merge from
   * now on and nothing but the merge reopens them. Returns their ids, for the
   * caller to stop whatever writes into them (main's retryLibraryMerge), then
   * call retryMerge, or cancelRetry if it cannot; null when there is nothing
   * to retry or a merge is already running.
   */
  beginRetry(): string[] | null {
    if (this.merge || this.closed) return null;
    const pending = this.mergeFailed
      .map(({ path: p }) => p)
      .filter((p) => this.config.roots.includes(p));
    if (pending.length === 0) return null;
    this.merge = { pending, done: 0, total: pending.length };
    return pending.map((p) => Workspaces.idFor(p));
  }

  /** Give up the retry beginRetry started: the failures stand as they were. */
  cancelRetry(): void {
    this.merge = null;
  }

  /**
   * Merge the workspaces beginRetry made pending again, the way mergePending
   * does at startup: each is closed if it is open, so opening it again runs
   * its merge. Null when beginRetry has not started a retry.
   */
  async retryMerge(
    onProgress: (progress: LibraryMergeProgress) => void,
  ): Promise<LibraryMergeFailure[] | null> {
    if (!this.merge) return null;
    for (const p of this.merge.pending) {
      const id = Workspaces.idFor(p);
      this.evict(id);
      // Opened afresh: its last error no longer stands.
      this.errors.delete(id);
    }
    return this.mergePending(onProgress);
  }

  /** Close a workspace's Core and drop it from the cache; the next access
   *  opens it again (Core.init). */
  private evict(id: string): void {
    this.cores.get(id)?.close();
    this.cores.delete(id);
  }

  private coreForPath(
    p: string,
    { merging = false }: { merging?: boolean } = {},
  ): Core | null {
    const id = Workspaces.idFor(p);
    const cached = this.cores.get(id);
    if (cached) return cached;
    if (this.closed) return null;
    // Waits for mergePending (see `merge`): skipped for now, as a workspace
    // that cannot be opened is.
    if (!merging && this.merge?.pending.includes(p)) return null;
    try {
      const core = Core.init(p, libraryDbPath());
      this.cores.set(id, core);
      this.errors.delete(id);
      // Core.init has caught this workspace's own index up. Merging its
      // metadata into the library (on its first open after the upgrade) may
      // have changed tags the other open workspaces index. A running
      // mergePending does that once, after the last one, rather than after
      // each.
      if (core.mergedOnOpen && !this.merge && this.holdingTagSync === 0) {
        this.syncTagIndexes();
      }
      return core;
    } catch (e) {
      const message = String(e);
      this.errors.set(id, {
        message,
        kind: isSchemaMismatchError(message) ? "schema_mismatch" : "unknown",
      });
      return null;
    }
  }
}

/** The workspaces the library records as merged and complete, read without
 *  opening any workspace. Empty when the library cannot be read. */
function completeWorkspaceIds(): Set<string> {
  const library = openLibraryReadonly(libraryDbPath());
  if (!library) return new Set();
  try {
    return recordedWorkspaceIds(library);
  } finally {
    library.close();
  }
}

function activeCollectionId(activePath: string | null): string | null {
  return activePath?.startsWith(COLLECTION_ID_PREFIX)
    ? activePath.slice(COLLECTION_ID_PREFIX.length)
    : null;
}

function isSchemaMismatchError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "no such column",
    "no such table",
    "has no column named",
    "database schema has changed",
    "malformed database schema",
    "sqlite_schema",
    "sqlite_master",
  ].some((needle) => normalized.includes(needle));
}
