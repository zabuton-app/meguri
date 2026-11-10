// Application-wide config (list of registered workspaces = scan roots, and the active root).
// Each root's artifacts are separated into per-root directories, so the cross-cutting list is kept here.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  AutoTagFolderSchema,
  AutoTagKeywordSchema,
  AutoTagRuleSchema,
  LogoIdSchema,
  type LogoId,
  type ConfigProblem,
} from "../../shared/ipc/schema.js";
import {
  MAX_AUTO_TAG_KEYWORD_TERMS,
  MAX_AUTO_TAG_KEYWORDS,
  MAX_AUTO_TAG_FOLDER_RULES,
  MAX_AUTO_TAG_RULES,
  MAX_AUTO_TAG_TERMS,
  defaultAutoTagConfig,
  type AutoTagConfig,
} from "../../shared/autoTag.js";
import { MAX_TAG_NAME } from "../../shared/tags.js";
import { autoTagSettingsChanged, autoTagSettingsVersion } from "./autoTag.js";
import { isThemeFileName } from "./cssThemes.js";
import type { AutoTagEngine } from "./autoTagDeriver.js";
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
  /** Auto-tagging rules and dictionary, shared by every workspace (shared/autoTag.ts). */
  autoTag: AutoTagConfig;
  /**
   * User stylesheet (<userData>/custom.css). Lives here rather than in the
   * renderer's localStorage because main owns the file watcher, which runs
   * only while this is on.
   */
  customCss: CustomCssConfig;
  /**
   * File name of the CSS theme picked from <userData>/themes, or null for
   * none. Main reads it to send the theme's contents with the list.
   */
  cssTheme: string | null;
}

export interface CustomCssConfig {
  /** Whether custom.css is applied. Off until the user turns it on. */
  enabled: boolean;
}

const DEFAULT_CUSTOM_CSS_CONFIG: CustomCssConfig = { enabled: false };

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

/**
 * What went wrong reading config.json at startup, for the renderer to tell the
 * user (app_status.configProblem):
 * - "moved-aside": it could not be parsed, so it was renamed to
 *   `config.json.corrupt-<time>` and the app started from defaults.
 * - "unreadable": it exists but could not be read (locked, no permission), or
 *   could not be moved aside, so the app runs on defaults and does not write
 *   over it until the next launch.
 */
let configProblem: ConfigProblem | null = null;
// Whether config.json has been read since launch. Until it has, a file that
// cannot be read blocks writes for the session: the in-memory state (e.g. the
// workspaces) started from defaults, and saving it would replace the real file.
// After it has, a read that fails is a passing lock, and only that save is
// skipped (see updateConfig).
let loadedOnce = false;
// The last config read or saved successfully, served while a later read fails.
let lastGood: AppConfig | null = null;

export function configLoadProblem(): ConfigProblem | null {
  return configProblem;
}

function defaultConfig(): AppConfig {
  return {
    roots: [],
    activePath: null,
    collections: [],
    workspaceEmojis: {},
    update: { ...DEFAULT_UPDATE_CONFIG },
    logo: DEFAULT_LOGO,
    autoTag: defaultAutoTagConfig(),
    customCss: { ...DEFAULT_CUSTOM_CSS_CONFIG },
    cssTheme: null,
  };
}

export function loadConfig(): AppConfig {
  // While a read fails mid-session, readers get what was last read rather than
  // defaults (an update check would otherwise lose its throttle, and so on).
  return (
    readConfig() ?? (lastGood ? structuredClone(lastGood) : defaultConfig())
  );
}

/** The config, or null when config.json exists but could not be read now. */
function readConfig(): AppConfig | null {
  // Blocked for the session: keep to the defaults the app started from.
  if (configProblem === "unreadable") return defaultConfig();
  const file = configPath();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // First launch, or moved aside: a known state, and an empty config.
      loadedOnce = true;
      lastGood = defaultConfig();
      return defaultConfig();
    }
    if (loadedOnce) {
      log.warn(`config.json could not be read (${code ?? "unknown"})`);
      return null;
    }
    log.error(
      `config.json could not be read (${code ?? "unknown"}); not writing over it`,
    );
    configProblem = "unreadable";
    return defaultConfig();
  }
  let c: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    c = parsed as Record<string, unknown>;
  } catch {
    // Unparsable mid-session: caught half-written by something else (a hand
    // edit, a sync tool). The state in memory came from a good read, so treat
    // it like a read that failed rather than as damage.
    if (loadedOnce) {
      log.warn("config.json could not be parsed");
      return null;
    }
    // Unparsable at startup: keep it for recovery, out of the way of the saves
    // to come. The parse error is not logged: its message quotes the file's
    // text, and that holds folder names.
    const aside = `${file}.corrupt-${fileTimestamp(new Date())}`;
    try {
      fs.renameSync(file, aside);
      log.error(
        `config.json could not be parsed; moved it to ${path.basename(aside)}`,
      );
      configProblem = "moved-aside";
    } catch (moveErr) {
      const code = (moveErr as NodeJS.ErrnoException).code;
      log.error(
        `config.json could not be parsed or moved aside (${code ?? "unknown"}); not writing over it`,
      );
      configProblem = "unreadable";
    }
    loadedOnce = true;
    lastGood = defaultConfig();
    return defaultConfig();
  }
  loadedOnce = true;
  const config: AppConfig = {
    roots: Array.isArray(c.roots)
      ? c.roots.filter((x: unknown) => typeof x === "string")
      : [],
    activePath: typeof c.activePath === "string" ? c.activePath : null,
    collections: parseCollections(c.collections),
    workspaceEmojis: parseEmojiMap(c.workspaceEmojis),
    update: parseUpdateConfig(c.update),
    logo: parseLogo(c.logo),
    autoTag: parseAutoTag(c.autoTag),
    customCss: parseCustomCss(c.customCss),
    cssTheme: parseCssTheme(c.cssTheme),
  };
  lastGood = structuredClone(config);
  return config;
}

