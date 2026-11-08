// Regression tests for the scan pipeline: extension classification, sampled content_hash,
// and the incremental syncFiles lifecycle (insert / unchanged / move / update / delete).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";
import {
  contentHash,
  kindForExt,
  looksLikeMpegTs,
  syncFiles,
  walk,
} from "../scan.js";

/** `packets` MPEG-TS packets (sync byte + null-PID filler), optionally in the M2TS layout. */
function tsBytes(packets: number, m2ts = false): Buffer {
  const prefix = m2ts ? 4 : 0;
  const stride = 188 + prefix;
  const buf = Buffer.alloc(stride * packets, 0xff);
  for (let i = 0; i < packets; i++) {
    const at = i * stride;
    if (m2ts) buf.writeUInt32BE(0, at); // timecode prefix
    buf[at + prefix] = 0x47;
    buf[at + prefix + 1] = 0x1f; // PID 0x1fff (null packet)
    buf[at + prefix + 2] = 0xff;
    buf[at + prefix + 3] = 0x10;
  }
  return buf;
}

const TYPESCRIPT_SOURCE = `import { foo } from "./foo";

export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`.repeat(10);

describe("kindForExt", () => {
  it("classifies known video and image extensions case-insensitively", () => {
    expect(kindForExt("mp4")).toBe("video");
    expect(kindForExt("MKV")).toBe("video");
    expect(kindForExt("jpg")).toBe("image");
    expect(kindForExt("WEBP")).toBe("image");
  });

  it("classifies every supported audio extension case-insensitively", () => {
    for (const ext of ["mp3", "m4a", "aac", "flac", "ogg", "opus", "wav"]) {
      expect(kindForExt(ext)).toBe("audio");
      expect(kindForExt(ext.toUpperCase())).toBe("audio");
    }
  });

  it("keeps m4v as video and m4a as audio (adjacent extensions, different sets)", () => {
    expect(kindForExt("m4v")).toBe("video");
    expect(kindForExt("m4a")).toBe("audio");
  });

  it("returns null for unknown extensions", () => {
    expect(kindForExt("txt")).toBeNull();
    expect(kindForExt("")).toBeNull();
    expect(kindForExt("doc")).toBeNull();
  });
});

describe("looksLikeMpegTs", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-sniff-"));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function sniff(name: string, data: string | Buffer): Promise<boolean> {
    const f = path.join(dir, name);
    await fsp.writeFile(f, data);
    return looksLikeMpegTs(f);
  }

  it("accepts a real MPEG-TS header", async () => {
    expect(await sniff("rec.ts", tsBytes(8))).toBe(true);
  });

  it("accepts a short stream of two packets and a trailing partial packet", async () => {
    expect(
      await sniff("short.ts", Buffer.concat([tsBytes(2), Buffer.alloc(50)])),
    ).toBe(true);
  });

  it("accepts the 192-byte M2TS layout", async () => {
    expect(await sniff("bd.ts", tsBytes(8, true))).toBe(true);
  });

  it("rejects TypeScript sources and declaration files", async () => {
    expect(await sniff("app.ts", TYPESCRIPT_SOURCE)).toBe(false);
    expect(
      await sniff(
        "standalone.d.ts",
        "export declare function format(src: string): Promise<string>;\n".repeat(
          20,
        ),
      ),
    ).toBe(false);
  });

  it('rejects text that merely starts with the sync byte ("G")', async () => {
    expect(await sniff("g.ts", "Global" + "x".repeat(1000))).toBe(false);
  });

  it("rejects an empty file and a file shorter than one packet", async () => {
    expect(await sniff("empty.ts", "")).toBe(false);
    expect(await sniff("tiny.ts", tsBytes(1).subarray(0, 100))).toBe(false);
  });

  it("rejects a single packet (too little to confirm the stride)", async () => {
    expect(await sniff("one.ts", tsBytes(1))).toBe(false);
  });

  it("rejects a stream whose later packet loses sync", async () => {
    const buf = tsBytes(4);
    buf[188 * 2] = 0x00;
    expect(await sniff("broken.ts", buf)).toBe(false);
  });

  it("returns false for a missing file", async () => {
    expect(await looksLikeMpegTs(path.join(dir, "nope.ts"))).toBe(false);
  });

  it("keeps the extension's verdict when the file exists but can't be read", async () => {
    // A directory opens but fails to read (EISDIR), standing in for an I/O error.
    const sub = path.join(dir, "unreadable.ts");
    await fsp.mkdir(sub);
    expect(await looksLikeMpegTs(sub)).toBe(true);
  });
});

