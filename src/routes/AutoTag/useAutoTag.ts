// State behind the auto-tagging screen: the configuration (saved as it is
// edited), the files of the current scope, and applying / undoing tags.
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
import { MAX_BULK_FILES } from "@shared/tags";

/** What one apply added, so it can be taken back while the screen is open. */
export interface UndoHandle {
  undoIds: string[];
  /** File position → tags that were new to that file. */
  added: Map<number, string[]>;
}

/**
 * `ok: false` is a failure (already reported to the user). Nothing new to add
 * is a success with zero counts and no handle — callers must be able to tell
 * the two apart before they mark anything as done.
 */
export type ApplyOutcome =
  | { ok: true; files: number; added: number; undo: UndoHandle | null }
  | { ok: false };

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
  /**
   * Identifies the loaded file list: the same files in the same order give the
   * same key. Positions are only comparable between lists with the same key.
   */
  listKey: string;
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
  undo: (handle: UndoHandle) => Promise<void>;
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
  // A cheap fingerprint of which files are listed, in which order. Keyed on
  // the load like `names` below: applying tags never changes which files.
  const listKey = useMemo(() => {
    let hash = 0;
    for (const file of files ?? []) {
      const text = `${file.workspaceId}:${file.id}`;
      for (let i = 0; i < text.length; i++) {
        hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
      }
    }
    return `${files?.length ?? 0}:${hash}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedAt]);

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

  // Copies of a file share their tags, so what one of them gains they all do.
  const siblings = useMemo(() => {
    const byKey = new Map<string, number[]>();
    (files ?? []).forEach((file, index) => {
      const list = byKey.get(file.metaKey);
      if (list) list.push(index);
      else byKey.set(file.metaKey, [index]);
    });
    return byKey;
  }, [files]);

  const apply = useCallback(
    async (perFile: Map<number, string[]>): Promise<ApplyOutcome> => {
      if (!library) return { ok: false };
      // Only what is new to each file is sent, so the handle that comes back
      // describes exactly what an undo removes.
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
      if (sent.size === 0) return { ok: true, files: 0, added: 0, undo: null };

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
        for (const twin of siblings.get(library.files[index].metaKey) ?? []) {
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
      return {
        ok: true,
        files: filesChanged,
        added: pairs,
        // No handle when main attached nothing: there is nothing to take back.
        undo: undoIds.length > 0 ? { undoIds, added } : null,
      };
    },
    [existing, fileTags, library, load, qc, siblings, t],
  );

  const undo = useCallback(
    async (handle: UndoHandle) => {
      try {
        await api.autoTagUndo(handle.undoIds);
      } catch (error) {
        toast.error(t("autoTag.undoFailed"), { description: String(error) });
        return;
      }
      setLibrary((prev) => {
        if (!prev) return prev;
        const nextFiles = [...prev.files];
        for (const [index, tags] of handle.added) {
          const gone = new Set(tags.map((x) => x.toLowerCase()));
          nextFiles[index] = {
            ...nextFiles[index],
            tags: nextFiles[index].tags.filter(
              (x) => !gone.has(x.toLowerCase()),
            ),
          };
        }
        return { ...prev, files: nextFiles };
      });
      invalidateTagCatalog(qc);
    },
    [qc, t],
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
    listKey,
    reload: load,
    apply,
    undo,
    reapply,
  };
}
