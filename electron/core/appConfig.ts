// Application-wide settings: the registered workspaces (scan roots) and the
// active one, collections, and the app's own preferences. Each root's artifacts
// are separated into per-root directories, so what crosses them is kept here.
// Stored in the shared library (`app_settings`, db.ts), which gives them its
// backups, check and restore (libraryBackup.ts); `config.json`, where they
// used to live, is imported once and then left alone.
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
import { errorCode, openSettingsDb, type DB } from "./db.js";
import log from "./logger.js";
import { libraryDbPath } from "./paths.js";

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

/** Where the settings lived before they moved into the library. */
function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

// Every field of AppConfig, each one row of app_settings (db.ts). A Record so
// a field AppConfig gains has to be named here too.
const FIELD_SET: Record<keyof AppConfig, true> = {
  roots: true,
  activePath: true,
  collections: true,
  workspaceEmojis: true,
  update: true,
  logo: true,
  autoTag: true,
  customCss: true,
  cssTheme: true,
};
const FIELDS = Object.keys(FIELD_SET) as (keyof AppConfig)[];

/** The row that records config.json as imported (see openStore); never a field. */
export const IMPORTED_KEY = "_config_json_imported_at";

/**
 * What went wrong reading the settings at startup, for the renderer to tell
 * the user (app_status.configProblem):
 * - "moved-aside": config.json, imported on the first launch after the
 *   settings moved into the library, could not be parsed, so it was renamed to
 *   `config.json.corrupt-<time>` and the app started from defaults.
 * - "unreadable": the library could not be opened, or config.json exists but
 *   could not be read (locked, no permission) or moved aside, so the app runs
 *   on defaults and writes no setting until the next launch.
 */
let configProblem: ConfigProblem | null = null;
// The last settings read or saved successfully, served while a later read
// fails (an update check would otherwise lose its throttle, and so on).
let lastGood: AppConfig | null = null;
// The connection to the library the settings are read from; `db` is null when
// they could not be read at startup, and nothing is written for the session.
// Opened again when the library's path changes, which only tests do.
let store: { file: string; db: DB | null } | null = null;

export function configLoadProblem(): ConfigProblem | null {
  settingsDb();
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

function settingsDb(): DB | null {
  const file = libraryDbPath();
  if (store?.file !== file) {
    store?.db?.close();
    configProblem = null;
    lastGood = null;
    store = { file, db: openStore(file) };
  }
  return store.db;
}

/**
 * Open the settings in the library, importing config.json the first time.
 * Null when they cannot be read, with configProblem set: the app then runs on
 * defaults rather than write them over what it could not read.
 */
function openStore(file: string): DB | null {
  let db: DB;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = openSettingsDb(file);
  } catch (e) {
    log.error("the settings could not be read from the library", e);
    configProblem = "unreadable";
    return null;
  }
  try {
    const imported =
      db
        .prepare("SELECT 1 FROM app_settings WHERE key = ?")
        .get(IMPORTED_KEY) !== undefined;
    if (imported || importConfigJson(db)) return db;
  } catch (e) {
    log.error("the settings could not be imported into the library", e);
    configProblem = "unreadable";
  }
  db.close();
  return null;
}

/**
 * Bring config.json's settings into the library, once: recorded in the same
 * transaction, after which config.json is never read again. The file is left
 * where it is, for an older version of the app to start from. False when it
 * exists but cannot be read now: tried again on the next launch.
 *
 * A library put back from a copy taken before the import has no record of it,
 * and imports config.json again, which has not changed since.
 */
function importConfigJson(db: DB): boolean {
  const config = readConfigJson();
  if (config === null) return false;
  db.transaction(() => {
    writeFields(db, config, FIELDS);
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(
      IMPORTED_KEY,
      JSON.stringify(Date.now()),
    );
  })();
  if (fs.existsSync(configPath())) {
    log.info("moved the settings from config.json into the library");
  }
  return true;
}

/**
 * config.json's settings, defaults when there is none (a first launch) or it
 * could not be parsed and was moved aside, or null when it cannot be read or
 * moved aside (configProblem says which).
 */