describe("contentHash", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-hash-"));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("is stable and content-addressed: identical content under different names hashes equally", async () => {
    const a = path.join(dir, "a.bin");
    const b = path.join(dir, "b.bin");
    await fsp.writeFile(a, "hello world");
    await fsp.writeFile(b, "hello world");
    const ha = await contentHash(a);
    expect(await contentHash(a)).toBe(ha); // stable
    expect(await contentHash(b)).toBe(ha); // content-addressed (move detection relies on this)
  });

  it("changes when the content changes", async () => {
    const f = path.join(dir, "c.bin");
    await fsp.writeFile(f, "one");
    const h1 = await contentHash(f);
    await fsp.writeFile(f, "two!!");
    expect(await contentHash(f)).not.toBe(h1);
  });
});

describe("syncFiles lifecycle", () => {
  let db: DB;
  let root: string;
  let rootId: number;

  beforeEach(async () => {
    db = openDb(":memory:", ":memory:");
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-scan-"));
    rootId = upsertScanRoot(db, root, "deadbeef");
  });
  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function rescan() {
    const discovered = await walk(root);
    return syncFiles(db, rootId, discovered);
  }

  function aliveCount(): number {
    return (
      db
        .prepare("SELECT COUNT(*) c FROM files WHERE deleted_at IS NULL")
        .get() as { c: number }
    ).c;
  }

  it("carries metadata from the path key to the hash key when a hash first appears", async () => {
    const file = path.join(root, "late.mp4");
    await fsp.writeFile(file, "BBBBBBBBBB");
    await rescan();
    const row = db
      .prepare("SELECT id, abs_path FROM files WHERE rel_path = 'late.mp4'")
      .get() as { id: number; abs_path: string };
    // Emulate a scan that stored the row before hashing it: the metadata then
    // lives under the absolute-path key.
    db.prepare("UPDATE files SET content_hash = NULL WHERE id = ?").run(row.id);
    const pathKey = `p:${row.abs_path}`;
    db.prepare(
      "INSERT INTO file_meta (meta_key, favorite, rating, updated_at) VALUES (?, 1, 4, 0)",
    ).run(pathKey);

    await fsp.writeFile(file, "CCCCCCCCCCCC");
    await fsp.utimes(file, new Date(), new Date(Date.now() + 60_000));
    await rescan();

    const after = db
      .prepare(
        "SELECT f.content_hash AS hash, m.favorite, m.rating FROM files f JOIN file_meta m ON m.meta_key = f.meta_key WHERE f.id = ?",
      )
      .get(row.id) as { hash: string | null; favorite: number; rating: number };
    expect(after.hash).not.toBeNull();
    expect(after).toMatchObject({ favorite: 1, rating: 4 });
    expect(
      db.prepare("SELECT 1 FROM file_meta WHERE meta_key = ?").get(pathKey),
    ).toBeUndefined();
  });

  it("re-derives kind/ext when a move changes the extension", async () => {
    // The same bytes are video as .mp4 and audio as .m4a. Move detection is
    // content-hash based, so this is seen as a move rather than insert+delete —
    // and the row must not keep describing itself as the old kind.
    await fsp.writeFile(path.join(root, "clip.mp4"), "AAAAAAAAAA");
    await rescan();
    db.prepare(
      "UPDATE files SET thumb_status = 'done', thumb_path = '/t.webp'",
    ).run();

    await fsp.rename(path.join(root, "clip.mp4"), path.join(root, "clip.m4a"));
    const after = await rescan();
    expect(after.stats.moved).toBe(1);

    const row = db
      .prepare("SELECT kind, ext, thumb_status, thumb_path FROM files")
      .get() as {
      kind: string;
      ext: string;
      thumb_status: string;
      thumb_path: string | null;
    };
    expect(row.kind).toBe("audio");
    expect(row.ext).toBe("m4a");
    // The old video thumbnail no longer describes the row; audio has none at all.
    expect(row.thumb_path).toBeNull();
    expect(row.thumb_status).toBe("pending");
    // Audio never needs a thumbnail, so it is not queued for one.
    expect(after.needsThumb).toEqual([]);
  });

  it("queues a thumbnail again when a move changes the kind to a visual one", async () => {
    await fsp.writeFile(path.join(root, "track.m4a"), "AAAAAAAAAA");
    await rescan();
    const id = (db.prepare("SELECT id FROM files").get() as { id: number }).id;

    await fsp.rename(
      path.join(root, "track.m4a"),
      path.join(root, "track.mp4"),
    );
    const after = await rescan();
    expect(after.stats.moved).toBe(1);
    const row = db.prepare("SELECT kind, ext FROM files").get() as {
      kind: string;
      ext: string;
    };
    expect(row.kind).toBe("video");
    expect(row.ext).toBe("mp4");
    expect(after.needsThumb).toContain(id);
  });

  it("stores btime on insert and backfills NULL btime on an unchanged re-scan", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    // Expected value computed the same way walk() does, so the assertion holds
    // on filesystems both with and without birthtime support.
    const st = await fsp.stat(path.join(root, "a.mp4"));
    const expected =
      st.birthtimeMs > 0 ? Math.floor(st.birthtimeMs / 1000) : null;

    await rescan();
    const btimeOf = () =>
      (db.prepare("SELECT btime FROM files").get() as { btime: number | null })
        .btime;
    expect(btimeOf()).toBe(expected);

    // Rows scanned before the column existed have NULL btime; an unchanged
    // re-scan must repopulate it.
    db.prepare("UPDATE files SET btime = NULL").run();
    const second = await rescan();
    expect(second.stats.unchanged).toBe(1);
    expect(btimeOf()).toBe(expected);
  });

  it("inserts, then reports unchanged, then tracks a move/update/delete", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    await fsp.mkdir(path.join(root, "sub"));
    await fsp.writeFile(path.join(root, "sub", "b.mp4"), "BBBBBBBBBB");

    // 1. Initial scan: both inserted, both flagged for thumbnails.
    const first = await rescan();
    expect(first.stats.inserted).toBe(2);
    expect(first.needsThumb.length).toBe(2);
    expect(aliveCount()).toBe(2);

    // 2. Re-scan with no changes: everything unchanged, nothing needs a thumbnail.
    const second = await rescan();
    expect(second.stats).toMatchObject({
      inserted: 0,
      updated: 0,
      moved: 0,
      deleted: 0,
      unchanged: 2,
    });
    expect(second.needsThumb.length).toBe(0);

    // 3. Rename a.mp4 -> c.mp4 (same bytes): detected as a move, not insert+delete.
    await fsp.rename(path.join(root, "a.mp4"), path.join(root, "c.mp4"));
    const third = await rescan();
    expect(third.stats.moved).toBe(1);
    expect(third.stats.inserted).toBe(0);
    expect(third.stats.deleted).toBe(0);
    expect(aliveCount()).toBe(2);
    const rel = db
      .prepare(
        "SELECT rel_path FROM files WHERE deleted_at IS NULL ORDER BY rel_path",
      )
      .all() as { rel_path: string }[];
    expect(rel.map((r) => r.rel_path)).toEqual([
      "c.mp4",
      path.join("sub", "b.mp4"),
    ]);

    // 4. Change b.mp4's content (size differs): detected as an update and re-flagged for a thumbnail.
    await fsp.writeFile(
      path.join(root, "sub", "b.mp4"),
      "BBBBBBBBBBBBBBBBBBBB",
    );
    const fourth = await rescan();
    expect(fourth.stats.updated).toBe(1);
    expect(fourth.needsThumb.length).toBe(1);

    // 5. Remove c.mp4: soft-deleted (row kept with deleted_at) and excluded from the alive set.
    await fsp.rm(path.join(root, "c.mp4"));
    const fifth = await rescan();
    expect(fifth.stats.deleted).toBe(1);
    expect(aliveCount()).toBe(1);
    const totalRows = (
      db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }
    ).c;
    expect(totalRows).toBe(2); // soft delete keeps the row
  });

  it("drops a .ts row indexed by an older scan once its content is found not to be MPEG-TS", async () => {
    const f = path.join(root, "app.ts");
    await fsp.writeFile(f, TYPESCRIPT_SOURCE);
    const st = await fsp.stat(f);
    // What the extension-only walk used to produce for this file.
    await syncFiles(db, rootId, [
      {
        absPath: f,
        relPath: "app.ts",
        ext: "ts",
        kind: "video",
        size: st.size,
        mtime: Math.floor(st.mtimeMs / 1000),
        btime: null,
        inode: Number(st.ino),
      },
    ]);
    expect(aliveCount()).toBe(1);

    const { stats } = await rescan();
    expect(stats.deleted).toBe(1);
    expect(aliveCount()).toBe(0);
  });

  it("does not re-insert a returning file: a deleted-then-restored file is revived in place", async () => {
    const f = path.join(root, "x.mp4");
    await fsp.writeFile(f, "XXXXXXXXXX");
    await rescan();
    const id = (
      db.prepare("SELECT id FROM files WHERE rel_path = 'x.mp4'").get() as {
        id: number;
      }
    ).id;

    await fsp.rm(f);
    const del = await rescan();
    expect(del.stats.deleted).toBe(1);

    await fsp.writeFile(f, "XXXXXXXXXX");
    const restored = await rescan();
    // Same rel_path returns: the original row is reused (move path), not a brand-new id.
    const sameId = (
      db
        .prepare(
          "SELECT id FROM files WHERE rel_path = 'x.mp4' AND deleted_at IS NULL",
        )
        .get() as {
        id: number;
      }
    ).id;
    expect(sameId).toBe(id);
    expect(restored.stats.inserted).toBe(0);
  });
});

