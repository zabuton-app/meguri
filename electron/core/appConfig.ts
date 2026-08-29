// Application-wide config (list of registered workspaces = scan roots, and the active root).
// Each root's artifacts are separated into per-root directories, so the cross-cutting list is kept here.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { LogoIdSchema, type LogoId } from "../../shared/ipc/schema.js";
import log from "./logger.js";

export interface AppConfig {
  /** Registered roots (absolute paths, normalized). */
  roots: string[];
  /** Currently active root. null if none is selected. */
  activePath: string | null;
  /** User-curated virtual folders. Items reference files by workspace ID + file ID. */
  collections: UserCollectionConfig[];
  /** Optional per-workspace emoji icon, keyed by workspace ID (hash of root path). */
  workspaceEmojis: Record<string, string>;
  /** Update-check preferences (GitHub Releases). */
  update: UpdateConfig;
  /**
   * App logo variant applied to the window and tray icons. Lives here (not in
   * the renderer's localStorage) because the tray and window are created
   * before any renderer exists, so main must be able to read it on its own.
   */
  logo: LogoId;
}

export const DEFAULT_LOGO: LogoId = "dark";

function parseLogo(value: unknown): LogoId {
  return LogoIdSchema.catch(DEFAULT_LOGO).parse(value);
}

export interface UpdateConfig {
  /** Whether to check for updates on startup. Defaults to true. */
  autoCheck: boolean;
  /** Version the user chose to skip notifications for (without leading "v"). */
  ignoredVersion: string | null;
  /** Unix ms of the last successful network check; used to throttle. */
  lastCheckAt: number | null;
}

const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  autoCheck: true,
  ignoredVersion: null,
  lastCheckAt: null,
};

export interface UserCollectionItemConfig {
  workspaceId: string;
  fileId: number;
  addedAt: number;
}

export interface UserCollectionConfig {
  id: string;
  name: string;
  /** Optional emoji icon; falls back to the folder icon when unset. */
  emoji?: string;
  items: UserCollectionItemConfig[];
  createdAt: number;
  updatedAt: number;
  /**
   * Built-in collections (currently only "Watch Later") set this. Locked
   * collections can still gain and lose files, and their files can still be
   * rearranged, but the collection itself cannot be removed, renamed, re-iconed
   * or repositioned among the collections. Absent/false on every user-created one.
   */
  locked?: boolean;
}

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function loadConfig(): AppConfig {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Record<
      string,
      unknown
    >;
    return {
      roots: Array.isArray(c.roots)
        ? c.roots.filter((x: unknown) => typeof x === "string")
        : [],
      activePath: typeof c.activePath === "string" ? c.activePath : null,
      collections: parseCollections(c.collections),
      workspaceEmojis: parseEmojiMap(c.workspaceEmojis),
      update: parseUpdateConfig(c.update),
      logo: parseLogo(c.logo),
    };
  } catch {
    return {
      roots: [],
      activePath: null,
      collections: [],
      workspaceEmojis: {},
      update: { ...DEFAULT_UPDATE_CONFIG },
      logo: DEFAULT_LOGO,
    };
  }
}

function parseUpdateConfig(value: unknown): UpdateConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_UPDATE_CONFIG };
  const c = value as Record<string, unknown>;
  return {
    autoCheck:
      typeof c.autoCheck === "boolean"
        ? c.autoCheck
        : DEFAULT_UPDATE_CONFIG.autoCheck,
    ignoredVersion:
      typeof c.ignoredVersion === "string" ? c.ignoredVersion : null,
    lastCheckAt: typeof c.lastCheckAt === "number" ? c.lastCheckAt : null,
  };
}

/**
 * Remove any leftover `config.json.<pid>.tmp` files from a previous run that
 * crashed between writeFileSync and renameSync. Safe to call at startup; the
 * single-instance lock means no other process is mid-write.
 */
export function cleanupStaleTemp(): void {
  try {
    const dir = path.dirname(configPath());
    const base = path.basename(configPath());
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${base}.`) && name.endsWith(".tmp")) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // Best-effort cleanup; ignore (e.g. dir doesn't exist yet on first run).
  }
}

export function saveConfig(c: AppConfig): void {
  try {
    const dest = configPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Write to a sibling temp file then rename so a crash mid-write can't leave a
    // truncated config.json (which would drop all workspaces and collections).
    // fsync the temp file before renaming: rename is atomic for the directory
    // entry, but without fsync a power loss can land the rename while the temp's
    // data blocks are still unflushed, leaving a 0-byte/partial config.json.
    const tmp = `${dest}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(c, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    log.error("saveConfig failed", e);
  }
}

/**
 * Atomic read-modify-write of the config. Re-reads the current file, applies
 * `mutator`, and saves — all synchronously, so callers that hold a stale
 * snapshot across an `await` (e.g. the update checker fetching over the network)
 * can't clobber concurrent changes to unrelated fields (roots, collections, …).
 * Pass an `update`-only mutation here rather than spreading an old `loadConfig()`
 * result into `saveConfig`.
 */
export function updateConfig(mutator: (c: AppConfig) => AppConfig): void {
  saveConfig(mutator(loadConfig()));
}

/** Normalize a path (realpath, falling back to resolve on failure). */
export function normalizeDir(p: string): string {
  let normalized: string;
  try {
    normalized = fs.realpathSync(p);
  } catch {
    normalized = path.resolve(p);
  }
  // Windows drive letters are case-insensitive ("c:\x" === "C:\x") but the
  // workspace id is a hash of this string, so a casing difference would split
  // the same folder into two workspaces. Canonicalize to uppercase.
  if (process.platform === "win32") {
    normalized = normalized.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
  }
  return normalized;
}

function parseCollections(value: unknown): UserCollectionConfig[] {
  if (!Array.isArray(value)) return [];
  const out: UserCollectionConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.name !== "string") continue;
    const items: UserCollectionItemConfig[] = [];
    if (Array.isArray(c.items)) {
      for (const itemRaw of c.items) {
        if (!itemRaw || typeof itemRaw !== "object") continue;
        const item = itemRaw as Record<string, unknown>;
        if (
          typeof item.workspaceId !== "string" ||
          typeof item.fileId !== "number"
        )
          continue;
        items.push({
          workspaceId: item.workspaceId,
          fileId: item.fileId,
          addedAt: typeof item.addedAt === "number" ? item.addedAt : 0,
        });
      }
    }
    out.push({
      id: c.id,
      name: c.name,
      emoji: typeof c.emoji === "string" && c.emoji ? c.emoji : undefined,
      items,
      createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
      updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
      ...(c.locked === true ? { locked: true } : {}),
    });
  }
  return out;
}

function parseEmojiMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}
