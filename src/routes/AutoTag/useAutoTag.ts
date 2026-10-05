// State behind the auto-tagging screen: the configuration (saved as it is
// edited), the files of the current scope, and applying / removing tags.
//
// Analysis runs here in the renderer, on the same engine the scan uses
// (shared/autoTag.ts), over the names loaded once per visit. Writes go through
// main: the screen only ever says which files get which tags.
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { groupBulkTargets } from "@/lib/bulkEdit";
import { invalidateTagCatalog } from "@/lib/queryCache";
import {
  MAX_AUTO_TAGS_PER_FILE,
  MAX_AUTO_TAG_PAIRS,
  MAX_AUTO_TAG_TERMS,
  compileEngine,
  type AutoTagAssignment,
  type AutoTagConfig,
  type AutoTagFile,
  type AutoTagLibrary,
  type CompiledEngine,
} from "@shared/autoTag";
import { STOP_WORDS } from "@shared/autoTagAnalysis";
import type { BulkTargets } from "@shared/ipc/channels";
import { MAX_BULK_FILES, MAX_BULK_TAG_NAMES } from "@shared/tags";

/**
 * `ok: false` is a failure (already reported to the user). Nothing new to add
 * is a success with zero counts — callers must be able to tell the two apart
 * before they report anything as done.
 */
export type ApplyOutcome =
  { ok: true; files: number; added: number } | { ok: false };

/** Which files share one set of tags: the copies of a file in its workspace. */
const siblingKey = (file: AutoTagFile): string =>
  `${file.workspaceId}\0${file.metaKey}`;

/** As ApplyOutcome, for taking a tag off: `files` is how many lost it. */
export type RemoveOutcome = { ok: true; files: number } | { ok: false };

export interface AutoTagState {
  config: AutoTagConfig;
  update: (fn: (config: AutoTagConfig) => AutoTagConfig) => void;
  files: AutoTagFile[];
  /** `files[i].name`, as its own array: every analysis takes just the names. */
  names: string[];
  /** Alive files in scope; more than `files.length` when only a sample loaded. */
  total: number;
  /** The user's tags in scope: lowercase → the spelling in use. */
  existing: Map<string, string>;
  /** Lowercased tags of each file. */
  fileTags: Set<string>[];
  /** Compiled from the configuration, a beat behind fast typing. */
  engine: CompiledEngine;
  /** Words never offered as tags. */
  stop: Set<string>;
  loading: boolean;
  reload: () => void;
  /** Attach tags (file position → names). Tags a file already has are skipped. */
  apply: (perFile: Map<number, string[]>) => Promise<ApplyOutcome>;
  /**
   * The previous visit never finished analyzing — a rule hung the screen. Rules
   * are left out of every analysis until the user says to try again, so the
   * rule at fault can be found and fixed.
   */
  safeMode: boolean;
  leaveSafeMode: () => void;
  /**
   * Take a tag off files (by position), whoever put it there: nothing records
   * which tags the screen applied, so this goes by what the files carry — the
   * user's own tags, which is all the screen reads and all files_bulk_tag
   * detaches. `key` is the tag lowercased; every spelling of it goes, and the
   * files' copies lose it with them.
   */
  remove: (indexes: readonly number[], key: string) => Promise<RemoveOutcome>;
  reapply: () => Promise<{ files: number; added: number } | null>;
}

const SAVE_DELAY_MS = 400;

/** Debounced writer for the configuration; `flush` sends what is waiting. */
class ConfigSaver {
  private saved: AutoTagConfig | null = null;
  private waiting: AutoTagConfig | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onError: (error: unknown) => void = () => {};

  /** What main already has: not something to write back. */
  loaded(config: AutoTagConfig): void {
    this.saved = config;
  }

  schedule(config: AutoTagConfig, onError: (error: unknown) => void): void {
    if (config === this.saved) return;
    this.waiting = config;
    this.onError = onError;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.flush().catch(() => {}),
      SAVE_DELAY_MS,
    );
  }

  /** Sends what is waiting. Rejects when the write fails, and keeps it waiting. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const config = this.waiting;
    if (!config || config === this.saved) return;
    try {
      await api.autoTagSet(config);
    } catch (error) {
      this.onError(error);
      throw error;
    }
    // Only now: a failed write is still waiting, and the next flush retries it.
    this.saved = config;
    if (this.waiting === config) this.waiting = null;
  }
}

/**
 * Set before an analysis starts and cleared once it has been drawn. Finding it
 * set on arrival means the last analysis never came back.
 */