/** 2026-11-10T12:00:00.000Z → 20261110-120000, safe in a file name. */
function fileTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function parseCssTheme(value: unknown): string | null {
  return typeof value === "string" && isThemeFileName(value) ? value : null;
}

function parseCustomCss(value: unknown): CustomCssConfig {
  if (!value || typeof value !== "object")
    return { ...DEFAULT_CUSTOM_CSS_CONFIG };
  const c = value as Record<string, unknown>;
  return { enabled: c.enabled === true };
}

/**
 * Entry by entry, like the other fields here: one rule that stopped validating
 * must not take the rest of the configuration with it. A config that has never
 * held the key gets the built-in rules; an emptied list stays empty.
 */
function parseAutoTag(value: unknown): AutoTagConfig {
  if (!value || typeof value !== "object") return defaultAutoTagConfig();
  const c = value as Record<string, unknown>;
  const list = <T>(
    raw: unknown,
    max: number,
    parse: (item: unknown) => T | undefined,
  ): T[] => {
    if (!Array.isArray(raw)) return [];
    const out: T[] = [];
    for (const item of raw.slice(0, max)) {
      const parsed = parse(item);
      if (parsed !== undefined) out.push(parsed);
    }
    return out;
  };
  const term = (item: unknown): string | undefined =>
    typeof item === "string" && item !== "" && item.length <= MAX_TAG_NAME
      ? item
      : undefined;
  return {
    rules: list(
      c.rules,
      MAX_AUTO_TAG_RULES,
      (item) => AutoTagRuleSchema.safeParse(item).data,
    ),
    keywords: list(
      c.keywords,
      MAX_AUTO_TAG_KEYWORDS,
      (item) => AutoTagKeywordSchema.safeParse(keywordFromLegacy(item)).data,
    ),
    // Absent from a configuration written before folder rules existed.
    folders: list(
      c.folders,
      MAX_AUTO_TAG_FOLDER_RULES,
      (item) => AutoTagFolderSchema.safeParse(item).data,
    ),
    // Off only when the user turned it off.
    applyOnScan: c.applyOnScan !== false,
    ignored: list(c.ignored, MAX_AUTO_TAG_TERMS, term),
    // excludedTerms, which an earlier configuration may hold, is no longer
    // read: nothing edited it, and of its defaults STOP_WORDS holds the ones
    // a suggestion could be (公式 never was: suggestions are ASCII words).
  };
}

/**
 * A keyword entry written before an entry had tags of its own, brought to
 * the current shape: its one tag was also the first of its terms, the aliases
 * the rest — one more than the terms may hold, so the last alias goes.
 */
function keywordFromLegacy(item: unknown): unknown {
  if (!item || typeof item !== "object" || "terms" in item) return item;
  const { tag, aliases, ...rest } = item as Record<string, unknown>;
  if (typeof tag !== "string") return item;
  const terms = [
    tag,
    ...(Array.isArray(aliases) ? (aliases as unknown[]) : []),
  ];
  return {
    ...rest,
    terms: terms.slice(0, MAX_AUTO_TAG_KEYWORD_TERMS),
    tags: [tag],
  };
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
  if (configProblem === "unreadable") return; // see readConfig
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
    lastGood = structuredClone(c); // what the file now holds
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
  const current = readConfig();
  // A read that failed mid-session (a passing lock): saving the change over
  // defaults would drop everything else, so this one change is not saved.
  if (current === null) {
    log.warn("a settings change was not saved: config.json could not be read");
    return;
  }
  saveConfig(mutator(current));
}

/**
 * The auto-tagging settings, and the version they are at: read together, so
 * a pass run with them stops once they change (see applyAutoTags).
 */
export function loadAutoTag(): { config: AutoTagConfig; version: number } {
  return { version: autoTagSettingsVersion(), config: loadConfig().autoTag };
}

/**
 * The one way the auto-tagging settings are saved: a pass under way with the
 * old ones stops — when what the engine runs on changed. Dismissing a
 * suggestion or switching the scan's tagging is no reason to start over.
 * saveConfig logs a failed write instead of throwing, so it is read back, and
 * a full disk is not reported as a successful save.
 */
export function saveAutoTag(config: AutoTagConfig): void {
  const before = engineOf(loadConfig().autoTag);
  updateConfig((c) => ({ ...c, autoTag: config }));
  if (engineOf(config) !== before) autoTagSettingsChanged();
  if (JSON.stringify(loadConfig().autoTag) !== JSON.stringify(config)) {
    throw new Error("auto-tagging settings could not be saved");
  }
}

/** The settings a pass applies, as one comparable value. */
function engineOf({ rules, keywords, folders }: AutoTagConfig): string {
  // Typed as the engine, so a field it gains has to be named here too.
  const engine: Required<AutoTagEngine> = { rules, keywords, folders };
  return JSON.stringify(engine);
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
