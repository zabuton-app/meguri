// The classification ruleset (contracts/auto-meta-rules.md) plus the DB-level
// applier and backfill.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  AUTO_META_RULESET_VERSION,
  AUTO_META_SOURCE,
  AUTO_META_VERSION_KEY,
  applyAutoMetaTags,
  applyDerivedTagsByKey,
  autoMetaTagsFor,
  backfillAutoMetaTags,
  needsAutoMetaBackfill,
} from "../autoMetaTags.js";
import { getSetting } from "../queries.js";
import { addManualTag, fileTags } from "../tags.js";
import {
  AUTO_META_VALUES,
  namespaceOfAutoMetaValue,
} from "../../../shared/tags.js";
import { insertFile, newDb } from "./helpers.js";

/** Qualified names, sorted, so assertions read like the tags a user would see. */
function classify(input: {
  kind?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  codec?: string | null;
}): string[] {
  return autoMetaTagsFor({
    kind: input.kind ?? "video",
    width: input.width ?? null,
    height: input.height ?? null,
    duration: input.duration ?? null,
    codec: input.codec ?? null,
  })
    .map((t) => `${t.namespace}:${t.name}`)
    .sort();
}

describe("autoMetaTagsFor — resolution", () => {
  const res = (width: number, height: number) =>
    classify({ width, height }).find((t) => t.startsWith("res:"));

  it("classifies by the longer edge", () => {
    expect(res(3840, 2160)).toBe("res:4k");
    // A vertically shot 4K video is still 4K.
    expect(res(2160, 3840)).toBe("res:4k");
    expect(res(1080, 1920)).toBe("res:1080p");
  });

  it("pins the class boundaries", () => {
    expect(res(3600, 1500)).toBe("res:4k");
    expect(res(3599, 2000)).toBe("res:1080p");
    expect(res(1800, 1000)).toBe("res:1080p");
    expect(res(1799, 1000)).toBe("res:720p");
    expect(res(1200, 800)).toBe("res:720p");
    expect(res(1199, 800)).toBe("res:sd");
    expect(res(640, 480)).toBe("res:sd");
  });

  it("keeps 1440p in the 1080p bucket (four classes in v1)", () => {
    expect(res(2560, 1440)).toBe("res:1080p");
  });

  it("tolerates a cinemascope crop", () => {
    expect(res(1920, 800)).toBe("res:1080p");
  });

  it("emits nothing without usable dimensions", () => {
    expect(classify({ width: null, height: null })).toEqual([]);
    expect(classify({ width: 0, height: 0 })).toEqual([]);
    expect(classify({ width: 1920, height: null })).toEqual([]);
  });
});

describe("autoMetaTagsFor — duration", () => {
  const dur = (duration: number | null, kind = "video") =>
    classify({ width: 100, height: 100, duration, kind }).find((t) =>
      t.startsWith("dur:"),
    );

  it("pins the class boundaries", () => {
    expect(dur(59.9)).toBe("dur:short");
    expect(dur(60)).toBe("dur:medium");
    expect(dur(1800)).toBe("dur:medium");
    expect(dur(1800.1)).toBe("dur:long");
  });

  it("emits nothing for a missing or non-positive duration", () => {
    expect(dur(null)).toBeUndefined();
    expect(dur(0)).toBeUndefined();
    expect(dur(-1)).toBeUndefined();
  });

  it("never tags an image — ffprobe reports stills as ~0.04s streams", () => {
    expect(dur(0.04, "image")).toBeUndefined();
  });
});

