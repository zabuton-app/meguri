// Which paths the user's scan exclusions cover (#282). The patterns are user
// regexes, so they run in the auto-tag worker (as auto-tagging rules, see
// exclusionRule): one that never finishes on some path is left out there
// instead of freezing the app. The excluded folders are plain paths and are
// compared here.
//
// Indexed files a rule covers are hidden, not deleted (hideFiles):
// deleted_at keeps them out of every list, and scan_excluded_at keeps them out
// of Missing and the move detection, so the row (and its id, which collections
// and Watch Later refer to) is there again when no rule covers it any more.
// Not in queries/: the query worker imports those, and this reaches the logger.
import path from "node:path";
import { AUTO_TAG_CHUNK } from "../../shared/autoTag.js";
import {
  exclusionRule,
  exclusionSubject,
  inExcludedFolder,
  patternError,
  type ScanExclusions,
} from "../../shared/scanExclusions.js";
import type { AutoTagEngine, DeriveAutoTags } from "./autoTagDeriver.js";
import type { DB } from "./db.js";
import { nowUnix } from "./db.js";
import { scopedLog } from "./logger.js";

const log = scopedLog("scan");

/** A path relative to the workspace root, "/"-separated. */
export interface PathQuery {
  relPath: string;
  isDir: boolean;
}

/** Whether each path is excluded, in the same order. */
export type PathFilter = (paths: readonly PathQuery[]) => Promise<boolean[]>;

/**
 * The filter for one workspace, or null when nothing is excluded there. A
 * pattern that does not compile is left out with a warning: a save checks
 * them, so only a hand-edited one gets here, and it must not stop the scan.
 * Fails when the worker cannot run the patterns, or has left one out because
 * it did not finish (AutoTagRuleDroppedError, for the life of the app): what
 * they would have left out must not be indexed (or brought back) in their
 * place.
 */
export function scanExclusionFilter(
  exclusions: ScanExclusions,
  workspaceId: string | null,
  derive: DeriveAutoTags,
): PathFilter | null {
  const folders = new Set(
    workspaceId ? (exclusions.folders[workspaceId] ?? []) : [],
  );
  const rules = exclusions.patterns.flatMap((p) => {
    if (patternError(p) === null) return [exclusionRule(p)];
    log.warn("skipping a scan exclusion pattern that does not compile");
    return [];
  });
  if (rules.length === 0 && folders.size === 0) return null;
  // One object for the filter's life: the worker client holds an engine by
  // identity and sends it once.
  // Whole: a pattern the worker gives up on must not let what it covers in.
  const engine: AutoTagEngine = { rules, keywords: [], whole: true };
  return async (paths) => {
    const out = paths.map((p) => inExcludedFolder(folders, p.relPath, p.isDir));
    if (rules.length === 0) return out;
    const open = out.flatMap((excluded, i) => (excluded ? [] : [i]));
    for (let at = 0; at < open.length; at += AUTO_TAG_CHUNK) {
      const idxs = open.slice(at, at + AUTO_TAG_CHUNK);
      const tags = await derive(
        engine,
        idxs.map((i) => exclusionSubject(paths[i].relPath, paths[i].isDir)),
      );
      idxs.forEach((i, k) => {
        if (tags[k].length > 0) out[i] = true;
      });
    }
    return out;
  };
}

/**
 * Whether each file is covered: by a rule on its own path or on a folder
 * above it, which is what the scan would have skipped. For files indexed
 * before the rule was added. Each folder is checked once however many files
 * it holds.
 */
export async function coveredFiles(
  filter: PathFilter,
  relPaths: readonly string[],
): Promise<boolean[]> {
  const index = new Map<string, number>();
  const queries: PathQuery[] = [];
  const ask = (relPath: string, isDir: boolean) => {
    const key = `${isDir ? "d" : "f"}:${relPath}`;
    let i = index.get(key);
    if (i === undefined) {
      i = queries.length;
      index.set(key, i);
      queries.push({ relPath, isDir });
    }
    return i;
  };
  const asked = relPaths.map((relPath) => {
    const own = [ask(relPath, false)];
    for (
      let at = relPath.indexOf("/");
      at !== -1;
      at = relPath.indexOf("/", at + 1)
    ) {
      own.push(ask(relPath.slice(0, at), true));
    }
    return own;
  });
  const answers = await filter(queries);
  return asked.map((own) => own.some((i) => answers[i]));
}

/** rel_path is stored with the OS's separator; the rules use "/". */
const slashed = (relPath: string) =>
  path.sep === "/" ? relPath : relPath.split(path.sep).join("/");

