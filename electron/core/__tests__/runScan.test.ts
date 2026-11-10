// The scan pipeline end to end (#288): walk → sync → auto-tags → FTS →
// thumbnails, against a temporary folder and an in-memory database. ffmpeg is
// stubbed: what is checked here is how runScan wires the phases together, not
// the media tools (media.test.ts covers those).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Which thumbnails fail, by file name: none unless a test says so.
const media = vi.hoisted(() => {
  const state: { failThumb: (src: string) => boolean } = {
    failThumb: () => false,
  };
  return state;
});
vi.mock("../media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../media.js")>()),
  extractMeta: () =>
    Promise.resolve({
      width: 640,
      height: 360,
      duration: 1,
      codec: "h264",
      fps: 30,
      capturedAt: null,
      raw: { streams: [] },
    }),
  generateThumb: async (src: string, _kind: string, dest: string) => {
    if (media.failThumb(src)) return false;
    await fsp.writeFile(dest, "webp");
    return true;
  },
}));

import { openDb, type DB } from "../db.js";
import type { Core } from "../index.js";
import {
  clearExcludedFiles,
  deleteFromIndex,
  upsertScanRoot,
} from "../queries.js";
import { fileTags } from "../tags.js";
import { runScan, type JobEvent } from "../jobs.js";
import { deriveAutoTagsInProcess } from "../autoTagDeriver.js";
import { autoTagSettingsVersion } from "../autoTag.js";
import { defaultAutoTagConfig, defaultRules } from "../../../shared/autoTag.js";