describe("autoMetaTagsFor — codec", () => {
  const codec = (raw: string | null, kind = "video") =>
    classify({ codec: raw, kind }).find((t) => t.startsWith("codec:"));

  it("folds aliases onto one canonical name", () => {
    expect(codec("avc1")).toBe("codec:h264");
    expect(codec("H264")).toBe("codec:h264");
    expect(codec("hev1")).toBe("codec:hevc");
    expect(codec("h265")).toBe("codec:hevc");
    expect(codec("libaom-av1")).toBe("codec:av1");
    expect(codec("wmv3")).toBe("codec:vc1");
    expect(codec("mpeg2video")).toBe("codec:mpeg2");
  });

  it("keeps an unrecognized but plausible codec name", () => {
    // A fixed allowlist would silently drop codecs ffprobe learns about later.
    expect(codec("vvc")).toBe("codec:vvc");
  });

  it("drops values that do not look like a codec name", () => {
    expect(codec("")).toBeUndefined();
    expect(codec("a")).toBeUndefined();
    expect(codec("some codec with spaces")).toBeUndefined();
    expect(codec("way-too-long-codec-name")).toBeUndefined();
    expect(codec(null)).toBeUndefined();
  });

  it("never tags an image", () => {
    expect(codec("mjpeg", "image")).toBeUndefined();
  });
});

describe("autoMetaTagsFor — orientation", () => {
  const orient = (width: number, height: number, kind = "video") =>
    classify({ width, height, kind }).find((t) => t.startsWith("orient:"));

  it("classifies by aspect ratio with a 2% tolerance", () => {
    expect(orient(1920, 1080)).toBe("orient:horizontal");
    expect(orient(1080, 1920)).toBe("orient:vertical");
    expect(orient(1000, 1000)).toBe("orient:square");
    expect(orient(1998, 2000)).toBe("orient:square");
    expect(orient(2000, 1900)).toBe("orient:horizontal");
  });

  it("applies to images too", () => {
    expect(orient(1080, 1920, "image")).toBe("orient:vertical");
  });
});

describe("autoMetaTagsFor — whole rows", () => {
  it("tags a 4K HEVC feature-length video across all four categories", () => {
    expect(
      classify({ width: 3840, height: 2160, duration: 2700, codec: "hevc" }),
    ).toEqual(["codec:hevc", "dur:long", "orient:horizontal", "res:4k"]);
  });

  it("gives an image only resolution and orientation", () => {
    expect(
      classify({
        kind: "image",
        width: 4000,
        height: 3000,
        duration: 0.04,
        codec: "mjpeg",
      }),
    ).toEqual(["orient:horizontal", "res:4k"]);
  });

  it("gives nothing at all when the probe produced nothing", () => {
    expect(classify({})).toEqual([]);
  });
});

describe("the declared vocabulary", () => {
  it("has no value shared between categories", () => {
    // This is what lets the search box accept `tag:long` instead of
    // `tag:dur:long`. If a future category reuses a value, the bare form
    // becomes ambiguous and this must be reconsidered.
    const seen = new Map<string, string>();
    for (const [namespace, values] of Object.entries(AUTO_META_VALUES)) {
      for (const value of values) {
        expect(seen.get(value) ?? namespace).toBe(namespace);
        seen.set(value, namespace);
      }
    }
  });

  it("does not collide with a canonical codec name either", () => {
    // codec is the one open set, so it cannot be pinned exhaustively — but the
    // names the alias table produces must at least stay clear of the others.
    const canonical = [
      "h264",
      "hevc",
      "av1",
      "vp9",
      "vp8",
      "mpeg4",
      "mpeg2",
      "vc1",
      "prores",
    ];
    const closed = Object.values(AUTO_META_VALUES).flat();
    for (const name of canonical) expect(closed).not.toContain(name);
  });

  it("emits nothing outside the declared sets", () => {
    const inputs = [
      { kind: "video", width: 3840, height: 2160, duration: 10, codec: null },
      { kind: "video", width: 1920, height: 1080, duration: 600, codec: null },
      { kind: "video", width: 1280, height: 720, duration: 5000, codec: null },
      { kind: "video", width: 640, height: 480, duration: 1, codec: null },
      { kind: "video", width: 1080, height: 1920, duration: 1, codec: null },
      { kind: "image", width: 1000, height: 1000, duration: null, codec: null },
    ];
    for (const input of inputs) {
      for (const tag of autoMetaTagsFor(input)) {
        const declared = AUTO_META_VALUES[tag.namespace];
        if (declared) expect(declared).toContain(tag.name);
      }
    }
  });

  it("recovers the category from a bare value, and gives up on codecs", () => {
    expect(namespaceOfAutoMetaValue("long")).toBe("dur");
    expect(namespaceOfAutoMetaValue("4k")).toBe("res");
    expect(namespaceOfAutoMetaValue("VERTICAL")).toBe("orient");
    // codec values are open, so there is nothing to look them up in.
    expect(namespaceOfAutoMetaValue("hevc")).toBeNull();
    expect(namespaceOfAutoMetaValue("nope")).toBeNull();
  });
});

