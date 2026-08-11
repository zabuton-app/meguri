// Workspace (scan root) management. In addition to persisting the config, it caches
// Core per workspace ID (the hash of the root path) so any workspace can be resolved
// by ID. The media server uses this to serve without depending on the active workspace.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Core } from "./index.js";
import {
  loadConfig,
  saveConfig,
  cleanupStaleTemp,
  normalizeDir,
  type AppConfig,
  type UserCollectionConfig,
} from "./appConfig.js";
import { dataDirForRoot, pathHash } from "./paths.js";
import log from "./logger.js";
import { nowUnix } from "./db.js";

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
  collectionTarget,
} from "../../shared/workspaceIds.js";
import {
  ALL_ID,
  COLLECTION_ID_PREFIX,
  collectionTarget,
} from "../../shared/workspaceIds.js";

export type InitErrorKind = "schema_mismatch" | "unknown";

interface WorkspaceInitError {
  message: string;
  kind: InitErrorKind;
}

export class Workspaces {
  private config: AppConfig;
  private cores = new Map<string, Core>();
  private errors = new Map<string, WorkspaceInitError>();

  constructor() {
    this.config = loadConfig();
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
    const np = normalizeDir(p);
    // Windows paths are case-insensitive; don't register the same folder
    // twice under a different casing. Return the already-registered casing so
    // callers (setActive / idFor) keep matching the stored entry.
    const existing =
      process.platform === "win32"
        ? this.config.roots.find((r) => r.toLowerCase() === np.toLowerCase())
        : this.config.roots.find((r) => r === np);
    if (existing !== undefined) return existing;
    this.config.roots.push(np);
    saveConfig(this.config);
    return np;
  }

  /**
   * Remove a root from the list and delete its DB and thumbnails on disk.
   * The media files themselves are never touched. If active, switch to another root.
   */
  remove(p: string): void {
    const id = Workspaces.idFor(p);
    const core = this.cores.get(id);
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
    saveConfig(this.config);

    // Close the DB handle first so the files can be removed (Windows locks open files).
    const dir = core?.dataDir ?? dataDirForRoot(p);
    core?.close();
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
    saveConfig(this.config);
    return collection;
  }

  removeCollection(id: string): void {
    this.config.collections = this.config.collections.filter(
      (c) => c.id !== id,
    );
    if (this.config.activePath === collectionTarget(id)) {
      // "All" is only valid with at least one registered workspace (same invariant
      // bootstrap() enforces); fall back to null when nothing is registered.
      this.config.activePath = this.config.roots.length > 0 ? ALL_ID : null;
    }
    saveConfig(this.config);
  }

  /** Set (or clear, when emoji is null/empty) a collection's emoji icon. */
  setCollectionEmoji(id: string, emoji: string | null): void {
    const collection = this.config.collections.find((c) => c.id === id);
    if (!collection) return;
    const next = emoji?.trim() || undefined;
    if (collection.emoji === next) return;
    collection.emoji = next;
    collection.updatedAt = nowUnix();
    saveConfig(this.config);
  }

  /** Rename a collection. No-op when the collection is missing or the name is unchanged/empty. */
  renameCollection(id: string, name: string): void {
    const collection = this.config.collections.find((c) => c.id === id);
    if (!collection) return;
    const next = name.trim();
    if (!next || collection.name === next) return;
    collection.name = next;
    collection.updatedAt = nowUnix();
    saveConfig(this.config);
  }

  /** Set (or clear, when emoji is null/empty) a registered workspace's emoji icon. */
  setWorkspaceEmoji(id: string, emoji: string | null): void {
    const next = emoji?.trim() || undefined;
    if ((this.config.workspaceEmojis[id] || undefined) === next) return;
    if (next) this.config.workspaceEmojis[id] = next;
    else delete this.config.workspaceEmojis[id];
    saveConfig(this.config);
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
    collection.items.unshift({ workspaceId, fileId, addedAt: now });
    collection.updatedAt = now;
    saveConfig(this.config);
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
    saveConfig(this.config);
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
    if (changed) saveConfig(this.config);
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
    saveConfig(this.config);
  }

  /**
   * Reorder collections to match the given ID order. Any collections not listed
   * in `ids` are kept at the end in their original order (robustness against
   * stale input). Does not change the active collection.
   */
  reorderCollections(ids: string[]): void {
    const byId = new Map(this.config.collections.map((c) => [c.id, c]));
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
    this.config.collections = ordered;
    saveConfig(this.config);
  }

  /** Switch the active workspace (accepts the "All" sentinel). */
  setActive(p: string): void {
    if (p === ALL_ID) {
      this.config.activePath = ALL_ID;
      saveConfig(this.config);
      return;
    }
    const collectionId = activeCollectionId(p);
    if (collectionId) {
      if (!this.config.collections.some((c) => c.id === collectionId)) return;
      this.config.activePath = p;
      saveConfig(this.config);
      return;
    }
    if (!this.config.roots.includes(p)) return;
    this.config.activePath = p;
    saveConfig(this.config);
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
    saveConfig(this.config);
    // Pre-open the active workspace (the virtual "All" has no Core of its own).
    if (
      this.config.activePath &&
      this.config.activePath !== ALL_ID &&
      !this.isCollection()
    ) {
      this.coreForPath(this.config.activePath);
    }
  }

  private coreForPath(p: string): Core | null {
    const id = Workspaces.idFor(p);
    const cached = this.cores.get(id);
    if (cached) return cached;
    try {
      const core = Core.init(p);
      this.cores.set(id, core);
      this.errors.delete(id);
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