describe("runScan", () => {
  let db: DB;
  let root: string;
  let thumbs: string;
  let rootId: number;
  let core: Core;
  let events: JobEvent[];

  beforeEach(async () => {
    media.failThumb = () => false;
    db = openDb(":memory:", ":memory:");
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-runscan-"));
    thumbs = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-runscan-th-"));
    rootId = upsertScanRoot(db, root, "deadbeef");
    core = { db, root, rootId, thumbsDir: () => thumbs } as unknown as Core;
    events = [];
  });
  afterEach(async () => {
    db.close();
    await fsp.chmod(root, 0o755).catch(() => {});
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(thumbs, { recursive: true, force: true });
  });

  const scan = (opts: Parameters<typeof runScan>[3] = {}) =>
    runScan(core, "job", (e) => events.push(e), opts);

  const rows = () =>
    db
      .prepare(
        "SELECT id, rel_path, deleted_at, thumb_status, width FROM files ORDER BY rel_path",
      )
      .all() as {
      id: number;
      rel_path: string;
      deleted_at: number | null;
      thumb_status: string;
      width: number | null;
    }[];
  const hasFts = (id: number) =>
    db.prepare("SELECT 1 FROM files_fts WHERE rowid = ?").get(id) !== undefined;
  const write = (rel: string, data: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };

  it("indexes new files: rows, search entries, metadata and thumbnails", async () => {
    write("a.mp4", "AAAAAAAAAA");
    write("sub/b.jpg", "BBBBBBBBBB");

    const stats = await scan();

    expect(stats).toMatchObject({ inserted: 2 });
    for (const r of rows()) {
      expect(r).toMatchObject({
        deleted_at: null,
        thumb_status: "done",
        width: 640,
      });
      expect(hasFts(r.id)).toBe(true);
      expect(fs.existsSync(path.join(thumbs, `${r.id}.webp`))).toBe(true);
    }
    const phases = new Set(
      events.flatMap((e) => (e.type === "progress" ? [e.phase] : [])),
    );
    for (const phase of ["walk", "hash", "index", "thumbnail"]) {
      expect(phases).toContain(phase);
    }
    expect(events.at(-1)).toMatchObject({ type: "done", stats });
  });

  it("follows a rename: same id, search entry under the new name", async () => {
    write("a.mp4", "AAAAAAAAAA");
    await scan();
    const [{ id }] = rows();
    fs.renameSync(path.join(root, "a.mp4"), path.join(root, "renamed.mp4"));

    const stats = await scan();

    expect(stats).toMatchObject({ moved: 1, inserted: 0, deleted: 0 });
    expect(rows()).toMatchObject([{ id, rel_path: "renamed.mp4" }]);
    expect(
      db
        .prepare("SELECT rel_path FROM files_fts WHERE rowid = ?")
        .pluck()
        .get(id),
    ).toBe("renamed.mp4");
  });

  it("stops before touching the index when aborted during the walk", async () => {
    write("a.mp4", "AAAAAAAAAA");
    const ac = new AbortController();
    const stats = await runScan(
      core,
      "job",
      (e) => {
        events.push(e);
        if (e.type === "progress" && e.phase === "walk") ac.abort();
      },
      { signal: ac.signal },
    );

    expect(stats.inserted).toBe(0);
    expect(rows()).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "done", aborted: true });
  });

  it("reports a broken toolchain when every thumbnail fails", async () => {
    write("a.mp4", "AAAAAAAAAA");
    media.failThumb = () => true;

    await expect(scan()).rejects.toThrow(/thumbnail extraction failed for all/);
    expect(rows()[0].thumb_status).toBe("error");
  });

  it("does not report the toolchain when only some thumbnails fail", async () => {
    write("a.mp4", "AAAAAAAAAA");
    write("b.mp4", "BBBBBBBBBB");
    media.failThumb = (src) => src.endsWith("b.mp4");

    await scan();

    expect(rows().map((r) => r.thumb_status)).toEqual(["done", "error"]);
  });

  it("leaves thumbnails pending, without an error, when aborted before them", async () => {
    write("a.mp4", "AAAAAAAAAA");
    const ac = new AbortController();
    await runScan(
      core,
      "job",
      (e) => {
        events.push(e);
        if (e.type === "progress" && e.phase === "index") ac.abort();
      },
      { signal: ac.signal },
    );

    expect(rows()[0]).toMatchObject({
      deleted_at: null,
      thumb_status: "pending",
    });
    expect(events.at(-1)).toMatchObject({ type: "done", aborted: true });
  });

  it("tags what the scan added from the file names, when asked to", async () => {
    write("[Trip] harbor.mp4", "AAAAAAAAAA");
    const config = {
      ...defaultAutoTagConfig(),
      rules: defaultRules().map((r) => ({ ...r, enabled: r.id !== "paren" })),
    };

    await scan({
      autoTag: () => ({ config, version: autoTagSettingsVersion() }),
      deriveAutoTags: deriveAutoTagsInProcess,
    });

    const [r] = rows();
    expect(fileTags(db, r.id).map((t) => t.name)).toContain("Trip");
    expect(
      db
        .prepare("SELECT tags_text FROM files_fts WHERE rowid = ?")
        .pluck()
        .get(r.id),
    ).toContain("Trip");
  });

  it("fails without touching the index when the root cannot be read", async () => {
    write("a.mp4", "AAAAAAAAAA");
    await scan();
    const before = rows();
    await fsp.rm(root, { recursive: true });

    await expect(scan()).rejects.toThrow("the scan root cannot be read");
    await expect(scan({ rebuild: true })).rejects.toThrow(
      "the scan root cannot be read",
    );
    expect(rows()).toEqual(before);
  });

  it("keeps file ids and rebuilds search entries and thumbnails on a rebuild", async () => {
    write("a.mp4", "AAAAAAAAAA");
    write("b.mp4", "BBBBBBBBBB");
    await scan();
    const before = rows();
    // Marks that only a reset and a fresh pass would replace.
    db.prepare("UPDATE files SET width = 1").run();
    db.prepare("UPDATE files_fts SET rel_path = 'stale'").run();
    for (const r of before) {
      fs.writeFileSync(path.join(thumbs, `${r.id}.webp`), "stale");
    }

    const stats = await scan({ rebuild: true });

    expect(stats).toMatchObject({ inserted: 0, unchanged: 2 });
    const after = rows();
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    for (const r of after) {
      expect(r).toMatchObject({
        deleted_at: null,
        thumb_status: "done",
        width: 640,
      });
      expect(
        db
          .prepare("SELECT rel_path FROM files_fts WHERE rowid = ?")
          .pluck()
          .get(r.id),
      ).toBe(r.rel_path);
      expect(fs.readFileSync(path.join(thumbs, `${r.id}.webp`), "utf8")).toBe(
        "webp",
      );
    }
  });

  it("makes a file restored to the index searchable again", async () => {
    write("a.mp4", "AAAAAAAAAA");
    await scan();
    const [{ id }] = rows();
    deleteFromIndex(db, id);
    clearExcludedFiles(db, rootId);

    await scan();

    expect(rows()[0]).toMatchObject({ id, deleted_at: null });
    expect(hasFts(id)).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps the rows under a folder it cannot read out of deletion and thumbnails",
    async () => {
      write("open/a.mp4", "AAAAAAAAAA");
      write("locked/b.mp4", "BBBBBBBBBB");
      await scan();
      // Both thumbnailed; make b's pending again, as after an interrupted scan.
      db.prepare(
        "UPDATE files SET thumb_status = 'pending' WHERE rel_path = ?",
      ).run(path.join("locked", "b.mp4"));
      await fsp.chmod(path.join(root, "locked"), 0o000);
      try {
        await scan();
        const b = rows().find(
          (r) => r.rel_path === path.join("locked", "b.mp4"),
        )!;
        expect(b).toMatchObject({ deleted_at: null, thumb_status: "pending" });

        // A rebuild leaves that row, its search entry and its thumbnail be.
        await scan({ rebuild: true });
        expect(rows().find((r) => r.id === b.id)).toMatchObject({
          deleted_at: null,
        });
        expect(hasFts(b.id)).toBe(true);
        expect(fs.existsSync(path.join(thumbs, `${b.id}.webp`))).toBe(true);
      } finally {
        await fsp.chmod(path.join(root, "locked"), 0o755);
      }
    },
  );
});