describe("applyDerivedTagsByKey", () => {
  let db: DB;
  let rootId: number;
  let id: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    id = insertFile(db, rootId, {
      relPath: "a.mp4",
      width: 3840,
      height: 2160,
      duration: 3000,
      codec: "hevc",
    });
  });
  afterEach(() => db.close());

  function autoNames(): string[] {
    return fileTags(db, id)
      .filter((t) => t.source === AUTO_META_SOURCE)
      .map((t) => `${t.namespace}:${t.name}`)
      .sort();
  }

  function apply(): boolean {
    const row = db
      .prepare(
        "SELECT kind, width, height, duration, codec FROM files WHERE id = ?",
      )
      .get(id) as {
      kind: string;
      width: number | null;
      height: number | null;
      duration: number | null;
      codec: string | null;
    };
    return applyAutoMetaTags(db, id, row);
  }

  it("writes the derived tags on the first pass", () => {
    expect(apply()).toBe(true);
    expect(autoNames()).toEqual([
      "codec:hevc",
      "dur:long",
      "orient:horizontal",
      "res:4k",
    ]);
  });

  it("is idempotent — a second pass writes nothing", () => {
    apply();
    expect(apply()).toBe(false);
    expect(autoNames()).toHaveLength(4);
  });

  it("drops stale tags when the metadata changes", () => {
    apply();
    db.prepare("UPDATE files SET codec = 'av1' WHERE id = ?").run(id);
    expect(apply()).toBe(true);
    expect(autoNames()).toContain("codec:av1");
    expect(autoNames()).not.toContain("codec:hevc");
  });

  it("removes every tag when the probe result is lost", () => {
    apply();
    db.prepare(
      "UPDATE files SET width = NULL, height = NULL, duration = NULL, codec = NULL WHERE id = ?",
    ).run(id);
    expect(apply()).toBe(true);
    expect(autoNames()).toEqual([]);
  });

  it("leaves manual tags alone", () => {
    addManualTag(db, id, "beach");
    apply();
    expect(fileTags(db, id).filter((t) => t.source === "manual")).toHaveLength(
      1,
    );
  });

  it("refuses an unnamespaced derived tag", () => {
    const metaKey = db
      .prepare("SELECT meta_key FROM files WHERE id = ?")
      .pluck()
      .get(id) as string;
    // tags_text indexes namespace = '' only, so letting this through would rot
    // the search index without any visible failure.
    expect(() =>
      applyDerivedTagsByKey(db, metaKey, "auto-name", [
        { namespace: "", name: "beach" },
      ]),
    ).toThrow(/namespaced/);
  });

  it("owns only its own source", () => {
    // The applier is generic; a second source must not clobber the first.
    const metaKey = db
      .prepare("SELECT meta_key FROM files WHERE id = ?")
      .pluck()
      .get(id) as string;
    apply();
    applyDerivedTagsByKey(db, metaKey, "auto-name", [
      { namespace: "studio", name: "a24" },
    ]);
    expect(autoNames()).toHaveLength(4);
    expect(
      fileTags(db, id).filter((t) => t.source === "auto-name"),
    ).toHaveLength(1);
  });
});

