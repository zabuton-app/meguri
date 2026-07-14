// Core state shared across the app. Holds the DB and root.
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db.js";
import { dataDirForRoot, pathHash } from "./paths.js";
import { upsertScanRoot } from "./queries.js";

export class Core {
  readonly db: DB;
  readonly root: string;
  readonly rootId: number;
  readonly dataDir: string;

  private constructor(db: DB, root: string, rootId: number, dataDir: string) {
    this.db = db;
    this.root = root;
    this.rootId = rootId;
    this.dataDir = dataDir;
  }

  static init(rawRoot: string): Core {
    let root: string;
    try {
      root = fs.realpathSync(rawRoot);
    } catch {
      root = path.resolve(rawRoot);
    }
    const dataDir = dataDirForRoot(root);
    fs.mkdirSync(path.join(dataDir, "thumbs"), { recursive: true });

    const db = openDb(path.join(dataDir, "db.sqlite"));
    const rootId = upsertScanRoot(db, root, pathHash(root));

    return new Core(db, root, rootId, dataDir);
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
