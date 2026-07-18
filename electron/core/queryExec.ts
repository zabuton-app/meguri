// Read-only query execution over workspace DBs, shared by the query worker
// thread and the main-thread fallback (used when the worker cannot be
// spawned). Holds its own read-only connection cache keyed by workspace ID —
// WAL mode allows these readers to coexist with the main process's writer.
import { openDbReadonly, type DB } from "./db.js";
import type { Core } from "./index.js";
import * as cw from "./crossWorkspace.js";
import { countFiles, lastScanAt } from "./queries.js";
import type {
  FileRow,
  HistoryPage,
  HistoryQuery,
  SearchQuery,
  SearchResult,
  WorkspaceStats,
} from "./types.js";

/** One workspace to query: its stable ID plus the on-disk DB file. */
export interface QueryTarget {
  id: string;
  dbPath: string;
}

export type QueryRequest =
  | {
      kind: "search";
      targets: QueryTarget[];
      query: SearchQuery;
      refs?: cw.FileRef[];
    }
  | {
      kind: "random";
      targets: QueryTarget[];
      query: SearchQuery;
      refs?: cw.FileRef[];
    }
  | { kind: "history"; targets: QueryTarget[]; query: HistoryQuery }
  | { kind: "stats"; targets: QueryTarget[] };

export type QueryResponse =
  | SearchResult
  | FileRow[]
  | HistoryPage
  | WorkspaceStats;

export class QueryExecutor {
  private dbs = new Map<string, DB>();
  /** Workspaces whose open already failed and was reported (avoids re-warning
   *  on every query; cleared by closeWorkspace/closeAll so a fix is retried). */
  private warned = new Set<string>();

  /** `warn` is injected because this class also runs inside the worker thread,
   *  where the electron-log based logger (which requires the electron module)
   *  is unavailable. */
  constructor(
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  /** Resolve targets to CoreTargets, opening read-only handles lazily.
   *  Targets whose DB cannot be opened (already removed, permissions,
   *  corruption) are skipped — mirroring Workspaces.allCores(), which skips
   *  failed initializations — but each failure is reported once so missing
   *  results/stats are diagnosable instead of silent. */
  private cores(targets: QueryTarget[]): cw.CoreTarget[] {
    const out: cw.CoreTarget[] = [];
    for (const t of targets) {
      let db = this.dbs.get(t.id);
      if (!db) {
        try {
          db = openDbReadonly(t.dbPath);
        } catch (e) {
          if (!this.warned.has(t.id)) {
            this.warned.add(t.id);
            this.warn(
              `failed to open workspace DB ${t.id} read-only; skipping it in query results: ${String(e)}`,
            );
          }
          continue;
        }
        this.warned.delete(t.id);
        this.dbs.set(t.id, db);
      }
      // Only `.db` is touched by the query layer; the rest of Core is
      // main-process state that read-only execution never needs.
      out.push({ id: t.id, core: { db } as Core });
    }
    return out;
  }

  run(req: QueryRequest): QueryResponse {
    const cores = this.cores(req.targets);
    switch (req.kind) {
      case "search":
        return req.refs
          ? cw.searchCollection(cores, req.refs, req.query)
          : cw.searchWorkspaces(cores, req.query);
      case "random":
        return req.refs
          ? cw.randomCollection(cores, req.refs, req.query)
          : cw.randomWorkspaces(cores, req.query);
      case "history":
        return cw.listHistoryWorkspaces(cores, req.query);
      case "stats": {
        let fileCount = 0;
        let scanAt: number | null = null;
        for (const { core } of cores) {
          fileCount += countFiles(core.db);
          const t = lastScanAt(core.db);
          if (t != null && (scanAt == null || t > scanAt)) scanAt = t;
        }
        return { fileCount, lastScanAt: scanAt };
      }
    }
  }

  /** Close one workspace's read-only handle (before its data dir is deleted —
   *  Windows cannot remove files that any process still has open). */
  closeWorkspace(id: string): void {
    this.warned.delete(id);
    const db = this.dbs.get(id);
    if (!db) return;
    this.dbs.delete(id);
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }

  closeAll(): void {
    this.warned.clear();
    for (const id of [...this.dbs.keys()]) this.closeWorkspace(id);
  }
}