/** Rows written per transaction, yielding to the event loop in between. */
const WRITE_CHUNK = 500;

/** Run `write` over `ids` a chunk at a time; stops once `signal` aborts. */
async function inChunks(
  db: DB,
  ids: readonly number[],
  signal: AbortSignal | undefined,
  write: (json: string) => number,
): Promise<number> {
  let done = 0;
  const chunk = db.transaction(write);
  for (let at = 0; at < ids.length; at += WRITE_CHUNK) {
    if (signal?.aborted) break;
    done += chunk(JSON.stringify(ids.slice(at, at + WRITE_CHUNK)));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return done;
}

/**
 * What `filter` changes in the index, without changing it: the files it
 * covers that are not hidden yet, and with `release`, the hidden files it no
 * longer covers (all of them when `filter` is null), less those `keep` holds.
 * Files removed from the index by hand (excluded_at) are left as they are.
 */
export async function scanExclusionChanges(
  db: DB,
  rootId: number,
  filter: PathFilter | null,
  {
    release,
    keep,
  }: {
    release: boolean;
    /** Hidden rows to keep hidden even when no rule covers them any more. */
    keep?: (relPath: string) => boolean;
  },
): Promise<{ hide: number[]; release: { id: number; relPath: string }[] }> {
  if (!filter && !release) return { hide: [], release: [] };
  // Only the rows that can change: with nothing excluded, the hidden ones.
  const which = !filter
    ? "scan_excluded_at IS NOT NULL"
    : release
      ? "1"
      : "scan_excluded_at IS NULL";
  const rows = db
    .prepare(
      `SELECT id, rel_path, scan_excluded_at FROM files
       WHERE root_id = ? AND excluded_at IS NULL AND ${which}`,
    )
    .all(rootId) as {
    id: number;
    rel_path: string;
    scan_excluded_at: number | null;
  }[];
  const covered = filter
    ? await coveredFiles(
        filter,
        rows.map((r) => slashed(r.rel_path)),
      )
    : rows.map(() => false);
  const out: Awaited<ReturnType<typeof scanExclusionChanges>> = {
    hide: [],
    release: [],
  };
  rows.forEach((r, i) => {
    if (covered[i] && r.scan_excluded_at === null) out.hide.push(r.id);
    else if (
      release &&
      !covered[i] &&
      r.scan_excluded_at !== null &&
      !keep?.(r.rel_path)
    )
      out.release.push({ id: r.id, relPath: r.rel_path });
  });
  return out;
}

/**
 * Hide these files: deleted_at keeps them out of every list, scan_excluded_at
 * out of Missing. Only rows still neither hidden nor removed from the index
 * are changed, since they were read before the patterns ran. Returns how many
 * were hidden; stops between chunks once `signal` aborts.
 */
export function hideFiles(
  db: DB,
  ids: readonly number[],
  signal?: AbortSignal,
): Promise<number> {
  const now = nowUnix();
  const hide = db
    .prepare(
      `UPDATE files SET deleted_at = COALESCE(deleted_at, ?), scan_excluded_at = ?
       WHERE id IN (SELECT value FROM json_each(?))
         AND excluded_at IS NULL AND scan_excluded_at IS NULL
       RETURNING id`,
    )
    .pluck();
  // As when a file is removed from the index: search finds no hidden file.
  const dropFts = db.prepare(
    "DELETE FROM files_fts WHERE rowid IN (SELECT value FROM json_each(?))",
  );
  return inChunks(db, ids, signal, (json) => {
    const hidden = hide.all(now, now, json) as number[];
    dropFts.run(JSON.stringify(hidden));
    return hidden.length;
  });
}

/**
 * Take the mark off these hidden files. They keep deleted_at: a file a scan
 * found was brought back by it already, so what is left is missing like any
 * file that is gone.
 */
export function releaseFiles(
  db: DB,
  ids: readonly number[],
  signal?: AbortSignal,
): Promise<number> {
  const release = db.prepare(
    `UPDATE files SET scan_excluded_at = NULL
     WHERE id IN (SELECT value FROM json_each(?)) AND scan_excluded_at IS NOT NULL`,
  );
  return inChunks(db, ids, signal, (json) => release.run(json).changes);
}

/** Hide what `filter` covers now (and let nothing back). */
export async function applyScanExclusions(
  db: DB,
  rootId: number,
  filter: PathFilter | null,
  signal?: AbortSignal,
): Promise<number> {
  const { hide } = await scanExclusionChanges(db, rootId, filter, {
    release: false,
  });
  return hideFiles(db, hide, signal);
}
