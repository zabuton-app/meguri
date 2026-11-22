// Regression tests for search/filter/sort and durable-metadata operations in queries.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import type { SearchQuery } from "../types.js";
import { addFileTag, addManualTag, syncFts, upsertTag } from "../tags.js";
import {
  addBookmark,
  deleteFromIndex,
  fileDetail,
  filesByIds,
  listBookmarks,
  migrateMetaKey,
  pruneUnusedTags,
  RARE_TAG_ROWS,
  randomFiles,
  removeBookmark,
  searchFiles,
  setFavorite,
  setRating,
  setThumb,
  setThumbOffset,
  thumbOffsetOf,
} from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("searchFiles", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("excludes soft-deleted files and paginates with a nextCursor", () => {
    for (let i = 0; i < 3; i++)
      insertFile(db, rootId, { relPath: `v${i}.mp4` });
    const page = searchFiles(db, { limit: 2 });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBe(2);

    const id = insertFile(db, rootId, { relPath: "gone.mp4" });
    deleteFromIndex(db, id);
    const all = searchFiles(db, { limit: 100 });
    expect(all.items.some((f) => f.relPath === "gone.mp4")).toBe(false);
    expect(all.nextCursor).toBeNull();
  });

  it("filters by kind, favorite, and minimum rating", () => {
    const vid = insertFile(db, rootId, { relPath: "a.mp4", kind: "video" });
    const img = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    setFavorite(db, vid, true);
    setRating(db, img, 4);

    expect(
      searchFiles(db, { kinds: ["image"] }).items.map((f) => f.id),
    ).toEqual([img]);
    expect(searchFiles(db, { favorite: true }).items.map((f) => f.id)).toEqual([
      vid,
    ]);
    expect(searchFiles(db, { ratingMin: 3 }).items.map((f) => f.id)).toEqual([
      img,
    ]);
  });

  it("filters by any of several kinds, and by every kind when none is given", () => {
    const vid = insertFile(db, rootId, { relPath: "a.mp4", kind: "video" });
    const img = insertFile(db, rootId, { relPath: "b.jpg", kind: "image" });
    const aud = insertFile(db, rootId, { relPath: "c.mp3", kind: "audio" });
    const ids = (kinds?: string[]) =>
      searchFiles(db, { kinds, limit: 100 })
        .items.map((f) => f.id)
        .sort((a, b) => a - b);

    expect(ids(["video"])).toEqual([vid]);
    expect(ids(["video", "audio"])).toEqual([vid, aud]);
    expect(ids([])).toEqual([vid, img, aud]);
    expect(ids(undefined)).toEqual([vid, img, aud]);
  });

  it("reports hasThumb from thumb_path, not from thumb_status", () => {
    // Audio lands on 'done' whether or not it embeds cover art, so the renderer
    // needs the path's presence to tell a real thumbnail from a deliberate absence.
    const withCover = insertFile(db, rootId, {
      relPath: "a.mp3",
      kind: "audio",
    });
    const noCover = insertFile(db, rootId, {
      relPath: "b.mp3",
      kind: "audio",
    });
    setThumb(db, withCover, "/thumbs/1.webp", "done");
    setThumb(db, noCover, null, "done");

    const byId = new Map(
      searchFiles(db, { limit: 100 }).items.map((f) => [f.id, f]),
    );
    expect(byId.get(withCover)?.thumbStatus).toBe("done");
    expect(byId.get(noCover)?.thumbStatus).toBe("done");
    expect(byId.get(withCover)?.hasThumb).toBe(1);
    expect(byId.get(noCover)?.hasThumb).toBe(0);
    // fileDetail extends the same column list.
    expect(fileDetail(db, withCover)?.hasThumb).toBe(1);
    expect(fileDetail(db, noCover)?.hasThumb).toBe(0);
  });

  it("filters by btime range; files without btime never match", () => {
    const old = insertFile(db, rootId, { relPath: "old.mp4", btime: 100 });
    const mid = insertFile(db, rootId, { relPath: "mid.mp4", btime: 200 });
    const recent = insertFile(db, rootId, { relPath: "new.mp4", btime: 300 });
    insertFile(db, rootId, { relPath: "nobtime.mp4", btime: null });

    const ids = (q: Parameters<typeof searchFiles>[1]) =>
      searchFiles(db, q)
        .items.map((f) => f.id)
        .sort();
    expect(ids({ btimeFrom: 150 })).toEqual([mid, recent].sort());
    expect(ids({ btimeTo: 250 })).toEqual([old, mid].sort());
    expect(ids({ btimeFrom: 150, btimeTo: 250 })).toEqual([mid]);
    expect(ids({ btimeFrom: 400 })).toEqual([]);
  });

  it("filters by the range a file was added to the index in", () => {
    const at = (id: number, createdAt: number) =>
      db
        .prepare("UPDATE files SET created_at = ? WHERE id = ?")
        .run(createdAt, id);
    const old = insertFile(db, rootId, { relPath: "old.mp4" });
    const mid = insertFile(db, rootId, { relPath: "mid.mp4" });
    const recent = insertFile(db, rootId, { relPath: "new.mp4" });
    at(old, 100);
    at(mid, 200);
    at(recent, 300);

    const ids = (q: Parameters<typeof searchFiles>[1]) =>
      searchFiles(db, q)
        .items.map((f) => f.id)
        .sort();
    expect(ids({ addedFrom: 150 })).toEqual([mid, recent].sort());
    expect(ids({ addedTo: 250 })).toEqual([old, mid].sort());
    expect(ids({ addedFrom: 200, addedTo: 200 })).toEqual([mid]);
    expect(ids({ addedFrom: 400 })).toEqual([]);
  });

  it("filters by played-at range; files never played never match", () => {
    const play = (id: number, at: number) =>
      db
        .prepare(
          `INSERT INTO play_history (meta_key, played_at, position, via)
           SELECT meta_key, ?, NULL, 'browser' FROM files WHERE id = ?`,
        )
        .run(at, id);
    const old = insertFile(db, rootId, { relPath: "old.mp4" });
    const mid = insertFile(db, rootId, { relPath: "mid.mp4" });
    const both = insertFile(db, rootId, { relPath: "both.mp4" });
    insertFile(db, rootId, { relPath: "never.mp4" });
    play(old, 100);
    play(mid, 200);
    // One play inside a range is enough, whatever the others.
    play(both, 100);
    play(both, 300);

    const ids = (q: Parameters<typeof searchFiles>[1]) =>
      searchFiles(db, q)
        .items.map((f) => f.id)
        .sort();
    expect(ids({ playedFrom: 150 })).toEqual([mid, both].sort());
    expect(ids({ playedTo: 150 })).toEqual([old, both].sort());
    expect(ids({ playedFrom: 150, playedTo: 250 })).toEqual([mid]);
    // Both ends are included, as for the other date ranges.
    expect(ids({ playedFrom: 200, playedTo: 200 })).toEqual([mid]);
    expect(ids({ playedFrom: 400 })).toEqual([]);
  });

  it("filters by fileIds (collection membership)", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    insertFile(db, rootId, { relPath: "b.mp4" });
    const c = insertFile(db, rootId, { relPath: "c.mp4" });
    const ids = searchFiles(db, { fileIds: [a, c], sort: "name" }).items.map(
      (f) => f.id,
    );
    expect(ids.sort((x, y) => x - y)).toEqual([a, c].sort((x, y) => x - y));
    // Empty IN set must match nothing rather than everything.
    expect(searchFiles(db, { fileIds: [-1] }).items).toEqual([]);
  });

  it("handles a fileIds set larger than SQLite's bound-variable limit", () => {
    const id = insertFile(db, rootId, { relPath: "needle.mp4" });
    // 40k synthetic IDs would exceed SQLITE_MAX_VARIABLE_NUMBER if expanded to one
    // placeholder each; json_each binds them as a single parameter instead.
    const haystack = Array.from({ length: 40000 }, (_, i) => i + 1000);
    const res = searchFiles(db, { fileIds: [id, ...haystack] });
    expect(res.items.map((f) => f.id)).toEqual([id]);
  });

  it("orders by name and by rating", () => {
    const c = insertFile(db, rootId, { relPath: "c.mp4" });
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    expect(
      searchFiles(db, { sort: "name" }).items.map((f) => f.relPath),
    ).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
    setRating(db, c, 5);
    setRating(db, a, 1);
    expect(searchFiles(db, { sort: "rating" }).items[0].id).toBe(c);
    void [a, b];
  });

  it("supports explicit ascending and descending sort directions", () => {
    const c = insertFile(db, rootId, { relPath: "c.mp4", capturedAt: 30 });
    const a = insertFile(db, rootId, { relPath: "a.mp4", capturedAt: 10 });
    const b = insertFile(db, rootId, { relPath: "b.mp4", capturedAt: null });
    setRating(db, c, 5);
    setRating(db, a, 1);
    setRating(db, b, 3);

    expect(
      searchFiles(db, { sort: "name", sortDir: "desc" }).items.map(
        (f) => f.relPath,
      ),
    ).toEqual(["c.mp4", "b.mp4", "a.mp4"]);
    expect(
      searchFiles(db, { sort: "rating", sortDir: "asc" }).items.map(
        (f) => f.id,
      ),
    ).toEqual([a, b, c]);
    expect(
      searchFiles(db, { sort: "captured", sortDir: "asc" }).items.map(
        (f) => f.id,
      ),
    ).toEqual([a, c, b]);
  });

  it("sorts by btime in both directions with NULLs last", () => {
    const mid = insertFile(db, rootId, { relPath: "mid.mp4", btime: 200 });
    const old = insertFile(db, rootId, { relPath: "old.mp4", btime: 100 });
    const none = insertFile(db, rootId, { relPath: "none.mp4", btime: null });

    // Default direction is desc (newest first); NULLs sort last either way.
    expect(searchFiles(db, { sort: "btime" }).items.map((f) => f.id)).toEqual([
      mid,
      old,
      none,
    ]);
    expect(
      searchFiles(db, { sort: "btime", sortDir: "asc" }).items.map((f) => f.id),
    ).toEqual([old, mid, none]);
  });

  it("sorts names in natural order, through every page (#292)", () => {
    for (const name of [
      "Ep10.mp4",
      "ep2.mp4",
      "Ep1.mp4",
      "ep11.mp4",
      "Ep3.mp4",
    ])
      insertFile(db, rootId, { relPath: name });
    const names = (sortDir: "asc" | "desc") => {
      const out: string[] = [];
      let cursor: SearchQuery["cursor"];
      do {
        const page = searchFiles(db, {
          sort: "name",
          sortDir,
          limit: 2,
          cursor,
        });
        out.push(...page.items.map((f) => f.relPath));
        cursor = page.nextCursor ?? undefined;
      } while (cursor != null);
      return out;
    };
    expect(names("asc")).toEqual([
      "Ep1.mp4",
      "ep2.mp4",
      "Ep3.mp4",
      "Ep10.mp4",
      "ep11.mp4",
    ]);
    expect(names("desc")).toEqual([
      "ep11.mp4",
      "Ep10.mp4",
      "Ep3.mp4",
      "ep2.mp4",
      "Ep1.mp4",
    ]);
  });

  it("matches the full-text query against rel_path after FTS sync", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    const res = searchFiles(db, { q: "beach" });
    expect(res.items.map((f) => f.id)).toEqual([hit]);
  });

  it("finds files by a content hash prefix with hash: (#302)", () => {
    const a = insertFile(db, rootId, {
      relPath: "a.mp4",
      contentHash: "3fa9c1d2" + "0".repeat(56),
    });
    const b = insertFile(db, rootId, {
      relPath: "b.mp4",
      contentHash: "3fa9c1d2" + "1".repeat(56),
    });
    insertFile(db, rootId, {
      relPath: "c.mp4",
      contentHash: "3fa9ffff" + "0".repeat(56),
    });
    // No hash yet: never matches.
    insertFile(db, rootId, { relPath: "d.mp4", contentHash: null });
    const ids = (q: string) =>
      searchFiles(db, { q, sort: "name", sortDir: "asc" }).items.map(
        (f) => f.id,
      );
    expect(ids("hash:3FA9C1D2")).toEqual([a, b]);
    expect(ids(`hash:3fa9c1d2${"0".repeat(56)}`)).toEqual([a]);
    expect(ids("hash:ffff")).toEqual([]);
  });

  it("finds files by extension with ext: (#522)", () => {
    const mp4 = insertFile(db, rootId, { relPath: "clip.mp4" });
    insertFile(db, rootId, { relPath: "clip.m4v" });
    // A folder name containing the text is not an extension match.
    insertFile(db, rootId, { relPath: "mp4_backup/clip.mov" });
    const ids = (q: string) =>
      searchFiles(db, { q, sort: "name", sortDir: "asc" }).items.map(
        (f) => f.id,
      );
    expect(ids("ext:mp4")).toEqual([mp4]);
    expect(ids("ext:MP4")).toEqual([mp4]);
    expect(ids("ext:.mp4")).toEqual([mp4]);
    expect(ids("ext: mp4")).toEqual([mp4]);
    expect(ids("ext:mkv")).toEqual([]);
  });

  it("finds files by rating with rating:, an unrated file counting as 0 (#525)", () => {
    const none = insertFile(db, rootId, { relPath: "a.mp4" });
    const two = insertFile(db, rootId, { relPath: "b.mp4" });
    const four = insertFile(db, rootId, { relPath: "c.mp4" });
    const five = insertFile(db, rootId, { relPath: "d.mp4" });
    setRating(db, two, 2);
    setRating(db, four, 4);
    setRating(db, five, 5);
    const ids = (q: string) =>
      searchFiles(db, { q, sort: "name", sortDir: "asc" }).items.map(
        (f) => f.id,
      );
    expect(ids("rating:4")).toEqual([four]);
    expect(ids("rating:0")).toEqual([none]);
    expect(ids("rating:>4")).toEqual([five]);
    expect(ids("rating:>=4")).toEqual([four, five]);
    expect(ids("rating:<2")).toEqual([none]);
    expect(ids("rating:<=2")).toEqual([none, two]);
    expect(ids("RATING: >=4")).toEqual([four, five]);
    // Ranges combine: each directive is one more condition.
    expect(ids("rating:>=2 rating:<5")).toEqual([two, four]);
  });

  it("leaves a rating: outside 0 to 5 as ordinary text (#525)", () => {
    const hit = insertFile(db, rootId, { relPath: "rating:6.mp4" });
    syncFts(db, hit);
    const rated = insertFile(db, rootId, { relPath: "b.mp4" });
    setRating(db, rated, 5);
    const ids = (q: string) => searchFiles(db, { q }).items.map((f) => f.id);
    expect(ids("rating:6")).toEqual([hit]);
    expect(ids("rating:>=-1")).toEqual([]);
    expect(ids("rating:=>3")).toEqual([]);
    expect(ids("rating:3.5")).toEqual([]);
  });

  it("finds favorites with is:fav (#525)", () => {
    const fav = insertFile(db, rootId, { relPath: "a.mp4" });
    insertFile(db, rootId, { relPath: "b.mp4" });
    const other = insertFile(db, rootId, { relPath: "is:favorite.mp4" });
    syncFts(db, other);
    setFavorite(db, fav, true);
    const ids = (q: string) => searchFiles(db, { q }).items.map((f) => f.id);
    expect(ids("is:fav")).toEqual([fav]);
    expect(ids("IS: Fav")).toEqual([fav]);
    // Any other value is ordinary text.
    expect(ids("is:favorite")).toEqual([other]);
  });

  it("ANDs rating: and is:fav with the rating and favorite controls (#525)", () => {
    const favFour = insertFile(db, rootId, { relPath: "a.mp4" });
    const favTwo = insertFile(db, rootId, { relPath: "b.mp4" });
    const four = insertFile(db, rootId, { relPath: "c.mp4" });
    setFavorite(db, favFour, true);
    setFavorite(db, favTwo, true);
    setRating(db, favFour, 4);
    setRating(db, favTwo, 2);
    setRating(db, four, 4);
    const ids = (query: SearchQuery) =>
      searchFiles(db, { ...query, sort: "name", sortDir: "asc" }).items.map(
        (f) => f.id,
      );
    expect(ids({ q: "is:fav", ratingMin: 3 })).toEqual([favFour]);
    expect(ids({ q: "rating:>=4", favorite: true })).toEqual([favFour]);
    // Both apply: the box asks for at most 2, the control for at least 3.
    expect(ids({ q: "rating:<=2", ratingMin: 3 })).toEqual([]);
    expect(ids({ q: "rating:>=2", ratingMin: 4 })).toEqual([favFour, four]);
  });

  it("matches a substring in the middle of a word (trigram)", () => {
    const hit = insertFile(db, rootId, { relPath: "summer_beachvideo.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    expect(searchFiles(db, { q: "chvid" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("matches CJK substrings via MATCH (3+ chars) and LIKE (short tokens)", () => {
    const hit = insertFile(db, rootId, { relPath: "夏の海岸ビデオ.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    // 3 codepoints -> trigram MATCH path.
    expect(searchFiles(db, { q: "海岸ビ" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // 2 codepoints -> LIKE fallback path (a trigram MATCH would return zero rows).
    expect(searchFiles(db, { q: "海岸" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // Single codepoint.
    expect(searchFiles(db, { q: "夏" }).items.map((f) => f.id)).toEqual([hit]);
  });

  it("ANDs long and short tokens together", () => {
    const both = insertFile(db, rootId, { relPath: "海岸_beach.mp4" });
    const beachOnly = insertFile(db, rootId, { relPath: "city_beach.mp4" });
    syncFts(db, both);
    syncFts(db, beachOnly);
    // "beach" (MATCH) AND "海岸" (LIKE) must both hold.
    expect(searchFiles(db, { q: "beach 海岸" }).items.map((f) => f.id)).toEqual(
      [both],
    );
  });

  it("matches any alternative of a token, long or short", () => {
    const en = insertFile(db, rootId, { relPath: "morning yoga.mp4" });
    const ja = insertFile(db, rootId, { relPath: "ヨガ 練習.mp4" });
    const other = insertFile(db, rootId, { relPath: "harbor walk.mp4" });
    for (const id of [en, ja, other]) syncFts(db, id);
    const ids = (q: string) =>
      searchFiles(db, { q })
        .items.map((f) => f.id)
        .sort();
    // A short alternative ("ヨガ" has no trigram) takes the LIKE path.
    expect(ids("yoga|ヨガ")).toEqual([en, ja].sort());
    // All long: one MATCH with OR.
    expect(ids("yoga|harbor")).toEqual([en, other].sort());
    // Still ANDed with the other tokens.
    expect(ids("yoga|ヨガ 練習")).toEqual([ja]);
    expect(ids('"morning yoga|harbor walk"')).toEqual([en, other].sort());
    // A separator with nothing beside it is searched as typed.
    expect(ids("yoga|")).toEqual([]);
  });

  it("matches a long alternative as it would alone, whatever sits beside it", () => {
    const ecole = insertFile(db, rootId, { relPath: "École de danse.mp4" });
    const yoga = insertFile(db, rootId, { relPath: "ヨガ.mp4" });
    for (const id of [ecole, yoga]) syncFts(db, id);
    const ids = (q: string) =>
      searchFiles(db, { q })
        .items.map((f) => f.id)
        .sort();
    // The index folds case beyond ASCII; LIKE does not. A short alternative
    // in the group must not drag the long one off the index.
    expect(ids("école")).toEqual([ecole]);
    expect(ids("école|ヨガ")).toEqual([ecole, yoga].sort());
  });

  it("still finds a file whose name contains the separator itself", () => {
    const piped = insertFile(db, rootId, { relPath: "live|encore.mp4" });
    const live = insertFile(db, rootId, { relPath: "live show.mp4" });
    const encore = insertFile(db, rootId, { relPath: "encore.mp4" });
    for (const id of [piped, live, encore]) syncFts(db, id);
    const ids = (q: string) =>
      searchFiles(db, { q })
        .items.map((f) => f.id)
        .sort();
    // Unescaped, it is "live" or "encore".
    expect(ids("live|encore")).toEqual([piped, live, encore].sort());
    // Escaped, it is the text itself — long or short.
    expect(ids("live\\|encore")).toEqual([piped]);
    expect(ids("e\\|e")).toEqual([piped]);
    // And an escaped one can sit inside an alternative.
    expect(ids("e\\|e|show")).toEqual([piped, live].sort());
  });

  it("treats LIKE metacharacters in short tokens literally", () => {
    const percent = insertFile(db, rootId, { relPath: "sale_5%.mp4" });
    const plain = insertFile(db, rootId, { relPath: "sale_55.mp4" });
    syncFts(db, percent);
    syncFts(db, plain);
    // "5%" is 2 codepoints -> LIKE path; unescaped it would also match "55".
    expect(searchFiles(db, { q: "5%" }).items.map((f) => f.id)).toEqual([
      percent,
    ]);
  });

  it("matches case-insensitively through the trigram tokenizer", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    syncFts(db, hit);
    expect(searchFiles(db, { q: "BEACH" }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("strips double quotes from query tokens instead of matching them literally", () => {
    const hit = insertFile(db, rootId, { relPath: "holiday/beach.mp4" });
    insertFile(db, rootId, { relPath: "work/report.mp4" });
    syncFts(db, hit);
    // A pasted quoted word must behave like the bare word, not a zero-row
    // search for literal quote characters.
    expect(searchFiles(db, { q: '"beach"' }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
    // A token that is only quotes vanishes; the remaining token still applies.
    expect(searchFiles(db, { q: '" beach' }).items.map((f) => f.id)).toEqual([
      hit,
    ]);
  });

  it("clamps an out-of-range rating into 0..5", () => {
    const id = insertFile(db, rootId, { relPath: "r.mp4" });
    setRating(db, id, 99);
    expect(filesByIds(db, [id])[0].rating).toBe(5);
    setRating(db, id, -3);
    expect(filesByIds(db, [id])[0].rating).toBe(0);
  });
});

describe("randomFiles", () => {
  it("respects query filters and the limit", () => {
    const { db, rootId } = newDb();
    for (let i = 0; i < 5; i++)
      insertFile(db, rootId, { relPath: `v${i}.mp4`, kind: "video" });
    insertFile(db, rootId, { relPath: "p.jpg", kind: "image" });
    const out = randomFiles(db, { kinds: ["video"], limit: 3 });
    expect(out.length).toBe(3);
    expect(out.every((f) => f.kind === "video")).toBe(true);
    db.close();
  });

  it("includes audio alongside video and images when no kind filter is set", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "v.mp4", kind: "video" });
    insertFile(db, rootId, { relPath: "p.jpg", kind: "image" });
    insertFile(db, rootId, { relPath: "a.mp3", kind: "audio" });
    const out = randomFiles(db, { limit: 10 });
    expect(out.length).toBe(3);
    expect(out.some((f) => f.kind === "audio")).toBe(true);
    db.close();
  });

  it("returns only audio when it is requested by kind", () => {
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "v.mp4", kind: "video" });
    insertFile(db, rootId, { relPath: "a.mp3", kind: "audio" });
    const out = randomFiles(db, { kinds: ["audio"], limit: 10 });
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("audio");
    db.close();
  });
});

describe("attachTags", () => {
  it("omits pipeline sources from list rows but keeps them on the detail", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addManualTag(db, id, "beach");
    addFileTag(db, id, upsertTag(db, "res", "4k"), "auto-meta", null);

    // A list row never draws generated tags, so shipping four of them per file
    // across the process boundary would be paid for nothing.
    const row = searchFiles(db, {}).items[0];
    expect(row.tags?.map((t) => t.name)).toEqual(["beach"]);
    // The detail pane does show them.
    expect(
      fileDetail(db, id)
        ?.tags.map((t) => `${t.namespace}:${t.name}`)
        .sort(),
    ).toEqual([":beach", "res:4k"]);
    db.close();
  });
});

describe("structured tag filtering", () => {
  let db: DB;
  let rootId: number;
  let manualOnly: number;
  let autoOnly: number;
  let both: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    manualOnly = insertFile(db, rootId, { relPath: "manual.mp4" });
    autoOnly = insertFile(db, rootId, { relPath: "auto.mp4" });
    both = insertFile(db, rootId, { relPath: "both.mp4" });
    addManualTag(db, manualOnly, "beach");
    addManualTag(db, both, "beach");
    const res4k = upsertTag(db, "res", "4k");
    addFileTag(db, autoOnly, res4k, "auto-meta", null);
    addFileTag(db, both, res4k, "auto-meta", null);
  });
  afterEach(() => db.close());

  function ids(tags: string[], tagSource?: string): number[] {
    return searchFiles(db, { tags, tagSource })
      .items.map((f) => f.id)
      .sort((a, b) => a - b);
  }

  it("matches a namespaced tag by its qualified name", () => {
    expect(ids(["res:4k"])).toEqual([autoOnly, both].sort((a, b) => a - b));
  });

  it("does not confuse a manual tag with the value half of a namespaced one", () => {
    const plain4k = insertFile(db, rootId, { relPath: "plain.mp4" });
    addManualTag(db, plain4k, "4k");
    // The bare token only resolves against namespace = ''.
    expect(ids(["4k"])).toEqual([plain4k]);
  });

  it("matches a manual tag whose own name contains a colon", () => {
    const id = insertFile(db, rootId, { relPath: "todo.mp4" });
    addManualTag(db, id, "todo:later");
    expect(ids(["todo:later"])).toEqual([id]);
  });

  it("resolves a namespace it has never heard of, straight from the tags table", () => {
    const id = insertFile(db, rootId, { relPath: "studio.mp4" });
    // "studio" is not in AUTO_META_NAMESPACES — matching must not depend on that list.
    addFileTag(db, id, upsertTag(db, "studio", "a24"), "auto-name", null);
    expect(ids(["studio:a24"])).toEqual([id]);
  });

  it("returns nothing for a tag that does not exist", () => {
    expect(ids(["nope"])).toEqual([]);
    expect(ids(["res:8k"])).toEqual([]);
  });

  it("combines multiple tags with AND", () => {
    expect(ids(["beach", "res:4k"])).toEqual([both]);
  });

  it("still honours tagSource across every token", () => {
    // The same tag from another source, on a file of its own.
    const manualRes = insertFile(db, rootId, { relPath: "manual-res.mp4" });
    addFileTag(db, manualRes, upsertTag(db, "res", "4k"), "manual", null);
    expect(ids(["res:4k"], "auto-meta")).toEqual(
      [autoOnly, both].sort((a, b) => a - b),
    );
    expect(ids(["res:4k"], "manual")).toEqual([manualRes]);
  });

  describe("the tag: free-text directive", () => {
    function q(text: string): number[] {
      return searchFiles(db, { q: text })
        .items.map((f) => f.id)
        .sort((a, b) => a - b);
    }

    it("matches a manual tag exactly, unlike the bare word", () => {
      const named = insertFile(db, rootId, { relPath: "beach-holiday.mp4" });
      syncFts(db, named);
      // The whole point of the directive: putting the condition in the search
      // box must not degrade it into a substring search over file names.
      expect(q("beach")).toContain(named);
      expect(q("tag:beach")).not.toContain(named);
      expect(q("tag:beach")).toEqual([manualOnly, both].sort((a, b) => a - b));
    });

    it("reaches a generated tag by its bare value", () => {
      // One directive covers both kinds: the user does not think of "my tags"
      // and "the scanner's tags" as separate things to search.
      expect(q("tag:4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("reaches a generated tag by its qualified form", () => {
      expect(q("tag:res:4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("matches both kinds when a bare value names each", () => {
      // A manual "4k" alongside the generated res:4k. Either is what a person
      // means by tag:4k; the qualified form narrows it back down.
      const plain = insertFile(db, rootId, { relPath: "plain.mp4" });
      addManualTag(db, plain, "4k");
      syncFts(db, plain);
      expect(q("tag:4k")).toContain(plain);
      expect(q("tag:res:4k")).not.toContain(plain);
    });

    it("reaches an audio tag only by its namespace, so a manual tag of that name does not bring it (#468)", () => {
      const song = insertFile(db, rootId, { relPath: "song.mp3" });
      addFileTag(
        db,
        song,
        upsertTag(db, "audio_genre", "jazz"),
        "auto-meta",
        null,
      );
      addFileTag(
        db,
        song,
        upsertTag(db, "audio_tempo", "slow"),
        "auto-meta",
        null,
      );
      const clip = insertFile(db, rootId, { relPath: "clip.mp4" });
      addManualTag(db, clip, "jazz");
      addManualTag(db, clip, "slow");
      syncFts(db, song);
      syncFts(db, clip);

      expect(q("tag:jazz")).toEqual([clip]);
      expect(q("tag:slow")).toEqual([clip]);
      expect(q("tag:audio_genre:jazz")).toEqual([song]);
      expect(q("tag:audio_tempo:slow")).toEqual([song]);
    });

    it("is case-insensitive on both the prefix and the value", () => {
      // The FTS half of the box is case-insensitive; an arbitrary split here
      // would just look broken.
      expect(q("TAG:BEACH")).toEqual([manualOnly, both].sort((a, b) => a - b));
      const expected = [autoOnly, both].sort((a, b) => a - b);
      expect(q("tag:4K")).toEqual(expected);
      expect(q("tag:RES:4K")).toEqual(expected);
    });

    it("returns nothing for an unknown value", () => {
      expect(q("tag:8k")).toEqual([]);
    });

    it("combines two directives and free text", () => {
      expect(q("tag:beach tag:4k")).toEqual([both]);
      syncFts(db, autoOnly);
      syncFts(db, both);
      // "auto" only appears in auto.mp4's path, so the pair narrows to one file.
      expect(q("auto tag:4k")).toEqual([autoOnly]);
    });

    it("leaves a bare `tag:` as ordinary text", () => {
      expect(q("tag:")).toEqual([]);
    });

    it("tolerates a space after the colon", () => {
      // What a person types. The search box shows the same chip either way, so
      // the SQL has to agree — a mismatch would be invisible to the user.
      expect(q("tag: beach")).toEqual([manualOnly, both].sort((a, b) => a - b));
      expect(q("tag: 4k")).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("keeps a quoted multi-word tag together", () => {
      const id = insertFile(db, rootId, { relPath: "spaced.mp4" });
      addManualTag(db, id, "beach house");
      expect(q('tag:"beach house"')).toEqual([id]);
      // Unquoted, the space splits it into two ordinary conditions.
      expect(q("tag:beach house")).not.toContain(id);
    });

    it("returns nothing for an unknown tag", () => {
      expect(q("tag:nope")).toEqual([]);
    });
  });

  it("leaves out a deleted file that carries the tag", () => {
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(both);
    expect(ids(["beach"])).toEqual([manualOnly]);
    expect(searchFiles(db, { q: "tag:beach" }).items.map((f) => f.id)).toEqual([
      manualOnly,
    ]);
  });

  // Past RARE_TAG_ROWS rows, a tag is checked per file rather than
  // collected from its rows (#365). The rows added here belong to no file in
  // this workspace, as another workspace's would, so the answers stay the same.
  describe("tags common enough to check per file", () => {
    beforeEach(() => {
      const add = db.prepare(
        "INSERT INTO meta_tags (meta_key, tag_id, source) VALUES (?, ?, ?)",
      );
      const beach = db
        .prepare("SELECT id FROM tags WHERE namespace = '' AND name = 'beach'")
        .pluck()
        .get() as number;
      const res4k = upsertTag(db, "res", "4k");
      for (let i = 0; i <= RARE_TAG_ROWS; i++) {
        add.run(`elsewhere${i}`, beach, "manual");
        add.run(`elsewhere${i}`, res4k, "auto-meta");
      }
    });

    it("matches the same files as a rare tag", () => {
      expect(ids(["beach"])).toEqual([manualOnly, both].sort((a, b) => a - b));
      expect(ids(["beach", "res:4k"])).toEqual([both]);
      expect(
        searchFiles(db, { q: "tag:4k" })
          .items.map((f) => f.id)
          .sort((a, b) => a - b),
      ).toEqual([autoOnly, both].sort((a, b) => a - b));
    });

    it("still honours tagSource", () => {
      // The same tag from another source, on a file of its own.
      const manualRes = insertFile(db, rootId, { relPath: "manual-res.mp4" });
      addFileTag(db, manualRes, upsertTag(db, "res", "4k"), "manual", null);
      expect(ids(["res:4k"], "auto-meta")).toEqual(
        [autoOnly, both].sort((a, b) => a - b),
      );
      expect(ids(["res:4k"], "manual")).toEqual([manualRes]);
    });

    it("leaves out a deleted file that carries the tag", () => {
      db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(both);
      expect(ids(["beach"])).toEqual([manualOnly]);
    });
  });

  it("does not match on the file name the way free text does", () => {
    const named = insertFile(db, rootId, { relPath: "beach-holiday.mp4" });
    syncFts(db, named);
    expect(searchFiles(db, { q: "beach" }).items.map((f) => f.id)).toContain(
      named,
    );
    expect(ids(["beach"])).not.toContain(named);
  });
});

describe("deleteFromIndex", () => {
  it("soft-deletes, excludes, drops the FTS row, and rejects a second delete", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "del.mp4" });
    syncFts(db, id);
    const res = deleteFromIndex(db, id);
    expect(res).toEqual({ id, relPath: "del.mp4" });

    const row = db
      .prepare("SELECT deleted_at, excluded_at FROM files WHERE id = ?")
      .get(id) as { deleted_at: number | null; excluded_at: number | null };
    expect(row.deleted_at).not.toBeNull();
    expect(row.excluded_at).not.toBeNull();
    expect(
      db.prepare("SELECT rowid FROM files_fts WHERE rowid = ?").get(id),
    ).toBeUndefined();

    expect(() => deleteFromIndex(db, id)).toThrow();
    db.close();
  });
});

describe("durable metadata keyed by meta_key", () => {
  it("survives a content_hash appearing: migrateMetaKey carries favorite/rating over", () => {
    const { db, rootId } = newDb();
    // File with no hash yet -> meta_key falls back to "p:<absPath>".
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    setFavorite(db, id, true);
    setRating(db, id, 5);
    const fromKey = `p:/fake/root/m.mp4`;
    const toKey = "abc123hash";

    migrateMetaKey(db, fromKey, toKey);
    // Point the file row at the new hash-based key and confirm the metadata followed.
    db.prepare("UPDATE files SET content_hash = ? WHERE id = ?").run(toKey, id);
    const row = filesByIds(db, [id])[0];
    expect(row.favorite).toBe(1);
    expect(row.rating).toBe(5);
    db.close();
  });

  it("migrateMetaKey merges into metadata the target key already holds", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    setFavorite(db, id, true);
    setRating(db, id, 2);
    const fromKey = `p:/fake/root/m.mp4`;
    db.prepare("UPDATE file_meta SET updated_at = 10 WHERE meta_key = ?").run(
      fromKey,
    );
    // Another workspace's copy of the same content, already under the hash.
    db.prepare(
      "INSERT INTO file_meta (meta_key, rating, favorite, thumb_offset_sec, updated_at) VALUES ('h', 4, 0, 7.5, 5)",
    ).run();

    migrateMetaKey(db, fromKey, "h");

    expect(
      db
        .prepare(
          "SELECT meta_key, rating, favorite, thumb_offset_sec, updated_at FROM file_meta",
        )
        .all(),
    ).toEqual([
      {
        meta_key: "h",
        rating: 4,
        favorite: 1,
        thumb_offset_sec: 7.5,
        updated_at: 10,
      },
    ]);
    db.close();
  });

  it("pruneUnusedTags keeps metadata with no file row: the library is shared", () => {
    const { db, rootId } = newDb();
    const kept = insertFile(db, rootId, {
      relPath: "kept.mp4",
      contentHash: "keephash",
    });
    setFavorite(db, kept, true);
    deleteFromIndex(db, kept);
    // A key no file of this workspace maps to: another workspace's, or one
    // removed and about to be added again.
    db.prepare(
      "INSERT INTO file_meta (meta_key, favorite, updated_at) VALUES ('elsewhere', 1, 0)",
    ).run();

    pruneUnusedTags(db);

    expect(
      db.prepare("SELECT 1 FROM file_meta WHERE meta_key = 'elsewhere'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM file_meta WHERE meta_key = 'keephash'").get(),
    ).toBeDefined();
    db.close();
  });

  it("pruneUnusedTags drops tags no file carries, and keeps the rest", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "ha" });
    addManualTag(db, id, "used");
    upsertTag(db, "", "unused");
    // Carried only by a key no file of this workspace maps to: still in use.
    const elsewhere = upsertTag(db, "", "elsewhere");
    db.prepare(
      "INSERT INTO meta_tags (meta_key, tag_id, source) VALUES ('other-ws', ?, 'manual')",
    ).run(elsewhere);

    pruneUnusedTags(db);

    const names = (
      db.prepare("SELECT name FROM tags ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toEqual(["elsewhere", "used"]);
    db.close();
  });
});

describe("scene bookmarks", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("addBookmark inserts and listBookmarks returns rows ordered by sec", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    addBookmark(db, id, 30);
    addBookmark(db, id, 10);
    addBookmark(db, id, 20);
    const rows = listBookmarks(db, id);
    expect(rows.map((r) => r.sec)).toEqual([10, 20, 30]);
  });

  it("addBookmark dedupes within ±2 seconds and returns the existing row", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    const first = addBookmark(db, id, 10);
    const near = addBookmark(db, id, 11.5);
    expect(near?.id).toBe(first?.id);
    expect(listBookmarks(db, id).length).toBe(1);
  });

  it("addBookmark rejects non-finite values", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4" });
    expect(addBookmark(db, id, Number.NaN)).toBeNull();
    expect(addBookmark(db, id, Number.POSITIVE_INFINITY)).toBeNull();
    expect(listBookmarks(db, id).length).toBe(0);
  });

  it("removeBookmark only deletes bookmarks owned by the same file", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "ha" });
    const b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "hb" });
    const aBm = addBookmark(db, a, 5)!;
    const bBm = addBookmark(db, b, 5)!;
    // Try to remove file-a's bookmark via file-b's id — should be a no-op.
    removeBookmark(db, b, aBm.id);
    expect(listBookmarks(db, a).map((r) => r.id)).toEqual([aBm.id]);
    expect(listBookmarks(db, b).map((r) => r.id)).toEqual([bBm.id]);
  });

  it("migrateMetaKey drops a bookmark near one the target key holds", () => {
    const { db, rootId } = newDb();
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    addBookmark(db, id, 11);
    addBookmark(db, id, 60);
    // Another workspace's copy of the same content, bookmarked at 10s.
    db.prepare(
      "INSERT INTO scene_bookmarks (meta_key, sec, created_at) VALUES ('h', 10, 0)",
    ).run();

    migrateMetaKey(db, "p:/fake/root/m.mp4", "h");

    expect(
      db
        .prepare("SELECT meta_key, sec FROM scene_bookmarks ORDER BY sec")
        .all(),
    ).toEqual([
      { meta_key: "h", sec: 10 },
      { meta_key: "h", sec: 60 },
    ]);
    db.close();
  });

  it("migrateMetaKey carries bookmarks along when a content_hash first appears", () => {
    const id = insertFile(db, rootId, { relPath: "m.mp4", contentHash: null });
    addBookmark(db, id, 42);
    migrateMetaKey(db, `p:/fake/root/m.mp4`, "hashed");
    db.prepare("UPDATE files SET content_hash = ? WHERE id = ?").run(
      "hashed",
      id,
    );
    const rows = listBookmarks(db, id);
    expect(rows.map((r) => r.sec)).toEqual([42]);
  });
});

describe("custom thumbnail offset (file_meta.thumb_offset_sec)", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  it("round-trips a numeric offset and exposes it on fileDetail", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4", duration: 300 });
    setThumbOffset(db, id, 12.5);
    expect(thumbOffsetOf(db, id)).toBe(12.5);
    expect(fileDetail(db, id)?.thumbOffsetSec).toBe(12.5);
  });

  it("clears back to null when set with null", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4" });
    setThumbOffset(db, id, 7);
    setThumbOffset(db, id, null);
    expect(thumbOffsetOf(db, id)).toBeNull();
    expect(fileDetail(db, id)?.thumbOffsetSec).toBeNull();
  });

  it("rejects negative and non-finite values (stores null instead)", () => {
    const id = insertFile(db, rootId, { relPath: "v.mp4" });
    setThumbOffset(db, id, -1);
    expect(thumbOffsetOf(db, id)).toBeNull();
    setThumbOffset(db, id, Number.NaN);
    expect(thumbOffsetOf(db, id)).toBeNull();
  });
});