function readConfigJson(): AppConfig | null {
  const file = configPath();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return defaultConfig();
    log.error(
      `config.json could not be read (${code ?? "unknown"}); not importing it`,
    );
    configProblem = "unreadable";
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return parseConfig(parsed as Record<string, unknown>);
  } catch {
    // Kept for recovery, out of the way. The parse error is not logged: its
    // message quotes the file's text, and that holds folder names.
    const aside = `${file}.corrupt-${fileTimestamp(new Date())}`;
    try {
      fs.renameSync(file, aside);
      log.error(
        `config.json could not be parsed; moved it to ${path.basename(aside)}`,
      );
      configProblem = "moved-aside";
      return defaultConfig();
    } catch (moveErr) {
      const code = (moveErr as NodeJS.ErrnoException).code;
      log.error(
        `config.json could not be parsed or moved aside (${code ?? "unknown"}); not importing it`,
      );
      configProblem = "unreadable";
      return null;
    }
  }
}

/** The settings as stored: field by field, so one that does not validate
 *  falls back to its default without taking the others with it. */
function parseConfig(c: Record<string, unknown>): AppConfig {
  return {
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
}

function readStored(db: DB): AppConfig {
  const values: Record<string, unknown> = {};
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as {
    key: string;
    value: string;
  }[];
  for (const { key, value } of rows) {
    try {
      values[key] = JSON.parse(value);
    } catch {
      log.warn(`the setting ${key} could not be parsed; using its default`);
    }
  }
  return parseConfig(values);
}

function writeFields(
  db: DB,
  config: AppConfig,
  keys: readonly (keyof AppConfig)[],
): void {
  const put = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const key of keys) put.run(key, JSON.stringify(config[key]));
}

/** An error from SQLite (locked, disk full, …), as opposed to a bug. */
const isSqliteError = (e: unknown) =>
  errorCode(e)?.startsWith("SQLITE_") === true;

export function loadConfig(): AppConfig {
  const db = settingsDb();
  if (db === null) return defaultConfig();
  try {
    const config = readStored(db);
    lastGood = structuredClone(config);
    return config;
  } catch (e) {
    if (!isSqliteError(e)) throw e;
    log.warn("the settings could not be read", e);
    return lastGood ? structuredClone(lastGood) : defaultConfig();
  }
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
 * Remove any leftover `config.json.<pid>.tmp` files from a run of a version
 * that still wrote config.json and crashed between writeFileSync and
 * renameSync. Safe to call at startup; the single-instance lock means no other
 * process is mid-write.
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

/**
 * Replace every setting with `c`. Only for a whole configuration: a change
 * goes through updateConfig, so it cannot revert what another owner wrote.
 */
export function saveConfig(c: AppConfig): void {
  const db = settingsDb();
  if (db === null) return; // see openStore
  try {
    db.transaction(() => writeFields(db, c, FIELDS))();
    lastGood = structuredClone(c);
  } catch (e) {
    if (!isSqliteError(e)) throw e;
    log.error("saveConfig failed", e);
  }
}

/**
 * Read-modify-write of the settings, in one transaction: `mutator` gets the
 * settings as stored, and only the fields it changed are written. A caller
 * that holds a stale snapshot across an `await` (the update checker fetching
 * over the network) cannot revert concurrent changes to unrelated fields
 * (roots, collections, …), as long as it changes only its own fields here
 * rather than spreading an old loadConfig() result into saveConfig.
 *
 * A write that fails (a full disk) is logged rather than thrown, so a caller
 * that must know reads the setting back (saveAutoTag).
 */
export function updateConfig(mutator: (c: AppConfig) => AppConfig): void {
  const db = settingsDb();
  if (db === null) return; // see openStore
  try {
    const next = db
      .transaction(() => {
        const current = readStored(db);
        // Taken before the mutator runs, which may change `current` in place.
        const before = FIELDS.map((k) => JSON.stringify(current[k]));
        const changed = mutator(current);
        writeFields(
          db,
          changed,
          FIELDS.filter((k, i) => JSON.stringify(changed[k]) !== before[i]),
        );
        return changed;
      })
      .immediate();
    lastGood = structuredClone(next);
  } catch (e) {
    if (!isSqliteError(e)) throw e;
    log.error("a settings change was not saved", e);
  }
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
