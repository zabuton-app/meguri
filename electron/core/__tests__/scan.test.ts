// Regression tests for the scan pipeline: extension classification, sampled content_hash,
// and the incremental syncFiles lifecycle (insert / unchanged / move / update / delete).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb, rebuildFtsAll, type DB } from "../db.js";
import {
  clearExcludedFiles,
  deleteFromIndex,
  upsertScanRoot,
} from "../queries.js";
import { addManualTag, fileTags, syncFts } from "../tags.js";
import { AUTO_META_SOURCE } from "../autoMetaTags.js";
import {
  contentHash,
  isMountpoint,
  kindForExt,
  looksLikeMpegTs,
  ScanRootUnreadableError,
  syncFiles,
  unreadableMatcher,
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

  // A handle on the real file whose reads return at most `chunk` bytes, and
  // nothing past `eof` (a file that shrank after its size was taken).
  const shortReads = (chunk: number, eof = Infinity) => {
    const open = fsp.open.bind(fsp);
    return vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const fd = await open(...args);
      const read = fd.read.bind(fd) as (
        buf: Buffer,
        off: number,
        len: number,
        pos: number,
      ) => ReturnType<typeof fd.read>;
      return Object.assign(fd, {
        read: (buf: Buffer, off: number, len: number, pos: number) =>
          pos >= eof
            ? Promise.resolve({ bytesRead: 0, buffer: buf })
            : read(buf, off, Math.min(len, chunk, eof - pos), pos),
      });
    });
  };
  afterEach(() => vi.restoreAllMocks());

  it("reads on through short reads (#263)", async () => {
    const f = path.join(dir, "d.bin");
    await fsp.writeFile(f, "hello world, read in pieces");
    const whole = await contentHash(f);
    shortReads(3);
    expect(await contentHash(f)).toBe(whole);
  });

  it("throws with a code when the file ends early", async () => {
    const f = path.join(dir, "e.bin");
    await fsp.writeFile(f, "hello world");
    shortReads(64, 5);
    await expect(contentHash(f)).rejects.toMatchObject({ code: "ESHRUNK" });
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

  describe("a file whose content changed in place (#263)", () => {
    const keyOf = (relPath: string) =>
      (
        db
          .prepare("SELECT meta_key FROM files WHERE rel_path = ?")
          .get(relPath) as { meta_key: string }
      ).meta_key;
    const meta = (key: string) =>
      db
        .prepare("SELECT favorite, rating FROM file_meta WHERE meta_key = ?")
        .get(key);
    const bookmarks = (key: string) =>
      db
        .prepare("SELECT sec FROM scene_bookmarks WHERE meta_key = ?")
        .pluck()
        .all(key);
    const plays = (key: string) =>
      db
        .prepare(
          "SELECT position FROM play_history WHERE meta_key = ? ORDER BY position",
        )
        .pluck()
        .all(key);
    const setMeta = (key: string, favorite: number, rating: number) =>
      db
        .prepare(
          "INSERT INTO file_meta (meta_key, favorite, rating, updated_at) VALUES (?, ?, ?, 0)",
        )
        .run(key, favorite, rating);
    const bookmark = (key: string, sec: number) =>
      db
        .prepare(
          "INSERT INTO scene_bookmarks (meta_key, sec, created_at) VALUES (?, ?, 0)",
        )
        .run(key, sec);
    const play = (key: string, position: number) =>
      db
        .prepare(
          "INSERT INTO play_history (meta_key, played_at, position, via) VALUES (?, 100, ?, 'browser')",
        )
        .run(key, position);
    const edit = async (file: string, content: string) => {
      await fsp.writeFile(file, content);
      await fsp.utimes(file, new Date(), new Date(Date.now() + 60_000));
    };

    it("copies its metadata to the new content", async () => {
      const file = path.join(root, "song.mp3");
      await fsp.writeFile(file, "BBBBBBBBBB");
      await rescan();
      const row = db
        .prepare("SELECT id FROM files WHERE rel_path = 'song.mp3'")
        .get() as { id: number };
      const oldKey = keyOf("song.mp3");
      setMeta(oldKey, 1, 4);
      addManualTag(db, row.id, "Live");
      // A tag derived from the content, which the new content gets its own of.
      const derived = Number(
        db
          .prepare("INSERT INTO tags (namespace, name) VALUES ('res', '720p')")
          .run().lastInsertRowid,
      );
      db.prepare(
        "INSERT INTO meta_tags (meta_key, tag_id, source) VALUES (?, ?, ?)",
      ).run(oldKey, derived, AUTO_META_SOURCE);
      bookmark(oldKey, 12);
      play(oldKey, 30);

      // Its tags edited: new content, same path.
      await edit(file, "CCCCCCCCCCCC");
      const res = await rescan();

      expect(res.stats).toMatchObject({ updated: 1, inserted: 0 });
      const newKey = keyOf("song.mp3");
      expect(newKey).not.toBe(oldKey);
      // Copied, not moved: a copy elsewhere in the library may share the old
      // content and its metadata.
      for (const key of [newKey, oldKey]) {
        expect(meta(key)).toEqual({ favorite: 1, rating: 4 });
        expect(bookmarks(key)).toEqual([12]);
        expect(plays(key)).toEqual([30]);
      }
      expect(fileTags(db, row.id).map((t) => t.name)).toEqual(["Live"]);
      expect(
        db
          .prepare("SELECT COUNT(*) FROM meta_tags WHERE meta_key = ?")
          .pluck()
          .get(oldKey),
      ).toBe(2);
    });

    it("merges into what the library holds for the new content", async () => {
      const file = path.join(root, "a.mp4");
      await fsp.writeFile(file, "BBBBBBBBBB");
      await rescan();
      const oldKey = keyOf("a.mp4");
      setMeta(oldKey, 0, 2);
      bookmark(oldKey, 12);
      play(oldKey, 30);
      play(oldKey, 45);
      // The new content, known to another workspace sharing the library (or
      // this file's own before an edit that is now undone).
      const scratch = path.join(root, "..", `${path.basename(root)}-new`);
      await fsp.writeFile(scratch, "CCCCCCCCCCCC");
      const newKey = await contentHash(scratch);
      await fsp.rm(scratch);
      setMeta(newKey, 1, 1);
      bookmark(newKey, 12.1);
      play(newKey, 30);

      await edit(file, "CCCCCCCCCCCC");
      await rescan();

      expect(keyOf("a.mp4")).toBe(newKey);
      expect(meta(newKey)).toEqual({ favorite: 1, rating: 2 });
      // A bookmark near one it holds is not added again; the same play is
      // kept once, another position is another play.
      expect(bookmarks(newKey)).toEqual([12.1]);
      expect(plays(newKey)).toEqual([30, 45]);
    });

    it("does not copy to empty content, which every truncated file shares", async () => {
      const a = path.join(root, "a.mp4");
      const b = path.join(root, "b.mp4");
      await fsp.writeFile(a, "AAAAAAAAAA");
      await fsp.writeFile(b, "BBBBBBBBBBBB");
      await rescan();
      const aKey = keyOf("a.mp4");
      const bKey = keyOf("b.mp4");
      setMeta(aKey, 1, 5);
      setMeta(bKey, 0, 1);

      // A failed sync leaves both empty, then they are restored.
      await edit(a, "");
      await edit(b, "");
      await rescan();
      const emptyKey = keyOf("a.mp4");
      expect(meta(emptyKey)).toBeUndefined();
      await edit(a, "AAAAAAAAAA");
      await edit(b, "BBBBBBBBBBBB");
      await rescan();

      expect(meta(aKey)).toEqual({ favorite: 1, rating: 5 });
      expect(meta(bKey)).toEqual({ favorite: 0, rating: 1 });
    });

    it("does not hand out what empty files share to one that gets content", async () => {
      const a = path.join(root, "a.mp4");
      const b = path.join(root, "b.mp4");
      // Not written yet: both empty, so both under the one empty-content key.
      await fsp.writeFile(a, "");
      await fsp.writeFile(b, "");
      await rescan();
      const emptyKey = keyOf("a.mp4");
      expect(keyOf("b.mp4")).toBe(emptyKey);
      const aId = (
        db.prepare("SELECT id FROM files WHERE rel_path = 'a.mp4'").get() as {
          id: number;
        }
      ).id;
      addManualTag(db, aId, "OnlyA");
      setMeta(emptyKey, 1, 5);

      await edit(b, "BBBBBBBBBBBB");
      await rescan();

      const bId = (
        db.prepare("SELECT id FROM files WHERE rel_path = 'b.mp4'").get() as {
          id: number;
        }
      ).id;
      expect(fileTags(db, bId)).toEqual([]);
      expect(meta(keyOf("b.mp4"))).toBeUndefined();
    });

    // The path decides over the hash: accepted for the rare cases where the
    // two disagree (#263).
    it("takes its metadata to another file's content copied over it", async () => {
      const a = path.join(root, "a.mp4");
      const b = path.join(root, "b.mp4");
      await fsp.writeFile(a, "AAAAAAAAAA");
      await fsp.writeFile(b, "BBBBBBBBBBBB");
      await rescan();
      const aKey = keyOf("a.mp4");
      const bKey = keyOf("b.mp4");
      setMeta(aKey, 1, 5);

      // cp b.mp4 a.mp4
      await edit(a, "BBBBBBBBBBBB");
      await rescan();

      expect(keyOf("a.mp4")).toBe(bKey);
      expect(meta(bKey)).toEqual({ favorite: 1, rating: 5 });
      expect(meta(aKey)).toEqual({ favorite: 1, rating: 5 });
    });

    it("keeps both files' metadata when two files swap their content", async () => {
      const a = path.join(root, "a.mp4");
      const b = path.join(root, "b.mp4");
      await fsp.writeFile(a, "AAAAAAAAAA");
      await fsp.writeFile(b, "BBBBBBBBBBBB");
      await rescan();
      const aKey = keyOf("a.mp4");
      const bKey = keyOf("b.mp4");
      play(aKey, 30);
      play(bKey, 45);

      await edit(a, "BBBBBBBBBBBB");
      await edit(b, "AAAAAAAAAA");
      await rescan();

      // Merged: nothing is lost, and both now show both.
      expect(plays(aKey)).toEqual([30, 45]);
      expect(plays(bKey)).toEqual([30, 45]);
    });
  });

  it("carries metadata from the key the row derived, not from the path found now", async () => {
    const file = path.join(root, "late.mp4");
    await fsp.writeFile(file, "BBBBBBBBBB");
    await rescan();
    // A row stored without a hash, under a path spelled differently from the
    // one this scan finds: its metadata is under the key that path derives.
    const storedKey = "p:/elsewhere/late.mp4";
    db.prepare(
      "UPDATE files SET content_hash = NULL, abs_path = '/elsewhere/late.mp4' WHERE rel_path = 'late.mp4'",
    ).run();
    db.prepare(
      "INSERT INTO file_meta (meta_key, favorite, rating, updated_at) VALUES (?, 1, 4, 0)",
    ).run(storedKey);

    await fsp.writeFile(file, "CCCCCCCCCCCC");
    await fsp.utimes(file, new Date(), new Date(Date.now() + 60_000));
    await rescan();

    const after = db
      .prepare(
        "SELECT f.content_hash AS hash, m.favorite FROM files f JOIN file_meta m ON m.meta_key = f.meta_key WHERE f.rel_path = 'late.mp4'",
      )
      .get() as { hash: string | null; favorite: number } | undefined;
    expect(after?.hash).not.toBeNull();
    expect(after?.favorite).toBe(1);
  });

  it("keeps the metadata of an unchanged row without a hash when its path is written anew", async () => {
    const file = path.join(root, "same.mp4");
    await fsp.writeFile(file, "BBBBBBBBBB");
    await rescan();
    db.prepare(
      "UPDATE files SET content_hash = NULL, abs_path = '/elsewhere/same.mp4' WHERE rel_path = 'same.mp4'",
    ).run();
    db.prepare(
      "INSERT INTO file_meta (meta_key, favorite, rating, updated_at) VALUES ('p:/elsewhere/same.mp4', 1, 4, 0)",
    ).run();

    // Size and mtime unchanged: the row is touched, its abs_path rewritten.
    await rescan();

    const after = db
      .prepare(
        "SELECT f.meta_key AS key, m.favorite FROM files f JOIN file_meta m ON m.meta_key = f.meta_key WHERE f.rel_path = 'same.mp4'",
      )
      .get() as { key: string; favorite: number } | undefined;
    expect(after?.key).toBe(`p:${file}`);
    expect(after?.favorite).toBe(1);
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

  it("does not treat a new path as a move when identical copies disappeared together", async () => {
    await fsp.mkdir(path.join(root, "a"));
    await fsp.mkdir(path.join(root, "b"));
    await fsp.writeFile(path.join(root, "a", "x.mp4"), "SAMESAMESA");
    await fsp.writeFile(path.join(root, "b", "x.mp4"), "SAMESAMESA");
    await rescan();
    const ids = (
      db.prepare("SELECT id FROM files ORDER BY id").all() as { id: number }[]
    ).map((r) => r.id);

    // Both copies moved at once: which new path is which old row is unknown.
    await fsp.mkdir(path.join(root, "c"));
    await fsp.mkdir(path.join(root, "d"));
    await fsp.rename(
      path.join(root, "a", "x.mp4"),
      path.join(root, "c", "x.mp4"),
    );
    await fsp.rename(
      path.join(root, "b", "x.mp4"),
      path.join(root, "d", "x.mp4"),
    );
    const res = await rescan();

    expect(res.stats).toMatchObject({ moved: 0, inserted: 2, deleted: 2 });
    const alive = db
      .prepare("SELECT id FROM files WHERE deleted_at IS NULL")
      .all() as { id: number }[];
    for (const { id } of alive) expect(ids).not.toContain(id);
  });

  it("still detects a move while an identical copy stays where it was", async () => {
    await fsp.writeFile(path.join(root, "keep.mp4"), "SAMESAMESA");
    await fsp.writeFile(path.join(root, "a.mp4"), "SAMESAMESA");
    await rescan();
    const a = (
      db.prepare("SELECT id FROM files WHERE rel_path = 'a.mp4'").get() as {
        id: number;
      }
    ).id;

    await fsp.rename(path.join(root, "a.mp4"), path.join(root, "b.mp4"));
    const res = await rescan();

    expect(res.stats).toMatchObject({ moved: 1, inserted: 0 });
    expect(
      db.prepare("SELECT rel_path FROM files WHERE id = ?").pluck().get(a),
    ).toBe("b.mp4");
  });

  it("prefers the copy that was there before over one gone long ago", async () => {
    await fsp.writeFile(path.join(root, "aa-old.mp4"), "SAMESAMESA");
    await fsp.writeFile(path.join(root, "zz.mp4"), "SAMESAMESA");
    await rescan();
    const idOf = (rel: string) =>
      (
        db.prepare("SELECT id FROM files WHERE rel_path = ?").get(rel) as {
          id: number;
        }
      ).id;
    const old = idOf("aa-old.mp4");
    const a = idOf("zz.mp4");
    await fsp.rm(path.join(root, "aa-old.mp4"));
    await rescan(); // aa-old.mp4 soft-deleted; it sorts (and was inserted) first

    await fsp.rename(path.join(root, "zz.mp4"), path.join(root, "b.mp4"));
    const res = await rescan();

    // Both rows are unseen candidates; the live one is the file that moved.
    expect(res.stats).toMatchObject({ moved: 1, inserted: 0 });
    expect(
      db.prepare("SELECT rel_path FROM files WHERE id = ?").pluck().get(a),
    ).toBe("b.mp4");
    expect(
      db.prepare("SELECT deleted_at FROM files WHERE id = ?").pluck().get(old),
    ).not.toBeNull();
  });

  it("reports an unchanged file restored from the index as missing its FTS row", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    await fsp.writeFile(path.join(root, "b.mp4"), "BBBBBBBBBB");
    const first = await rescan();
    for (const id of first.ftsTargets) syncFts(db, id);
    const { id } = db
      .prepare("SELECT id FROM files WHERE rel_path = 'a.mp4'")
      .get() as { id: number };
    const ftsRow = () =>
      db.prepare("SELECT rowid FROM files_fts WHERE rowid = ?").get(id);

    deleteFromIndex(db, id); // also drops its FTS row
    expect(ftsRow()).toBeUndefined();
    clearExcludedFiles(db, rootId); // "rescan including excluded"
    const res = await rescan();

    // Unchanged on disk, so not in ftsTargets (and not auto-tagged again).
    expect(res.ftsTargets).toEqual([]);
    expect(res.ftsMissing).toEqual([id]);
    for (const r of res.ftsMissing) syncFts(db, r);
    expect(ftsRow()).toEqual({ rowid: id });
  });

  it("does not rebuild the FTS row of a file that comes back with its row intact", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    const first = await rescan();
    for (const id of first.ftsTargets) syncFts(db, id);

    // Gone for a scan (soft-deleted, FTS row kept), then back unchanged.
    await fsp.rename(path.join(root, "a.mp4"), path.join(root, "a.tmp"));
    await rescan();
    await fsp.rename(path.join(root, "a.tmp"), path.join(root, "a.mp4"));
    const res = await rescan();

    expect(res.stats.unchanged).toBe(1);
    expect(res.ftsMissing).toEqual([]);
  });

  it("reports a file whose FTS row a rebuild dropped while it was gone", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    const first = await rescan();
    for (const id of first.ftsTargets) syncFts(db, id);

    await fsp.rename(path.join(root, "a.mp4"), path.join(root, "a.tmp"));
    await rescan(); // soft-deleted
    rebuildFtsAll(db); // skips deleted rows, so its FTS row is gone
    await fsp.rename(path.join(root, "a.tmp"), path.join(root, "a.mp4"));
    const res = await rescan();

    expect(res.ftsMissing).toEqual(first.ftsTargets);
  });

  it("reports rows a scan aborted before its index phase left without an FTS row", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    const first = await rescan(); // FTS never synced, as if aborted
    const res = await rescan();

    expect(res.stats.unchanged).toBe(1);
    expect(res.ftsMissing).toEqual(first.ftsTargets);
  });

  it("keeps the rows under a directory that could not be read", async () => {
    await fsp.mkdir(path.join(root, "sub"));
    await fsp.writeFile(path.join(root, "sub", "a.mp4"), "AAAAAAAAAA");
    await fsp.mkdir(path.join(root, "sub2"));
    await fsp.writeFile(path.join(root, "sub2", "b.mp4"), "BBBBBBBBBB");
    await rescan();

    // "sub" could not be read this time; "sub2" (same prefix) is really gone.
    await fsp.rm(path.join(root, "sub2"), { recursive: true });
    const discovered = (await walk(root)).filter(
      (d) => !d.relPath.startsWith("sub" + path.sep),
    );
    const res = await syncFiles(db, rootId, discovered, {
      unreadablePaths: ["sub"],
    });

    expect(res.stats.deleted).toBe(1);
    const alive = db
      .prepare("SELECT rel_path FROM files WHERE deleted_at IS NULL")
      .all() as { rel_path: string }[];
    expect(alive.map((r) => r.rel_path)).toEqual([path.join("sub", "a.mp4")]);
  });

  it("keeps the row of a file that could not be stat'ed", async () => {
    await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
    await rescan();

    const res = await syncFiles(db, rootId, [], {
      unreadablePaths: ["a.mp4"],
    });

    expect(res.stats.deleted).toBe(0);
    expect(aliveCount()).toBe(1);
  });

  it("does not take a row under an unreadable directory over as a move", async () => {
    await fsp.mkdir(path.join(root, "sub"));
    await fsp.writeFile(path.join(root, "sub", "a.mp4"), "AAAAAAAAAA");
    await rescan();
    const { id } = db.prepare("SELECT id FROM files").get() as { id: number };

    // A copy appears elsewhere while "sub" can't be read.
    await fsp.copyFile(
      path.join(root, "sub", "a.mp4"),
      path.join(root, "copy.mp4"),
    );
    const discovered = (await walk(root)).filter(
      (d) => !d.relPath.startsWith("sub" + path.sep),
    );
    const res = await syncFiles(db, rootId, discovered, {
      unreadablePaths: ["sub"],
    });

    expect(res.stats).toMatchObject({ moved: 0, inserted: 1, deleted: 0 });
    expect(
      db
        .prepare(
          "SELECT rel_path FROM files WHERE id = ? AND deleted_at IS NULL",
        )
        .get(id),
    ).toEqual({ rel_path: path.join("sub", "a.mp4") });
  });

  it("skips a new file that cannot be read instead of failing the scan", async () => {
    await fsp.writeFile(path.join(root, "ok.mp4"), "OKOKOKOKOK");
    await fsp.writeFile(path.join(root, "gone.mp4"), "GONEGONEGO");
    const discovered = await walk(root);
    // Removed between the walk and the hash, like a download moved away.
    await fsp.rm(path.join(root, "gone.mp4"));

    const res = await syncFiles(db, rootId, discovered);

    expect(res.stats.inserted).toBe(1);
    expect(res.unreadable).toEqual([{ relPath: "gone.mp4", code: "ENOENT" }]);
    const rows = db.prepare("SELECT rel_path FROM files").all() as {
      rel_path: string;
    }[];
    expect(rows.map((r) => r.rel_path)).toEqual(["ok.mp4"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps the row of a changed file that cannot be read, and updates it once readable",
    async () => {
      const f = path.join(root, "locked.mp4");
      await fsp.writeFile(f, "AAAAAAAAAA");
      await rescan();
      const before = db
        .prepare("SELECT id, size, content_hash FROM files")
        .get() as { id: number; size: number; content_hash: string };

      await fsp.writeFile(f, "BBBBBBBBBBBBBBBBBBBB");
      await fsp.chmod(f, 0o000);
      try {
        const locked = await rescan();
        expect(locked.unreadable.map((u) => u.relPath)).toEqual(["locked.mp4"]);
        expect(locked.stats).toMatchObject({ updated: 0, deleted: 0 });
        // Untouched: same size and hash, still alive.
        expect(
          db
            .prepare(
              "SELECT id, size, content_hash FROM files WHERE deleted_at IS NULL",
            )
            .get(),
        ).toEqual(before);
      } finally {
        await fsp.chmod(f, 0o644);
      }

      const readable = await rescan();
      expect(readable.unreadable).toEqual([]);
      expect(readable.stats.updated).toBe(1);
      const after = db
        .prepare("SELECT id, size FROM files WHERE deleted_at IS NULL")
        .get() as { id: number; size: number };
      expect(after).toEqual({ id: before.id, size: 20 });
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "soft-deletes a file moved to an unreadable path, then revives the same row once readable",
    async () => {
      await fsp.writeFile(path.join(root, "a.mp4"), "AAAAAAAAAA");
      await rescan();
      const { id } = db.prepare("SELECT id FROM files").get() as {
        id: number;
      };

      const moved = path.join(root, "b.mp4");
      await fsp.rename(path.join(root, "a.mp4"), moved);
      await fsp.chmod(moved, 0o000);
      try {
        // The move can't be detected without the new path's hash.
        const locked = await rescan();
        expect(locked.unreadable.map((u) => u.relPath)).toEqual(["b.mp4"]);
        expect(locked.stats).toMatchObject({ moved: 0, deleted: 1 });
        expect(aliveCount()).toBe(0);
      } finally {
        await fsp.chmod(moved, 0o644);
      }

      const readable = await rescan();
      expect(readable.stats).toMatchObject({ moved: 1, inserted: 0 });
      expect(
        db
          .prepare("SELECT id, rel_path FROM files WHERE deleted_at IS NULL")
          .all(),
      ).toEqual([{ id, rel_path: "b.mp4" }]);
    },
  );

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

describe("unreadableMatcher", () => {
  it("matches a reported file and everything under a reported directory", () => {
    const isUnreadable = unreadableMatcher([
      "sub",
      path.join("other", "a.mp4"),
    ]);
    expect(isUnreadable(path.join("sub", "a.mp4"))).toBe(true);
    expect(isUnreadable(path.join("sub", "deep", "b.mp4"))).toBe(true);
    expect(isUnreadable(path.join("other", "a.mp4"))).toBe(true);
    // Same prefix, different entry.
    expect(isUnreadable(path.join("sub2", "a.mp4"))).toBe(false);
    expect(isUnreadable(path.join("other", "a.mp40"))).toBe(false);
    expect(isUnreadable("top.mp4")).toBe(false);
  });

  it("matches nothing when nothing was reported", () => {
    expect(unreadableMatcher([])("a.mp4")).toBe(false);
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

  it("does not descend into the folders a file system keeps at a drive's root", async () => {
    for (const dir of [
      "lost+found",
      "System Volume Information",
      "$RECYCLE.BIN",
    ]) {
      await fsp.mkdir(path.join(root, dir));
      await fsp.writeFile(path.join(root, dir, "a.mp4"), "x");
    }
    await fsp.writeFile(path.join(root, "keep.mp4"), "x");
    const unreadable: string[] = [];

    const found = (
      await walk(root, undefined, undefined, (p) => unreadable.push(p))
    ).map((d) => d.relPath);

    expect(found).toEqual(["keep.mp4"]);
    expect(unreadable).toEqual([]);
  });

  it("tells a mountpoint by its device, unlike its parent's", async () => {
    // A plain folder shares its parent's device; a file system's root has no
    // parent to differ from; a root that is gone is not known.
    expect(await isMountpoint(root)).toBe(false);
    expect(await isMountpoint(path.parse(root).root)).toBe(false);
    expect(await isMountpoint(path.join(root, "gone"))).toBeNull();
  });

  it("throws when the root goes away during the walk", async () => {
    await fsp.mkdir(path.join(root, "sub"));
    await fsp.writeFile(path.join(root, "sub", "a.mp4"), "x");
    let removed = false;
    // Called after the root level is listed: unmount it before "sub" is read.
    const onProgress = () => {
      if (removed) return;
      removed = true;
      fs.rmSync(root, { recursive: true, force: true });
    };
    await expect(walk(root, onProgress)).rejects.toThrow(
      "the scan root cannot be read (ENOENT)",
    );
  });

  it("throws when the root goes away and comes back during the walk", async () => {
    await fsp.mkdir(path.join(root, "sub"));
    await fsp.writeFile(path.join(root, "sub", "a.mp4"), "x");
    let calls = 0;
    const onProgress = () => {
      calls++;
      // After the root level: unmount. After the next level: mount again,
      // so the root is back by the end of the walk.
      if (calls === 1) fs.rmSync(root, { recursive: true, force: true });
      if (calls === 2) fs.mkdirSync(root);
    };
    await expect(walk(root, onProgress)).rejects.toThrow(
      "the scan root cannot be read (ENOENT)",
    );
  });

  it("throws when the root cannot be read instead of returning nothing", async () => {
    const unplugged = walk(path.join(root, "unplugged"));
    await expect(unplugged).rejects.toThrow(
      "the scan root cannot be read (ENOENT)",
    );
    await expect(unplugged).rejects.toBeInstanceOf(ScanRootUnreadableError);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a subdirectory that cannot be read and keeps walking the rest",
    async () => {
      await fsp.writeFile(path.join(root, "keep.mp4"), "x");
      const locked = path.join(root, "locked");
      await fsp.mkdir(locked);
      await fsp.writeFile(path.join(locked, "a.mp4"), "x");
      await fsp.chmod(locked, 0o000);
      try {
        const dirs: string[] = [];
        const found = await walk(root, undefined, undefined, (d) =>
          dirs.push(d),
        );
        expect(found.map((d) => d.relPath)).toEqual(["keep.mp4"]);
        expect(dirs).toEqual(["locked"]);
      } finally {
        await fsp.chmod(locked, 0o755);
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a file that is listed but cannot be stat'ed",
    async () => {
      // Readable but not searchable: readdir works, stat of its entries fails.
      const dir = path.join(root, "noexec");
      await fsp.mkdir(dir);
      await fsp.writeFile(path.join(dir, "a.mp4"), "x");
      await fsp.chmod(dir, 0o444);
      try {
        const paths: string[] = [];
        const found = await walk(root, undefined, undefined, (p) =>
          paths.push(p),
        );
        expect(found).toEqual([]);
        expect(paths).toEqual([path.join("noexec", "a.mp4")]);
      } finally {
        await fsp.chmod(dir, 0o755);
      }
    },
  );
});
