// Fixture for trying the graph view at scale (specs/013-graph-view/quickstart.md).
//
//   node scripts/dev/seed-graph-fixture.mjs files <dir> <count>
//     Writes <count> small PNGs, each a different colour (so each has its own
//     content hash), spread over 50 sub-folders.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/dev/seed-graph-fixture.mjs tags <dir> [userDataDir]
//     After the app has scanned <dir>: tags its files in the workspace DB with
//     200 manual tags, 1-4 per file, skewed so a few tags become large hubs.
//     Runs under Electron because better-sqlite3 is built for Electron's ABI.
//     userDataDir defaults to the platform's Meguri directory; pass the one
//     the app ran with (--user-data-dir) to keep a throwaway profile.
//     Quit the app first: it holds the DB open.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const TAGS = 200;
const FOLDERS = 50;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8x8 RGB PNG of one colour. */
function png(r, g, b) {
  const size = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(size).fill([r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeFiles(dir, count) {
  for (let i = 0; i < count; i++) {
    const sub = path.join(dir, `folder${String(i % FOLDERS).padStart(2, "0")}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, `image${String(i).padStart(5, "0")}.png`),
      png(i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff),
    );
  }
  console.log(`wrote ${count} images under ${dir}`);
}

function defaultUserData() {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "Meguri");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Meguri");
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "Meguri",
  );
}

function tagFiles(dir, userData) {
  // Same id as Workspaces.idFor(): SHA1 of the normalized root, 16 hex chars.
  const root = path.resolve(dir);
  const id = crypto.createHash("sha1").update(root).digest("hex").slice(0, 16);
  const dbPath = path.join(userData, "roots", id, "db.sqlite");
  if (!fs.existsSync(dbPath))
    throw new Error(`no workspace DB at ${dbPath}; scan ${root} first`);
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);

  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const keys = db
    .prepare("SELECT meta_key FROM files WHERE deleted_at IS NULL")
    .pluck()
    .all();
  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    const upsert = db.prepare(
      "INSERT INTO tags (namespace, name) VALUES ('', ?) ON CONFLICT(namespace, name) DO NOTHING",
    );
    const idOf = db
      .prepare("SELECT id FROM tags WHERE namespace = '' AND name = ?")
      .pluck();
    const ids = [];
    for (let t = 0; t < TAGS; t++) {
      upsert.run(`topic${String(t).padStart(3, "0")}`);
      ids.push(idOf.get(`topic${String(t).padStart(3, "0")}`));
    }
    const link = db.prepare(
      "INSERT OR IGNORE INTO meta_tags (meta_key, tag_id, source, score) VALUES (?, ?, 'manual', NULL)",
    );
    for (const key of keys) {
      const n = 1 + Math.floor(rnd() * 4);
      // Cubing a uniform value skews toward low indices: a few big hubs.
      for (let k = 0; k < n; k++)
        link.run(key, ids[Math.floor(TAGS * rnd() ** 3)]);
    }
    // Keep the full-text index in step (manual tag names are searchable).
    db.exec("DELETE FROM files_fts");
    db.exec(`INSERT INTO files_fts (rowid, rel_path, tags_text)
      SELECT f.id, f.rel_path,
             COALESCE((SELECT group_concat(name, ' ') FROM
               (SELECT DISTINCT t.name AS name
                FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id
                WHERE mt.meta_key = f.meta_key AND t.namespace = ''
                ORDER BY name)), '')
      FROM files f WHERE f.deleted_at IS NULL`);
  })();
  db.close();
  console.log(`tagged ${keys.length} files in ${dbPath} (${now})`);
}

const [mode, dir, arg] = process.argv.slice(2);
if (mode === "files" && dir) writeFiles(dir, Number(arg ?? 5000));
else if (mode === "tags" && dir) tagFiles(dir, arg ?? defaultUserData());
else {
  console.error(
    "usage: seed-graph-fixture.mjs files <dir> <count> | tags <dir> [userDataDir]",
  );
  process.exit(1);
}
