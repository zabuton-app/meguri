// Main-process owner of everything AI: the active model (loaded lazily, dropped
// when idle), the single background index job and the queue of workspaces
// waiting for one, the per-workspace embedding matrices behind semantic and
// similar-file search, and the zero-shot tags written into meta_tags under the
// `ai` namespace.
//
// Inference runs on onnxruntime's own thread pool and `session.run()` is async,
// so the main process stays responsive; only ffmpeg decoding is spawned.
//
// Cached vectors are dropped when:
//   - this service writes a vector (index job, Analyze),
//   - a scan of the workspace finishes (onScanFinished),
//   - a file is removed from the index or a workspace is removed (invalidate /
//     forgetWorkspace, called by the IPC layer),
//   - the model changes, or the model is unloaded for being idle.
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { loadConfig, updateConfig, type AiConfig } from "../appConfig.js";
import { pool } from "../concurrency.js";
import { scopedLog } from "../logger.js";
import { isInsideRoot } from "../paths.js";
import {
  aiTagSignature,
  applyScoredTagsByKey,
  clearAiTags,
  clearRetagSignature,
  needsRetag,
  setRetagSignature,
} from "./aiTags.js";
import {
  AI_SEARCH_LIMIT,
  MAX_AI_VOCABULARY,
  type AiCandidate,
  type AiHit,
  type AiJobState,
  type AiProgress,
  type AiSettings,
  type AiStatus,
} from "../../../shared/ipc/schema.js";
import { ClipModel, availableBackends } from "./clip.js";
import {
  countPending,
  embeddingOf,
  hasEmbeddings,
  fileIdsForKeys,
  loadEmbeddingMatrix,
  pendingFiles,
  purgeMismatchedDims,
  topK,
  topKMatrix,
  upsertEmbedding,
  type EmbeddingMatrix,
} from "./embeddings.js";
import { describeModel, listModels, modelsDir } from "./modelStore.js";
import {
  classify,
  normalizeVocabulary,
  promptFor,
  type VocabEmbedding,
} from "./zeroShot.js";
import { discoveryEmbeddings } from "./discovery.js";

const log = scopedLog("ai");

/** Release the loaded sessions (a few hundred MB) after this much inactivity. */
const IDLE_UNLOAD_MS = 5 * 60_000;
/** Files embedded concurrently: one decodes in ffmpeg while the other runs the graph. */
const EMBED_CONCURRENCY = 2;
/** Rows written per transaction during indexing. */
const FLUSH_EVERY = 16;
/** Progress events are throttled to one per this many files… */
const PROGRESS_EVERY = 4;
/** …and, whatever the phase, to one per this many milliseconds. */
const PROGRESS_INTERVAL_MS = 100;
/** Rows re-tagged per transaction before yielding to the event loop. */
const RETAG_CHUNK = 256;

export interface CoreTarget {
  id: string;
  core: Core;
}

/** A file the service is asked about directly (Analyze, similar files). */
export interface FileTarget {
  workspaceId: string;
  id: number;
  core: Core;
}

/** Restrict a search to these meta_keys, per workspace (a collection's members). */
export type SearchAllowList = Map<string, Set<string>>;

export interface IndexOptions {
  /** Re-tag from stored vectors only — after a vocabulary or threshold edit. */
  retagOnly?: boolean;
  /**
   * Embed new files only. Every vector written is tagged as it is written, so
   * with an unchanged vocabulary re-tagging the rest is pure cost — a full pass
   * over the workspace on every scan, measured at over a second per 50k files.
   */
  embedOnly?: boolean;
}

type ProgressSink = (p: AiProgress) => void;

interface RunningJob {
  state: AiJobState;
  controller: AbortController;
  promise: Promise<void>;
}

