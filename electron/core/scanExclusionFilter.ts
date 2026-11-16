// Which paths the user's scan exclusions cover (#282). The patterns are user
// regexes, so they run in the auto-tag worker (as auto-tagging rules, see
// exclusionRule): one that never finishes on some path is left out there
// instead of freezing the app. The excluded folders are plain paths and are
// compared here.
//
// Indexed files a rule covers are hidden, not deleted (applyScanExclusions):
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
 * Fails when the worker cannot run the patterns: what they would have left
 * out must not be indexed (or brought back) in their place.
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
  const engine: AutoTagEngine = { rules, keywords: [] };
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

/**
 * Hide the files `filter` covers. With `release`, also take the mark off the
 * hidden files it no longer covers (all of them when `filter` is null). Those
 * keep deleted_at: the scan that follows brings back the ones still there,
 * and the rest are then missing like any file that is gone. Files removed
 * from the index by hand (excluded_at) are left as they are.
 *
 * The rows are read, then the patterns run (in the worker), then the rows are
 * written: a row is only changed if it is still in the state it was read in.
 * Nothing is written once `signal` is aborted.
 */
export async function applyScanExclusions(
  db: DB,
  rootId: number,
  filter: PathFilter | null,
  {
    release,
    keep,
    signal,
  }: {
    release: boolean;
    /** Hidden rows to keep hidden even when no rule covers them any more. */
    keep?: (relPath: string) => boolean;
    signal?: AbortSignal;
  },
): Promise<{ hidden: number; released: number }> {
  const rows = db
    .prepare(
      `SELECT id, rel_path, scan_excluded_at FROM files
       WHERE root_id = ? AND excluded_at IS NULL
         AND (scan_excluded_at IS NULL OR ?)`,
    )
    .all(rootId, release ? 1 : 0) as {
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
  const hide: number[] = [];
  const unmark: number[] = [];
  rows.forEach((r, i) => {
    if (covered[i] && r.scan_excluded_at === null) hide.push(r.id);
    else if (!covered[i] && r.scan_excluded_at !== null && !keep?.(r.rel_path))
      unmark.push(r.id);
  });
  if (signal?.aborted || (hide.length === 0 && unmark.length === 0))
    return { hidden: 0, released: 0 };
  const now = nowUnix();
  return db.transaction(() => {
    const hidden = db
      .prepare(
        `UPDATE files SET deleted_at = COALESCE(deleted_at, ?), scan_excluded_at = ?
         WHERE id IN (SELECT value FROM json_each(?))
           AND excluded_at IS NULL AND scan_excluded_at IS NULL
         RETURNING id`,
      )
      .pluck()
      .all(now, now, JSON.stringify(hide)) as number[];
    // As when a file is removed from the index: search finds no hidden file.
    db.prepare(
      "DELETE FROM files_fts WHERE rowid IN (SELECT value FROM json_each(?))",
    ).run(JSON.stringify(hidden));
    const released = db
      .prepare(
        `UPDATE files SET scan_excluded_at = NULL
         WHERE id IN (SELECT value FROM json_each(?)) AND scan_excluded_at IS NOT NULL`,
      )
      .run(JSON.stringify(unmark)).changes;
    return { hidden: hidden.length, released };
  })();
}