describe("walk", () => {
  let root: string;
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-walk-"));
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("recurses into subdirectories but skips hidden entries and non-media files", async () => {
    await fsp.writeFile(path.join(root, "keep.mp4"), "x");
    await fsp.writeFile(path.join(root, "note.txt"), "x"); // non-media: skipped
    await fsp.writeFile(path.join(root, ".secret.mp4"), "x"); // hidden: skipped
    await fsp.mkdir(path.join(root, ".hidden"));
    await fsp.writeFile(path.join(root, ".hidden", "in.mp4"), "x"); // under hidden dir: skipped
    await fsp.mkdir(path.join(root, "vids"));
    await fsp.writeFile(path.join(root, "vids", "deep.webm"), "x");

    const found = (await walk(root)).map((d) => d.relPath).sort();
    expect(found).toEqual(["keep.mp4", path.join("vids", "deep.webm")]);
    expect(fs.existsSync(path.join(root, "note.txt"))).toBe(true); // sanity: file existed, just not indexed
  });

  it("keeps real MPEG-TS files and skips TypeScript .ts files", async () => {
    await fsp.writeFile(path.join(root, "rec.ts"), tsBytes(8));
    await fsp.writeFile(path.join(root, "bd.TS"), tsBytes(8, true));
    await fsp.writeFile(path.join(root, "app.ts"), TYPESCRIPT_SOURCE);
    await fsp.writeFile(path.join(root, "types.d.ts"), "export {};\n");

    const found = (await walk(root)).map((d) => d.relPath).sort();
    expect(found).toEqual(["bd.TS", "rec.ts"]);
  });

  it("does not descend into node_modules", async () => {
    await fsp.mkdir(path.join(root, "node_modules", "pkg"), {
      recursive: true,
    });
    await fsp.writeFile(path.join(root, "node_modules", "pkg", "a.mp4"), "x");
    await fsp.writeFile(path.join(root, "keep.mp4"), "x");

    const found = (await walk(root)).map((d) => d.relPath);
    expect(found).toEqual(["keep.mp4"]);
  });
});