export class AiService {
  private model: ClipModel | null = null;
  private loading: Promise<ClipModel> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private job: RunningJob | null = null;
  /** Set once dispose() starts: nothing new may begin after that. */
  private closing = false;
  /** Set while selectModel() is swapping models: same, for the duration. */
  private switching = false;
  /**
   * Inference that is not a job (search, Analyze) still holds the sessions.
   * Tracked so that switching models or quitting waits for it instead of
   * releasing a session while a graph is running on it.
   */
  private inflight = new Set<Promise<unknown>>();
  /**
   * Workspaces whose scan finished while a job was running, waiting for their
   * own embed run. Without it, the second of two scans finishing close
   * together — every scan of the All view — would simply be skipped.
   */
  private autoQueue = new Map<string, Core>();
  /** Vocabulary embeddings for the loaded model, keyed by the normalized vocabulary. */
  private vocabCache: { key: string; embs: VocabEmbedding[] } | null = null;
  /**
   * Per-workspace vectors for the active model. Building one is a full read of
   * the workspace's `meta_embeddings`, so it is kept until one of the events in
   * the header comment happens.
   */
  private matrices = new Map<string, EmbeddingMatrix>();
  /**
   * The last semantic search. An infinite list asks for the same query once per
   * page, and each ask would otherwise re-run the text encoder and every
   * workspace's scan for results that cannot have changed.
   */
  private lastSearch: { key: string; hits: AiHit[] } | null = null;
  private lastProgressAt = 0;

  constructor(private readonly emit: ProgressSink) {}

  // --- config ---

  private config(): AiConfig {
    return loadConfig().ai;
  }

  /**
   * The selected model, or null when none is selected or the selection no
   * longer resolves — the user may have deleted or renamed its folder, which
   * simply turns the feature off rather than failing every call.
   */
  get activeModelId(): string | null {
    const id = this.config().activeModelId;
    return id && describeModel(id) ? id : null;
  }

  settings(): AiSettings {
    return this.config().settings;
  }

  /** Append to the vocabulary; returns the merged list. */
  addVocabulary(entries: string[]): string[] {
    const merged = normalizeVocabulary([
      ...this.settings().vocabulary,
      ...entries,
    ]);
    return this.setSettings({ vocabulary: merged }).vocabulary;
  }

  /** Apply a partial update; returns the settings as stored, after normalizing. */
  setSettings(patch: Partial<AiSettings>): AiSettings {
    updateConfig((c) => ({
      ...c,
      ai: {
        ...c.ai,
        settings: {
          ...c.ai.settings,
          ...(patch.vocabulary
            ? {
                // Capped here as well as at the IPC boundary: an append can
                // take a list that was within bounds past them.
                vocabulary: normalizeVocabulary(patch.vocabulary).slice(
                  0,
                  MAX_AI_VOCABULARY,
                ),
              }
            : {}),
          ...(patch.threshold != null ? { threshold: patch.threshold } : {}),
          ...(patch.autoIndex != null ? { autoIndex: patch.autoIndex } : {}),
        },
      },
    }));
    return this.settings();
  }