describe("backfillAutoMetaTags", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
    insertFile(db, rootId, {
      relPath: "a.mp4",
      width: 3840,
      height: 2160,
      duration: 10,
      codec: "h264",
    });
    insertFile(db, rootId, {
      relPath: "b.jpg",
      kind: "image",
      width: 800,
      height: 600,
    });
  });
  afterEach(() => db.close());

  it("tags every alive row and records the ruleset version", async () => {
    expect(needsAutoMetaBackfill(db)).toBe(true);
    expect(await backfillAutoMetaTags(db)).toBe(2);
    expect(getSetting(db, AUTO_META_VERSION_KEY)).toBe(
      String(AUTO_META_RULESET_VERSION),
    );
    expect(needsAutoMetaBackfill(db)).toBe(false);
  });

  it("is a no-op on a second run", async () => {
    await backfillAutoMetaTags(db);
    expect(await backfillAutoMetaTags(db)).toBe(0);
  });

  it("skips soft-deleted rows", async () => {
    db.prepare(
      "UPDATE files SET deleted_at = 1 WHERE rel_path = 'b.jpg'",
    ).run();
    expect(await backfillAutoMetaTags(db)).toBe(1);
  });

  it("does not touch the search index", async () => {
    db.prepare(
      "INSERT INTO files_fts (rowid, rel_path, tags_text) VALUES (1, 'a.mp4', 'beach')",
    ).run();
    await backfillAutoMetaTags(db);
    const row = db
      .prepare("SELECT tags_text FROM files_fts WHERE rowid = 1")
      .get() as { tags_text: string };
    // tags_text carries only user-owned tags, so a namespaced source cannot
    // change it — re-syncing every backfilled row would be pure cost.
    expect(row.tags_text).toBe("beach");
  });

  it("does not record the version when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await backfillAutoMetaTags(db, { signal: ac.signal });
    expect(getSetting(db, AUTO_META_VERSION_KEY)).toBeNull();
    expect(needsAutoMetaBackfill(db)).toBe(true);
  });

  it("survives a library larger than one chunk", async () => {
    // BACKFILL_CHUNK is 512, and the pass writes a transaction per chunk. A
    // cursor left open across that write throws "this database connection is
    // busy executing a query", which a two-file fixture never reaches.
    for (let i = 0; i < 600; i++) {
      insertFile(db, rootId, {
        relPath: `bulk/${i}.mp4`,
        width: 1920,
        height: 1080,
        duration: 30,
        codec: "h264",
      });
    }
    expect(await backfillAutoMetaTags(db)).toBe(602);
    expect(getSetting(db, AUTO_META_VERSION_KEY)).toBe(
      String(AUTO_META_RULESET_VERSION),
    );
    // Every bulk row got the full set; nothing was skipped at a page boundary.
    const n = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM meta_tags WHERE source = ? AND meta_key LIKE '%bulk/%'",
        )
        .get(AUTO_META_SOURCE) as { n: number }
    ).n;
    expect(n).toBe(600 * 4);
  });

  it("lets a write through between chunks", async () => {
    for (let i = 0; i < 600; i++) {
      insertFile(db, rootId, {
        relPath: `bulk/${i}.mp4`,
        width: 800,
        height: 600,
      });
    }
    let wroteMidPass = false;
    await backfillAutoMetaTags(db, {
      onProgress: (done) => {
        if (done !== 512 || wroteMidPass) return;
        // The connection must be free here — a tag mutation arriving during the
        // yield used to fail with the same "busy executing a query" error.
        db.prepare(
          "INSERT INTO tags (name, namespace) VALUES ('mid', '')",
        ).run();
        wroteMidPass = true;
      },
    });
    expect(wroteMidPass).toBe(true);
  });

  it("reports progress against the alive-row total", async () => {
    const seen: [number, number][] = [];
    await backfillAutoMetaTags(db, {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.at(-1)).toEqual([2, 2]);
  });
});
