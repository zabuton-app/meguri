// Folder view queries: the child folders of one folder, and a folder selection
// expanded into its files. Nothing here is stored — folders are derived from
// files.rel_path on every call (see folderRange.ts for the range they map to).
//
// Per-database like the rest of queries/: rows come back without a
// workspaceId, which crossWorkspace.ts stamps on.
import type { DB } from "../db.js";
import { FILE_COLS, FILE_FROM, attachTags } from "./files.js";
import { FILE_HAS_THUMB } from "./thumbs.js";
import {
  FOLDER_FILE_FROM,
  PINNED_FILES,
  folderCondition,
  folderRange,
  type FolderRange,
} from "./folderRange.js";
import { joinFolder, parentOf } from "../../../shared/folderPath.js";
import type {
  FileRow,
  FolderEntry,
  FolderFilesResult,
  FolderListing,
} from "../types.js";

/** Tiles on a folder card's mosaic. */
const PREVIEW_COUNT = 4;

// Natural order the way a file manager shows it: case folded, digits compared
// as numbers ("Ep2" before "Ep10"). SQLite's collations can do neither.
const folderNameOrder = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** rel_path's separator; defaults to the running OS's. Injected by tests. */
interface SepOpt {
  sep?: string;
}

// Folder queries walk their folder's slice of the rel_path index (see
// PINNED_FILES for why the index is named).
const RANGED = PINNED_FILES;

const HAS_THUMB = `f.thumb_status = 'done' AND ${FILE_HAS_THUMB}`;

// Every non-root folder shares one statement shape (the root has no range),
// so the statements below are prepared once per call and reused per folder:
// better-sqlite3 does not cache prepare(), and a listing can name thousands.
const RANGE = "f.rel_path >= ? AND f.rel_path < ?";

/**
 * The folder's direct child folders (with how much each holds and a few files
 * for its mosaic) and how many files sit directly in it.
 *
 * A folder with no live media left — deleted, renamed away, or all excluded —
 * resolves to its nearest ancestor that still has some, so a view left open on
 * it after a rescan lands somewhere real instead of on an empty page.
 */
export function listFolders(
  db: DB,
  folder: string,
  opts: SepOpt = {},
): FolderListing {
  let path = folder;
  let range = folderRange(path, opts.sep);
  if (path !== "") {
    const live = db.prepare(
      `SELECT 1 FROM ${RANGED} WHERE f.deleted_at IS NULL AND ${RANGE} LIMIT 1`,
    );
    while (path !== "" && live.get(range.prefix, range.upper) === undefined) {
      path = parentOf(path);
      range = folderRange(path, opts.sep);
    }
  }

  const within = folderCondition(range, true);
  const where = within.sql ? ` AND ${within.sql}` : "";
  const from = within.sql ? RANGED : "files f";
  // One pass over the folder's slice of the rel_path index. `rest` is the part
  // below this folder; its first segment, when a separator follows it, is the
  // child folder the row is in, and the segment after that (when another
  // separator follows) is a folder inside that child — counted distinct, so
  // the card can say how many subfolders it holds.
  const children = db
    .prepare(
      `SELECT name, COUNT(*) AS count, COUNT(DISTINCT sub) AS subfolders
         FROM (SELECT name,
                      CASE WHEN instr(after, ?) > 0
                           THEN substr(after, 1, instr(after, ?) - 1)
                      END AS sub
                 FROM (SELECT substr(rest, 1, cut - 1) AS name,
                              substr(rest, cut + 1) AS after
                         FROM (SELECT rest, instr(rest, ?) AS cut
                                 FROM (SELECT substr(f.rel_path, ?) AS rest
                                         FROM ${from}
                                        WHERE f.deleted_at IS NULL${where}))
                        WHERE cut > 0))
        GROUP BY name`,
    )
    .all(range.sep, range.sep, range.sep, range.start, ...within.args) as {
    name: string;
    count: number;
    subfolders: number;
  }[];
  children.sort((a, b) => folderNameOrder.compare(a.name, b.name));

  const direct = folderCondition(range, false);
  const fileCount = db
    .prepare(
      `SELECT COUNT(*) FROM ${from} WHERE f.deleted_at IS NULL AND ${direct.sql}`,
    )
    .pluck()
    .get(...direct.args) as number;

  // Up to PREVIEW_COUNT files per child, those with a thumbnail first. One
  // bounded walk of each child's own index slice rather than one window
  // function over the parent: a window would read and rank every row below
  // it — the whole library, for the root. Filtering on "has a thumbnail"
  // (instead of sorting on it) keeps the walk in index order.
  const base = `SELECT ${FILE_COLS} ${FOLDER_FILE_FROM} WHERE f.deleted_at IS NULL AND ${RANGE}`;
  const withThumb = db.prepare(
    `${base} AND ${HAS_THUMB} ORDER BY f.rel_path LIMIT ?`,
  );
  const withoutThumb = db.prepare(
    `${base} AND NOT (${HAS_THUMB}) ORDER BY f.rel_path LIMIT ?`,
  );
  const previews = (r: FolderRange): FileRow[] => {
    const first = withThumb.all(r.prefix, r.upper, PREVIEW_COUNT) as FileRow[];
    if (first.length === PREVIEW_COUNT) return first;
    const rest = withoutThumb.all(
      r.prefix,
      r.upper,
      PREVIEW_COUNT - first.length,
    ) as FileRow[];
    return [...first, ...rest];
  };

  const folders: FolderEntry[] = children.map(({ name, count, subfolders }) => {
    const childPath = joinFolder(path, name);
    return {
      name,
      path: childPath,
      count,
      subfolders,
      previews: previews(folderRange(childPath, opts.sep)),
    };
  });
  return { path, folders, fileCount };
}

/**
 * Selected folders expanded into their files (at any depth), for a bulk edit.
 *
 * `limit` bounds the rows of the whole call, not of each folder: past the
 * bulk-edit cap the edit is refused anyway, so the renderer only needs to know
 * that the total went over — which `total` still tells it for a folder whose
 * rows were cut short or skipped.
 */
export function folderFiles(
  db: DB,
  paths: string[],
  opts: SepOpt & { limit: number },
): FolderFilesResult {
  let budget = opts.limit;
  // Two shapes: a folder's range, or (for the root, which has none) everything.
  const statements = (ranged: boolean) => {
    const where = `f.deleted_at IS NULL${ranged ? ` AND ${RANGE}` : ""}`;
    return {
      count: db
        .prepare(
          `SELECT COUNT(*) FROM ${ranged ? RANGED : "files f"} WHERE ${where}`,
        )
        .pluck(),
      rows: db.prepare(
        `SELECT ${FILE_COLS} ${ranged ? FOLDER_FILE_FROM : FILE_FROM} WHERE ${where} ORDER BY f.rel_path LIMIT ?`,
      ),
    };
  };
  const ranged = statements(true);
  return paths.map((path) => {
    const r = folderRange(path, opts.sep);
    const [stmt, bounds] =
      r.upper == null ? [statements(false), []] : [ranged, [r.prefix, r.upper]];
    const total = stmt.count.get(...bounds) as number;
    let found: FileRow[] = [];
    if (budget > 0 && total > 0) {
      found = stmt.rows.all(...bounds, budget) as FileRow[];
      // The bulk tag dialog tallies the selection's tags from its rows, so
      // a folder's files need theirs like any row from the list.
      attachTags(db, found);
      budget -= found.length;
    }
    return { path, total, rows: found };
  });
}
