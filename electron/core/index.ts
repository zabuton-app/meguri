// Core state shared across the app. Holds the DB and root.
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db.js";
import {
  catchUpTagIndex,
  migrateWorkspaceMetadata,
  type MergeOutcome,
} from "./library.js";
import log from "./logger.js";
import {
  backupDbPathForDataDir,
  dataDirForRoot,
  dbPathForDataDir,
  pathHash,
} from "./paths.js";
import { upsertScanRoot } from "./queries.js";
import type { LibraryMergeFailureReason } from "../../shared/ipc/schema.js";

export class Core {
  readonly db: DB;
  readonly root: string;
  readonly rootId: number;
  readonly dataDir: string;
  /** The SQLite file behind `db`; the query worker opens its own handle on it. */
  readonly dbPath: string;
  /** The library shared by every workspace, attached to `db` as `lib`. */
  readonly libraryPath: string;
  /** Whether opening this workspace merged its own metadata into the library,
   *  changing tags the other workspaces may index. */
  readonly mergedOnOpen: boolean;
  /** Why its metadata is still on its own tables, when it is. */
  readonly mergeFailureReason: LibraryMergeFailureReason | undefined;

  private constructor(
    db: DB,
    root: string,
    rootId: number,
    dataDir: string,
    libraryPath: string,
    { merged, failure }: MergeOutcome,
  ) {
    this.db = db;
    this.root = root;
    this.rootId = rootId;
    this.dataDir = dataDir;
    this.dbPath = dbPathForDataDir(dataDir);
    this.libraryPath = libraryPath;
    this.mergedOnOpen = merged;
    this.mergeFailureReason = failure;
  }

  /** The root as Core.init resolves it: symlinks followed where it exists. */
  static resolveRoot(rawRoot: string): string {
    try {
      return fs.realpathSync(rawRoot);
    } catch {
      return path.resolve(rawRoot);
    }
  }

  /** The id `lib.migrated_workspaces` records a workspace under, which also
   *  names its data directory. */
  static dataIdFor(rawRoot: string): string {
    return pathHash(Core.resolveRoot(rawRoot));
  }

  static init(rawRoot: string, libraryPath: string): Core {
    const root = Core.resolveRoot(rawRoot);
    const dataDir = dataDirForRoot(root);
    fs.mkdirSync(path.join(dataDir, "thumbs"), { recursive: true });

    const db = openDb(dbPathForDataDir(dataDir), libraryPath);
    try {
      // The id the data directory is named after, so it means the same database
      // however the root path was spelled when the workspace was added.
      const outcome = migrateWorkspaceMetadata(
        db,
        pathHash(root),
        backupDbPathForDataDir(dataDir),
      );
      // Tags may have changed through other workspaces while this one was
      // closed. A failure leaves the index as it was: searching still works,
      // and the next catch-up tries again.
      try {
        catchUpTagIndex(db);
      } catch (e) {
        log.warn("could not bring the tag index up to date on open:", e);
      }
      const rootId = upsertScanRoot(db, root, pathHash(root));
      return new Core(db, root, rootId, dataDir, libraryPath, outcome);
    } catch (e) {
      // Not left open: the caller retries on the next access, and an open
      // handle keeps Windows from deleting the directory on removal.
      db.close();
      throw e;
    }
  }

  thumbsDir(): string {
    return path.join(this.dataDir, "thumbs");
  }

  /** Close the DB handle. Needed before deleting the data directory (esp. on Windows). */
  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed / never opened
    }
  }
}
