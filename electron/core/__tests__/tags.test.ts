// Regression tests for tag operations and FTS sync in tags.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  addManualTag,
  fileTags,
  listTagNames,
  removeManualTag,
  syncFts,
  tagsText,
  upsertTag,
} from "../tags.js";
import {
  fileDetail,
  recordPlay,
  searchFiles,
  setFavorite,
  setRating,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("tags", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("upsertTag is idempotent per (namespace, name)", () => {
    const a = upsertTag(db, "", "sunset");
    const b = upsertTag(db, "", "sunset");
    expect(b).toBe(a);
    const count = (
      db.prepare("SELECT COUNT(*) c FROM tags").get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("adds and removes a manual tag for a file", () => {
    const id = insertFile(db, rootId, { relPath: "t.mp4", contentHash: "h1" });
    const tagId = addManualTag(db, id, "beach");
    expect(fileTags(db, id).map((t) => t.name)).toEqual(["beach"]);
    expect(tagsText(db, id)).toBe("beach");

    removeManualTag(db, id, tagId);
    expect(fileTags(db, id)).toEqual([]);
  });

  it("keeps tags addressable by meta_key so they survive id changes", () => {
    const id = insertFile(db, rootId, {
      relPath: "k.mp4",
      contentHash: "stable-hash",
    });
    addManualTag(db, id, "keep");
    // Tags are stored against meta_key (the content_hash), not files.id.
    const row = db
      .prepare("SELECT meta_key FROM files WHERE id = ?")
      .get(id) as {
      meta_key: string;
    };
    expect(row.meta_key).toBe("stable-hash");
    const linked = db
      .prepare("SELECT COUNT(*) c FROM meta_tags WHERE meta_key = ?")
      .get("stable-hash") as { c: number };
    expect(linked.c).toBe(1);
  });

  it("syncFts makes a tag searchable and removing it drops the match", () => {
    const id = insertFile(db, rootId, {
      relPath: "video.mp4",
      contentHash: "h2",
    });
    const tagId = addManualTag(db, id, "vacation");
    syncFts(db, id);
    expect(searchFiles(db, { q: "vacation" }).items.map((f) => f.id)).toEqual([
      id,
    ]);

    removeManualTag(db, id, tagId);
    syncFts(db, id);
    expect(searchFiles(db, { q: "vacation" }).items).toEqual([]);
  });

  it("listTagNames matches by prefix and escapes LIKE wildcards", () => {
    upsertTag(db, "", "a_b");
    upsertTag(db, "", "axb");
    upsertTag(db, "", "abc");
    // "_" is a LIKE wildcard; it must be escaped so the prefix is treated literally.
    expect(listTagNames(db, "a_", 10)).toEqual(["a_b"]);
    expect(listTagNames(db, "a", 10).sort()).toEqual(["a_b", "abc", "axb"]);
  });
});

describe("audio in the library (US3: inherited metadata behaviour)", () => {
  // Every user-data table keys on meta_key rather than files.id, so audio is
  // expected to inherit favorites, ratings, tags, and history with no
  // kind-specific code. These tests confirm that inheritance rather than
  // assuming it: a failure here points at the files-table rebuild, not at
  // missing feature work.
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => {
    db.close();
  });

  it("attaches favorite, rating, tags, and play history to an audio row", () => {
    const id = insertFile(db, rootId, {
      relPath: "music/track.mp3",
      kind: "audio",
      contentHash: "audio-hash",
      duration: 240,
    });
    setFavorite(db, id, true);
    setRating(db, id, 5);
    addManualTag(db, id, "jazz");
    recordPlay(db, id, "browser", null);

    const detail = fileDetail(db, id);
    expect(detail).toBeTruthy();
    expect(detail!.kind).toBe("audio");
    expect(detail!.favorite).toBe(1);
    expect(detail!.rating).toBe(5);
    expect(detail!.duration).toBe(240);
    expect(detail!.tags.map((t) => t.name)).toContain("jazz");
    expect(detail!.playHistory.length).toBe(1);
    expect(detail!.playHistory[0].via).toBe("browser");
  });

  it("finds an audio row by filename fragment and by tag through files_fts", () => {
    const id = insertFile(db, rootId, {
      relPath: "music/nocturne.mp3",
      kind: "audio",
      contentHash: "fts-hash",
    });
    addManualTag(db, id, "piano");
    syncFts(db, id);

    const byName = searchFiles(db, { q: "nocturne", limit: 10 });
    expect(byName.items.map((f) => f.id)).toContain(id);

    const byTag = searchFiles(db, { q: "piano", limit: 10 });
    expect(byTag.items.map((f) => f.id)).toContain(id);
  });

  it("keeps audio metadata attached when the file is renamed (content_hash move tracking)", () => {
    const id = insertFile(db, rootId, {
      relPath: "music/old-name.mp3",
      kind: "audio",
      contentHash: "stable-hash",
    });
    setFavorite(db, id, true);
    setRating(db, id, 4);
    addManualTag(db, id, "ambient");
    recordPlay(db, id, "browser", null);

    // A rename updates rel_path in place; meta_key stays the content_hash, which
    // is exactly why the user's edits survive it.
    db.prepare("UPDATE files SET rel_path = ?, abs_path = ? WHERE id = ?").run(
      "music/new-name.mp3",
      "/fake/root/music/new-name.mp3",
      id,
    );

    const detail = fileDetail(db, id);
    expect(detail!.relPath).toBe("music/new-name.mp3");
    expect(detail!.favorite).toBe(1);
    expect(detail!.rating).toBe(4);
    expect(detail!.tags.map((t) => t.name)).toContain("ambient");
    expect(detail!.playHistory.length).toBe(1);
  });
});