const ANALYZING_KEY = "meguri.autoTag.analyzing";

function markAnalyzing(on: boolean): void {
  try {
    if (on) localStorage.setItem(ANALYZING_KEY, "1");
    else localStorage.removeItem(ANALYZING_KEY);
  } catch {
    // Storage unavailable: the screen works, only without the safety net.
  }
}

function wasAnalyzing(): boolean {
  try {
    return localStorage.getItem(ANALYZING_KEY) !== null;
  } catch {
    return false;
  }
}

/** Keep the newest entries of a list that the schema caps. */
function capped(list: string[]): string[] {
  return list.length > MAX_AUTO_TAG_TERMS
    ? list.slice(list.length - MAX_AUTO_TAG_TERMS)
    : list;
}

export function useAutoTag(): AutoTagState | null {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [config, setConfig] = useState<AutoTagConfig | null>(null);
  const [library, setLibrary] = useState<AutoTagLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  /** Counts completed loads of the file list. */
  const [loadedAt, setLoadedAt] = useState(0);

  const fetchLibrary = useCallback(
    () =>
      api
        .autoTagFiles()
        .then((loaded) => {
          markAnalyzing(true);
          setLibrary(loaded);
          setLoadedAt((n) => n + 1);
        })
        .catch(() => toast.error(t("autoTag.loadFailed")))
        .finally(() => setLoading(false)),
    [t],
  );
  const load = useCallback(() => {
    setLoading(true);
    void fetchLibrary();
  }, [fetchLibrary]);

  const [saver] = useState(() => new ConfigSaver());
  useEffect(() => {
    let active = true;
    api
      .autoTagGet()
      .then((loaded) => {
        if (!active) return;
        saver.loaded(loaded);
        markAnalyzing(true);
        setConfig(loaded);
      })
      .catch(() => toast.error(t("autoTag.loadFailed")));
    void fetchLibrary();
    return () => {
      active = false;
    };
  }, [fetchLibrary, saver, t]);

  // Saved as it is edited — there is no save button. This runs after the
  // render that analyzed the configuration, so a pattern that hangs the engine
  // hangs here, before it is stored, instead of on every later visit.
  useEffect(() => {
    if (!config) return;
    saver.schedule(config, (error) =>
      toast.error(t("autoTag.saveFailed"), { description: String(error) }),
    );
  }, [config, saver, t]);
  // Closing the screen inside the delay must not drop the last edit.
  useEffect(() => () => void saver.flush().catch(() => {}), [saver]);

  // Read once, before this visit's first analysis can overwrite it.
  const [safeMode, setSafeMode] = useState(wasAnalyzing);
  // Every commit means the analysis behind it came back.
  useEffect(() => markAnalyzing(false));

  const update = useCallback((fn: (config: AutoTagConfig) => AutoTagConfig) => {
    markAnalyzing(true);
    setConfig((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      // The schema caps these lists; past the cap every later save would be
      // refused, so the oldest entries make room instead.
      return {
        ...next,
        ignored: capped(next.ignored),
        excludedTerms: capped(next.excludedTerms),
      };
    });
  }, []);

  const deferred = useDeferredValue(config);
  const engine = useMemo(
    () =>
      compileEngine({
        rules: safeMode ? [] : (deferred?.rules ?? []),
        keywords: deferred?.keywords ?? [],
      }),
    // Rules and keywords only: dismissing a suggestion or renaming a rule
    // changes the configuration, not what the engine does, and every analysis
    // downstream is keyed on this object.
    [deferred?.rules, deferred?.keywords, safeMode],
  );
  const stop = useMemo(
    () => new Set([...STOP_WORDS, ...(deferred?.excludedTerms ?? [])]),
    [deferred?.excludedTerms],
  );

  const files = library?.files;
  // Keyed on the load, not on `files`: applying tags replaces the file objects
  // but never their names, and a new array here would rerun every analysis.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => (files ?? []).map((f) => f.name), [loadedAt]);
  const fileTags = useMemo(
    () => (files ?? []).map((f) => new Set(f.tags.map((x) => x.toLowerCase()))),
    [files],
  );
  const existing = useMemo(() => {
    const map = new Map<string, string>();
    for (const name of library?.existingTags ?? []) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, name);
    }
    return map;
  }, [library?.existingTags]);

  // Copies of a file share their tags, so what one of them gains they all do
  // — within a workspace: each has a database of its own, and the same
  // content in two of them is tagged twice over.
  const siblings = useMemo(() => {
    const byKey = new Map<string, number[]>();
    (files ?? []).forEach((file, index) => {
      const key = siblingKey(file);
      const list = byKey.get(key);
      if (list) list.push(index);
      else byKey.set(key, [index]);
    });
    return byKey;
  }, [files]);

  const apply = useCallback(
    async (perFile: Map<number, string[]>): Promise<ApplyOutcome> => {
      if (!library) return { ok: false };
      // Only what is new to each file is sent, so the counts reported are of
      // what really changed — and so is what a rollback takes back, should a
      // later call of this apply fail.
      const sent = new Map<number, string[]>();
      const groups = new Map<string, AutoTagAssignment>();
      for (const [index, tags] of perFile) {
        const file = library.files[index];
        const have = fileTags[index];
        const seen = new Set<string>();
        const fresh: string[] = [];
        for (const tag of tags) {
          const key = tag.toLowerCase();
          if (have.has(key) || seen.has(key)) continue;
          seen.add(key);
          fresh.push(existing.get(key) ?? tag);
        }
        if (fresh.length === 0) continue;
        fresh.length = Math.min(fresh.length, MAX_AUTO_TAGS_PER_FILE);
        sent.set(index, fresh);
        const groupKey = `${file.workspaceId}\0${fresh.join("\0")}`;
        const group = groups.get(groupKey);
        if (group) group.fileIds.push(file.id);
        else {
          groups.set(groupKey, {
            workspaceId: file.workspaceId,
            fileIds: [file.id],
            tags: fresh,
          });
        }
      }
      if (sent.size === 0) return { ok: true, files: 0, added: 0 };

      // One call carries at most MAX_BULK_FILES ids and MAX_AUTO_TAG_PAIRS
      // (file, tag) pairs, however the files are grouped.
      const calls: AutoTagAssignment[][] = [[]];
      let fileRoom = MAX_BULK_FILES;
      let pairRoom = MAX_AUTO_TAG_PAIRS;
      for (const group of groups.values()) {
        for (let at = 0; at < group.fileIds.length;) {
          let take = Math.min(
            fileRoom,
            Math.floor(pairRoom / group.tags.length),
          );
          if (take === 0) {
            calls.push([]);
            fileRoom = MAX_BULK_FILES;
            pairRoom = MAX_AUTO_TAG_PAIRS;
            take = Math.min(fileRoom, Math.floor(pairRoom / group.tags.length));
          }
          const fileIds = group.fileIds.slice(at, at + take);
          calls[calls.length - 1].push({ ...group, fileIds });
          at += fileIds.length;
          fileRoom -= fileIds.length;
          pairRoom -= fileIds.length * group.tags.length;
        }
      }

      const undoIds: string[] = [];
      let filesChanged = 0;
      let pairs = 0;
      try {
        for (const assignments of calls) {
          const result = await api.autoTagApply(assignments);
          filesChanged += result.files;
          pairs += result.added;
          if (result.undoId) undoIds.push(result.undoId);
        }
      } catch (error) {
        toast.error(t("autoTag.applyFailed"), { description: String(error) });
        // Earlier calls landed. Take them back rather than leave the files
        // half tagged with nothing on screen to undo it, then show what the
        // files really carry.
        if (undoIds.length > 0) await api.autoTagUndo(undoIds).catch(() => {});
        load();
        return { ok: false };
      }

      // What changed here, copies included.
      const added = new Map<number, string[]>();
      for (const [index, tags] of sent) {
        for (const twin of siblings.get(siblingKey(library.files[index])) ??
          []) {
          const have = new Set([
            ...fileTags[twin],
            ...(added.get(twin) ?? []).map((x) => x.toLowerCase()),
          ]);
          const fresh = tags.filter((tag) => !have.has(tag.toLowerCase()));
          if (fresh.length > 0) {
            added.set(twin, [...(added.get(twin) ?? []), ...fresh]);
          }
        }
      }
      setLibrary((prev) => {
        if (!prev) return prev;
        const nextFiles = [...prev.files];
        const nextExisting = new Set(prev.existingTags);
        for (const [index, tags] of added) {
          nextFiles[index] = {
            ...nextFiles[index],
            tags: [...nextFiles[index].tags, ...tags],
          };
          for (const tag of tags) nextExisting.add(tag);
        }
        return { ...prev, files: nextFiles, existingTags: [...nextExisting] };
      });
      invalidateTagCatalog(qc);
      return { ok: true, files: filesChanged, added: pairs };
    },
    [existing, fileTags, library, load, qc, siblings, t],
  );

  const remove = useCallback(
    async (indexes: readonly number[], key: string): Promise<RemoveOutcome> => {
      if (!library) return { ok: false };
      // The tag as the files spell it: `trip` and `Trip` are two rows of the
      // tag table, and both are what this candidate reads as "tagged".
      const spellings = new Set<string>();
      const holders: { workspaceId: string; fileId: number }[] = [];
      for (const index of indexes) {
        const file = library.files[index];
        const mine = file.tags.filter((tag) => tag.toLowerCase() === key);
        if (mine.length === 0) continue;
        for (const tag of mine) spellings.add(tag);
        holders.push({ workspaceId: file.workspaceId, fileId: file.id });
      }
      // What one call can name; more spellings of one tag than that is not a
      // case worth a second pass, and what is not sent is not dropped below.
      const names = [...spellings].slice(0, MAX_BULK_TAG_NAMES);
      if (names.length === 0) return { ok: true, files: 0 };
      const gone = new Set(names);

      // One call carries at most MAX_BULK_FILES ids, however they are grouped.
      const calls: BulkTargets[] = [];
      for (let at = 0; at < holders.length; at += MAX_BULK_FILES) {
        calls.push(groupBulkTargets(holders.slice(at, at + MAX_BULK_FILES)));
      }
      let filesChanged = 0;
      try {
        for (const targets of calls) {
          filesChanged += (await api.filesBulkTag(targets, [], names)).files;
        }
      } catch (error) {
        toast.error(t("autoTag.removeFailed"), { description: String(error) });
        // Some calls may have landed: show what the files really carry, here
        // and in every other view of them.
        load();
        invalidateTagCatalog(qc);
        return { ok: false };
      }
      // Copies of a file share their tags, so they lost it as well.
      const touched = new Set<number>();
      for (const index of indexes) {
        for (const twin of siblings.get(siblingKey(library.files[index])) ??
          []) {
          touched.add(twin);
        }
      }
      setLibrary((prev) => {
        if (!prev) return prev;
        const nextFiles = [...prev.files];
        for (const index of touched) {
          const file = nextFiles[index];
          if (!file.tags.some((tag) => gone.has(tag))) continue;
          nextFiles[index] = {
            ...file,
            tags: file.tags.filter((tag) => !gone.has(tag)),
          };
        }
        return { ...prev, files: nextFiles };
      });
      invalidateTagCatalog(qc);
      return { ok: true, files: filesChanged };
    },
    [library, load, qc, siblings, t],
  );

  const reapply = useCallback(async () => {
    try {
      // The scan-side pass reads the stored configuration, so store it first —
      // and do not run at all on rules other than the ones on screen.
      await saver.flush();
      const result = await api.autoTagReapply();
      invalidateTagCatalog(qc);
      load();
      return result;
    } catch (error) {
      toast.error(t("autoTag.applyFailed"), { description: String(error) });
      return null;
    }
  }, [load, qc, saver, t]);

  if (!config || !library) return null;
  return {
    config,
    update,
    files: library.files,
    names,
    total: library.total,
    existing,
    fileTags,
    engine,
    stop,
    loading,
    safeMode,
    leaveSafeMode: () => setSafeMode(false),
    reload: load,
    apply,
    remove,
    reapply,
  };
}