  /**
   * Select a model, or none. Clears the AI tags of every workspace on the way:
   * `meta_tags` does not record which model wrote a tag, so tags from the old
   * one would be indistinguishable from the new one's — and would survive
   * turning the feature off entirely. The vectors are keyed by model and stay,
   * so going back to a model does not mean embedding the library again.
   *
   * The clearing happens *before* the selection is written, and a workspace it
   * could not clear fails the whole call: a library half in one model's tags
   * and half in another's is the one state this is here to prevent.
   *
   * Returns how many tags were dropped, for the note the UI shows afterwards.
   */
  async selectModel(id: string | null, cores: CoreTarget[]): Promise<number> {
    if (id && !describeModel(id)) throw new Error("model not found");
    if (this.job) throw new Error("a job is running");
    if (this.switching) throw new Error("already switching models");
    this.switching = true;
    try {
      // Nothing may start against the old model from here on: an auto-index
      // could otherwise load it again behind the unload below.
      let cleared = 0;
      for (const { id: wsId, core } of cores) {
        try {
          cleared += clearAiTags(core.db);
          clearRetagSignature(core.db);
        } catch (e) {
          throw new Error(
            `could not clear the AI tags of workspace ${wsId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
      updateConfig((c) => ({ ...c, ai: { ...c.ai, activeModelId: id } }));
      await this.settleInflight();
      await this.unload();
      return cleared;
    } finally {
      this.switching = false;
    }
  }

  /** The identity of the current settings, as stored beside the tags they made. */
  private signature(modelId: string): string {
    const s = this.settings();
    return aiTagSignature(
      modelId,
      normalizeVocabulary(s.vocabulary),
      s.threshold,
    );
  }

  /**
   * Whether any workspace holds tags made with different settings. Tags are a
   * snapshot of the vocabulary and threshold at the time they were written, and
   * a re-tag pass rewrites every one of them — far too heavy to run off a
   * slider, so the UI says so instead and the user decides when.
   */
  private retagPending(cores: CoreTarget[], modelId: string): boolean {
    const want = this.signature(modelId);
    return cores.some(({ core }) => {
      try {
        // A workspace the model never ran on has nothing out of date.
        return hasEmbeddings(core.db, modelId) && needsRetag(core.db, want);
      } catch (e) {
        log.warn("could not read the re-tag signature:", e);
        return false;
      }
    });
  }

  // --- model lifecycle ---

  private async ensureModel(): Promise<ClipModel> {
    if (this.closing) throw new Error("shutting down");
    const id = this.activeModelId;
    if (!id) throw new Error("no active model");
    if (this.model?.id === id) {
      this.touch();
      return this.model;
    }
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await this.unload();
      const m = await ClipModel.load(id);
      if (this.closing) {
        // dispose() ran while the graphs were loading; do not leave them behind.
        await m.close();
        throw new Error("shutting down");
      }
      this.model = m;
      this.vocabCache = null;
      this.touch();
      return m;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.job && this.inflight.size === 0) void this.unload();
    }, IDLE_UNLOAD_MS);
    this.idleTimer.unref();
  }

  /** Release the sessions and everything derived from them. */
  async unload(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const m = this.model;
    this.model = null;
    this.vocabCache = null;
    // The matrices are rebuilt in about a tenth of a second per workspace, and
    // held for every workspace searched they run to hundreds of megabytes: they
    // go idle with the model rather than living as long as the process.
    this.matrices.clear();
    this.lastSearch = null;
    if (m) {
      log.info(`unloading model ${m.id}`);
      await m.close();
    }
  }

  /** Run `fn` as tracked inference: model switches and quitting wait for it. */
  private async track<T>(fn: () => Promise<T>): Promise<T> {
    const p = fn();
    this.inflight.add(p);
    try {
      return await p;
    } finally {
      this.inflight.delete(p);
    }
  }

  private async settleInflight(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  /** Cancel the running job, if any, and wait until it has stopped writing. */
  async stopJob(): Promise<void> {
    this.cancelJob();
    await this.job?.promise.catch(() => undefined);
  }

  /** Refuse new work, then wait for the job, a model load and any inference to finish. */
  async dispose(): Promise<void> {
    this.closing = true;
    this.autoQueue.clear();
    await this.stopJob();
    await this.loading?.catch(() => undefined);
    await this.settleInflight();
    await this.unload();
  }

  /** Drop cached vectors — for one workspace, or all of them. */
  invalidate(workspaceId?: string): void {
    if (workspaceId) this.matrices.delete(workspaceId);
    else this.matrices.clear();
    this.lastSearch = null;
  }

  /**
   * A workspace is going away: forget its cache and any queued run for it. The
   * caller still has to await stopJob() before closing the database, since a
   * run already in progress may be writing to it.
   */
  forgetWorkspace(workspaceId: string): void {
    this.autoQueue.delete(workspaceId);
    this.invalidate(workspaceId);
  }

  /**
   * A scan of one workspace settled. Its file set may have changed, so its
   * vectors are stale; and with auto-index on, whatever it added is embedded —
   * now, or once the running job is done.
   */
  onScanFinished(e: {
    wsId: string;
    core: Core;
    aborted: boolean;
    failed: boolean;
  }): void {
    this.invalidate(e.wsId);
    if (e.aborted || e.failed || this.closing) return;
    if (!this.settings().autoIndex || !this.activeModelId) return;
    this.autoQueue.set(e.wsId, e.core);
    this.drainAutoQueue();
  }

  private drainAutoQueue(): void {
    if (this.job || this.closing || this.switching) return;
    if (this.autoQueue.size === 0) return;
    const targets = [...this.autoQueue].map(([id, core]) => ({ id, core }));
    this.autoQueue.clear();
    try {
      this.index(targets, { embedOnly: true });
    } catch (e) {
      log.warn("auto-index could not start:", e);
    }
  }

  // --- status ---

  status(cores: CoreTarget[]): AiStatus {
    const activeModelId = this.activeModelId;
    let pending = 0;
    if (activeModelId) {
      for (const { core } of cores) {
        try {
          pending += countPending(core.db, activeModelId);
        } catch (e) {
          log.warn("pending count failed:", e);
        }
      }
    }
    return {
      modelsDir: modelsDir(),
      // Re-read on every call: the folder is the source of truth, and asking for
      // the status is how the settings screen picks up a model just dropped in.
      models: listModels(),
      activeModelId,
      settings: this.settings(),
      backends: availableBackends(),
      activeBackend: this.model?.info.backend ?? null,
      job: this.job?.state ?? null,
      pending,
      retagPending: activeModelId
        ? this.retagPending(cores, activeModelId)
        : false,
    };
  }

  // --- jobs ---

  private startJob(
    state: AiJobState,
    run: (signal: AbortSignal) => Promise<void>,
  ): void {
    if (this.closing) throw new Error("shutting down");
    if (this.switching) throw new Error("switching models");
    if (this.job) throw new Error("a job is already running");
    const controller = new AbortController();
    const job: RunningJob = { state, controller, promise: Promise.resolve() };
    this.job = job;
    this.emit({ job: state });
    job.promise = (async () => {
      let error: string | undefined;
      try {
        await run(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) {
          error = e instanceof Error ? e.message : String(e);
          log.error(`${state.kind} job failed:`, e);
        }
      } finally {
        if (this.job === job) this.job = null;
        this.emit({ job: null, error });
        // The idle timer skips its turn while a job runs; re-arm it, or a job
        // longer than the idle window leaves the sessions loaded indefinitely.
        if (this.model) this.touch();
        this.drainAutoQueue();
      }
    })();
  }

  private progress(patch: Partial<AiJobState>): void {
    if (!this.job) return;
    const state = this.job.state;
    Object.assign(state, patch);
    // Throttled by time, not by row count: a re-tag chunk takes 1.4ms with a
    // small vocabulary and ten times that with a large one, so a fixed row
    // stride means hundreds of events a second in the first case — each one a
    // re-render of the settings screen. Anything that changes what the bar
    // *says* (a new phase, a finished run) still goes out at once.
    const now = Date.now();
    const notable =
      patch.label != null ||
      patch.total != null ||
      patch.workspaceId !== undefined ||
      (state.total > 0 && state.done >= state.total);
    if (!notable && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;
    this.emit({ job: { ...state } });
  }

  cancelJob(): void {
    this.job?.controller.abort();
  }

  get isIndexing(): boolean {
    return this.job?.state.kind === "index";
  }

  /**
   * Embed every file still lacking a vector for the active model, then re-run
   * zero-shot tagging over every stored vector. See IndexOptions for the two
   * halves on their own.
   */
  index(cores: CoreTarget[], opts: IndexOptions = {}): void {
    const modelId = this.activeModelId;
    const desc = modelId ? describeModel(modelId) : null;
    if (!modelId || !desc) throw new Error("no active model");
    this.startJob(
      {
        kind: "index",
        label: opts.retagOnly ? "tag" : "embed",
        done: 0,
        total: 0,
        workspaceId: null,
      },
      async (signal) => {
        const model = await this.ensureModel();
        // One snapshot for the whole run: the settings can be edited while it
        // is going, and tags written with the old ones must not be marked as
        // carrying the new ones.
        const threshold = this.settings().threshold;
        const signature = this.signature(modelId);
        const vocab = await this.vocabEmbeddings(model);
        for (const { id, core } of cores) {
          // A different model in a same-named folder leaves vectors of the old
          // width behind; they would block re-embedding and fail every search.
          if (purgeMismatchedDims(core.db, modelId, desc.dim) > 0) {
            this.invalidate(id);
          }
        }
        if (!opts.retagOnly) {
          for (const { id, core } of cores) {
            if (signal.aborted) return;
            // Nothing carries this model's tags here yet, so whatever the run
            // writes *is* the whole of them — and is written with the snapshot
            // above, which is what the signature then records.
            const first = !hasEmbeddings(core.db, modelId);
            try {
              const written = await this.embedWorkspace(
                model,
                modelId,
                id,
                core,
                vocab,
                threshold,
                signal,
              );
              if (written > 0) this.invalidate(id);
              if (first && !signal.aborted) {
                setRetagSignature(core.db, signature);
              }
            } catch (e) {
              // Some batches may have committed before the failure.
              this.invalidate(id);
              throw e;
            }
          }
        }
        if (opts.embedOnly) return;
        for (const { id, core } of cores) {
          if (signal.aborted) return;
          await this.retagWorkspace(
            modelId,
            desc.dim,
            id,
            core.db,
            vocab,
            threshold,
            signal,
          );
          // Only once the pass has actually finished for this workspace: an
          // aborted run leaves the tags half-rewritten, which is still stale.
          if (!signal.aborted) setRetagSignature(core.db, signature);
        }
      },
    );
  }

  /** Returns how many vectors were written. */
  private async embedWorkspace(
    model: ClipModel,
    modelId: string,
    wsId: string,
    core: Core,
    vocab: VocabEmbedding[],
    threshold: number,
    signal: AbortSignal,
  ): Promise<number> {
    const { db } = core;
    const pending = pendingFiles(db, modelId);
    const total = pending.length;
    if (total === 0) return 0;
    log.info(`embedding ${total} files in ${wsId} with ${modelId}`);
    this.progress({ label: "embed", done: 0, total, workspaceId: wsId });

    type Result = { metaKey: string; vec: Float32Array };
    let buffer: Result[] = [];
    let done = 0;
    let written = 0;
    const flush = () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      db.transaction(() => {
        for (const r of batch) {
          upsertEmbedding(db, r.metaKey, modelId, r.vec);
          applyScoredTagsByKey(
            db,
            r.metaKey,
            classify(r.vec, vocab, threshold),
          );
        }
      })();
      done += batch.length;
      written += batch.length;
      this.progress({ done, total });
    };

    await pool(
      pending,
      EMBED_CONCURRENCY,
      async (f) => {
        if (signal.aborted) return;
        let vec: Float32Array | null = null;
        // abs_path was written at scan time: like every handler that hands a
        // path to the OS, only decode what still resolves inside the root.
        // Checked here, per file, rather than over the whole list up front —
        // it is two realpath calls, and the list can be the entire library.
        if (!isInsideRoot(f.absPath, core.root)) {
          log.warn(`skipping a file outside its workspace root: ${f.absPath}`);
          done++;
          return;
        }
        try {
          vec = await model.embedFile(
            f.absPath,
            f.kind as "video" | "image",
            f.duration,
            signal,
          );
        } catch (e) {
          log.warn(`embedding failed for ${f.absPath}:`, e);
        }
        if (signal.aborted) return;
        if (vec) buffer.push({ metaKey: f.metaKey, vec });
        else done++; // counted so the bar still completes; retried next run
        if (buffer.length >= FLUSH_EVERY) flush();
        else if (done % PROGRESS_EVERY === 0) this.progress({ done });
      },
      signal,
    );
    flush();
    return written;
  }

  private async retagWorkspace(
    modelId: string,
    dim: number,
    wsId: string,
    db: DB,
    vocab: VocabEmbedding[],
    threshold: number,
    signal: AbortSignal,
  ): Promise<void> {
    const m = this.matrixFor(wsId, db, modelId, dim);
    const total = m.keys.length;
    this.progress({ label: "tag", done: 0, total, workspaceId: wsId });
    for (let i = 0; i < total; i += RETAG_CHUNK) {
      if (signal.aborted) return;
      const end = Math.min(total, i + RETAG_CHUNK);
      db.transaction(() => {
        for (let r = i; r < end; r++) {
          const vec = m.mat.subarray(r * dim, (r + 1) * dim);
          applyScoredTagsByKey(db, m.keys[r], classify(vec, vocab, threshold));
        }
      })();
      this.progress({ done: end });
      // better-sqlite3 is synchronous; let IPC and media serving breathe.
      await new Promise((r) => setImmediate(r));
    }
  }

  private async vocabEmbeddings(model: ClipModel): Promise<VocabEmbedding[]> {
    const entries = normalizeVocabulary(this.settings().vocabulary);
    const key = entries.join(" ");
    if (this.vocabCache?.key === key) return this.vocabCache.embs;
    const vecs =
      entries.length > 0 ? await model.embedTexts(entries.map(promptFor)) : [];
    const embs = entries.map((entry, i) => ({ entry, vec: vecs[i] }));
    this.vocabCache = { key, embs };
    return embs;
  }

  // --- search ---

  private matrixFor(
    wsId: string,
    db: DB,
    modelId: string,
    dim: number,
  ): EmbeddingMatrix {
    const cached = this.matrices.get(wsId);
    if (cached && cached.modelId === modelId && cached.dim === dim) {
      return cached;
    }
    const m = loadEmbeddingMatrix(db, modelId, dim);
    this.matrices.set(wsId, m);
    return m;
  }

  private nearest(
    query: Float32Array,
    cores: CoreTarget[],
    modelId: string,
    limit: number,
    opts: {
      exclude?: { workspaceId: string; metaKey: string };
      allow?: SearchAllowList;
    } = {},
  ): AiHit[] {
    // Top `limit` per workspace, then top `limit` of those: the global best k
    // are always among the per-workspace best k, so nothing is lost and no
    // candidate array the size of every library is ever built.
    const merged: { wsId: string; metaKey: string; score: number }[] = [];
    for (const { id, core } of cores) {
      let allow: Set<string> | undefined;
      if (opts.allow) {
        allow = opts.allow.get(id);
        if (!allow || allow.size === 0) continue;
      }
      const m = this.matrixFor(id, core.db, modelId, query.length);
      const skip =
        opts.exclude?.workspaceId === id ? opts.exclude.metaKey : undefined;
      for (const t of topKMatrix(query, m, limit, { skip, allow })) {
        merged.push({ wsId: id, metaKey: t.item, score: t.score });
      }
    }
    merged.sort((a, b) => b.score - a.score);
    const top = merged.slice(0, limit);

    // Resolve meta_keys to file ids per workspace in one query each.
    const byWs = new Map<string, string[]>();
    for (const t of top) {
      const list = byWs.get(t.wsId) ?? [];
      list.push(t.metaKey);
      byWs.set(t.wsId, list);
    }
    const idMaps = new Map<string, Map<string, number[]>>();
    for (const [wsId, keys] of byWs) {
      const core = cores.find((c) => c.id === wsId)?.core;
      if (core) idMaps.set(wsId, fileIdsForKeys(core.db, keys));
    }
    const hits: AiHit[] = [];
    for (const t of top) {
      // Duplicates share a meta_key and so one vector; every copy is a hit,
      // or a collection holding only the second copy would find nothing.
      for (const id of idMaps.get(t.wsId)?.get(t.metaKey) ?? []) {
        hits.push({ workspaceId: t.wsId, id, score: t.score });
      }
    }
    return hits;
  }

  /**
   * Files nearest to a natural-language query. Empty when no model is active.
   * With `allow`, only those files are candidates — a collection is searched
   * among its own members, not filtered out of the library's top few hundred.
   */
  async search(
    text: string,
    cores: CoreTarget[],
    limit = AI_SEARCH_LIMIT,
    allow?: SearchAllowList,
  ): Promise<AiHit[]> {
    const modelId = this.activeModelId;
    const query = text.trim();
    if (!modelId || !query) return [];
    const key = allow
      ? null
      : [modelId, limit, cores.map((c) => c.id).join(","), query].join(" ");
    if (key && this.lastSearch?.key === key) return this.lastSearch.hits;

    return this.track(async () => {
      const model = await this.ensureModel();
      const [q] = await model.embedTexts([query]);
      // The model may have been switched while the text was encoding.
      if (model.id !== this.activeModelId) return [];
      const hits = this.nearest(q, cores, modelId, limit, { allow });
      if (key) this.lastSearch = { key, hits };
      return hits;
    });
  }

  /**
   * Embed one file on demand and report what the model sees in it. The labels
   * are scored from the built-in discovery set so the answer does not depend on
   * the user's vocabulary; the vector and the vocabulary's above-threshold tags
   * are still persisted exactly as the index job would, so analyzing a file
   * also takes it off the pending list.
   *
   * `absPath` must already have been checked against the workspace root by the
   * caller, as every path handed to the OS is.
   */
  async analyzeFile(
    target: FileTarget,
    absPath: string,
    limit = 20,
  ): Promise<AiCandidate[]> {
    const modelId = this.activeModelId;
    if (!modelId) throw new Error("no active model");
    const { db } = target.core;
    const row = db
      .prepare(
        `SELECT meta_key AS metaKey, kind, duration
           FROM files WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(target.id) as
      { metaKey: string; kind: string; duration: number | null } | undefined;
    if (!row) throw new Error("file not found");
    const kind = row.kind;
    if (kind !== "video" && kind !== "image") {
      throw new Error("only images and videos can be analyzed");
    }

    return this.track(async () => {
      const model = await this.ensureModel();
      const vec = await model.embedFile(absPath, kind, row.duration);
      if (!vec) throw new Error("could not decode the file");
      const vocab = await this.vocabEmbeddings(model);
      // Checked right before writing: a vector stored under the wrong model id
      // would be compared against that model's vectors for good.
      if (model.id !== modelId || this.activeModelId !== modelId) {
        throw new Error("the model changed during analysis");
      }
      const threshold = this.settings().threshold;
      db.transaction(() => {
        upsertEmbedding(db, row.metaKey, modelId, vec);
        applyScoredTagsByKey(db, row.metaKey, classify(vec, vocab, threshold));
      })();
      this.invalidate(target.workspaceId);

      const discovery = await discoveryEmbeddings(model);
      const inVocab = new Set(vocab.map((v) => v.entry.toLowerCase()));
      const probs = classify(vec, discovery, 0);
      const top = topK(
        vec,
        discovery.map((d) => ({ item: d.entry, vec: d.vec })),
        limit,
      );
      const probOf = new Map(probs.map((p) => [p.name, p.score]));
      return top.map((t) => ({
        entry: t.item,
        score: probOf.get(t.item) ?? 0,
        similarity: t.score,
        inVocabulary: inVocab.has(t.item.toLowerCase()),
      }));
    });
  }

  /** Files nearest to an already-embedded file. Empty when it has no vector yet. */
  similar(target: FileTarget, cores: CoreTarget[], limit = 24): AiHit[] {
    const modelId = this.activeModelId;
    if (!modelId) return [];
    const { db } = target.core;
    const row = db
      .prepare("SELECT meta_key AS metaKey FROM files WHERE id = ?")
      .get(target.id) as { metaKey: string } | undefined;
    if (!row) return [];
    const vec = embeddingOf(db, row.metaKey, modelId);
    if (!vec) return [];
    return this.nearest(vec, cores, modelId, limit, {
      exclude: { workspaceId: target.workspaceId, metaKey: row.metaKey },
    });
  }
}
