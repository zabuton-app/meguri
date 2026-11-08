// Core state shared across the app. Holds the DB and root.
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db.js";
import { migrateWorkspaceMetadata } from "./library.js";
import {
  backupDbPathForDataDir,
  dataDirForRoot,
  dbPathForDataDir,
  pathHash,
} from "./paths.js";
import { upsertScanRoot } from "./queries.js";

export class Core {
  readonly db: DB;
  readonly root: string;
  readonly rootId: number;
  readonly dataDir: string;
  /** The SQLite file behind `db`; the query worker opens its own handle on it. */
  readonly dbPath: string;
  /** The library shared by every workspace, attached to `db` as `lib`. */
  readonly libraryPath: string;

  private constructor(
    db: DB,
    root: string,
    rootId: number,
    dataDir: string,
    libraryPath: string,
  ) {
    this.db = db;
    this.root = root;
    this.rootId = rootId;
    this.dataDir = dataDir;
    this.dbPath = dbPathForDataDir(dataDir);
    this.libraryPath = libraryPath;
  }

  static init(rawRoot: string, libraryPath: string): Core {
    let root: string;
    try {
      root = fs.realpathSync(rawRoot);
    } catch {
      root = path.resolve(rawRoot);
    }
    const dataDir = dataDirForRoot(root);
    fs.mkdirSync(path.join(dataDir, "thumbs"), { recursive: true });

    const db = openDb(dbPathForDataDir(dataDir), libraryPath);
    try {
      // The id the data directory is named after, so it means the same database
      // however the root path was spelled when the workspace was added.
      migrateWorkspaceMetadata(
        db,
        pathHash(root),
        backupDbPathForDataDir(dataDir),
      );
      const rootId = upsertScanRoot(db, root, pathHash(root));
      return new Core(db, root, rootId, dataDir, libraryPath);
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
