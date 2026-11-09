import { describe, expect, it } from "vitest";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import {
  parsePexelsVideoUrl,
  suggestPexelsSource,
} from "../../../shared/pexelsSource.js";
import { migrateMetaKey } from "../queries.js";
import {
  previewPexelsSources,
  writePexelsSources,
} from "../queries/pexelsSources.js";
import { insertFile, newDb, newSharedDbs } from "./helpers.js";

const url = "https://www.pexels.com/video/5586539/";

describe("Pexels links", () => {
  it.each([
    "pexels-tima-miroshnichenko-5586539.mp4",
    "5586539-hd_1920_1080_29.97fps (2).mp4",
    "5586539_uhd_3840_2160_30fps.mp4",
    "5586539_3840_2160_30fps.mp4",
    "pexels-tima-miroshnichenko-5586539-1920x1080-30fps.mp4",
    "Pexels Videos 5586539-Apple ProRes 422.mov",
    "production ID 5586539.mp4",
  ])("extracts the upload ID from %s", (name) => {
    expect(suggestPexelsSource(name)).toEqual({ videoId: "5586539", url });
  });

  it.each(["clip-5586539.mp4", "1920x1080.mp4", "pexels-4k-0.mov"])(
    "leaves %s unknown",
    (name) => expect(suggestPexelsSource(name)).toBeNull(),
  );

  it("keeps a Pexels page slug and drops query and fragment", () => {
    expect(
      parsePexelsVideoUrl(
        " https://pexels.com/fr-fr/video/a-clip-5586539?ref=1#page ",
      ),
    ).toEqual({
      videoId: "5586539",
      url: "https://www.pexels.com/fr-fr/video/a-clip-5586539/",
    });
  });

  it.each([
    "http://www.pexels.com/video/5586539/",
    "https://www.pexels.com.evil.example/video/5586539/",
    "https://www.pexels.com@evil.example/video/5586539/",
    "https://other@www.pexels.com/video/5586539/",
    "https://videos.pexels.com/video/5586539/",
    "https://www.pexels.com/photo/a-clip-5586539/",
    "https://www.pexels.com/video/5586539/extra",
  ])("rejects %s at the IPC boundary", (source) => {
    expect(
      ChannelInputs.pexels_source_set.safeParse({
        id: 1,
        workspaceId: "w",
        metaKey: "hash",
        source,
      }).success,
    ).toBe(false);
  });
});

describe("Pexels catalogue metadata", () => {
  it("reviews live videos in a subtree or an explicit selection", () => {
    const { db, rootId } = newDb();
    try {
      const suggested = insertFile(db, rootId, {
        relPath: "Stock/Day 1/pexels-tima-miroshnichenko-5586539.mp4",
        width: 2560,
        height: 1440,
      });
      const unknown = insertFile(db, rootId, { relPath: "Stock/unknown.mp4" });
      const deleted = insertFile(db, rootId, { relPath: "Stock/deleted.mp4" });
      const image = insertFile(db, rootId, {
        relPath: "Stock/still.jpg",
        kind: "image",
      });
      const elsewhere = insertFile(db, rootId, {
        relPath: "Stockings/other.mp4",
      });
      db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(deleted);

      const preview = previewPexelsSources(db, "w", {
        folder: "Stock",
        limit: 10,
      });
      expect(preview).toMatchObject([
        {
          id: suggested,
          workspaceId: "w",
          width: 2560,
          height: 1440,
          saved: null,
          suggestion: { url },
        },
        {
          id: unknown,
          workspaceId: "w",
          width: null,
          height: null,
          saved: null,
          suggestion: null,
        },
      ]);
      expect(
        previewPexelsSources(db, "w", { folder: "Stock", limit: 1 }),
      ).toHaveLength(1);
      expect(
        previewPexelsSources(db, "w", {
          fileIds: [unknown, image, deleted, elsewhere],
        }).map((row) => row.id),
      ).toEqual([unknown, elsewhere]);
    } finally {
      db.close();
    }
  });

  it("protects confirmed links and carries them from the path fallback through a rename", () => {
    const { db, rootId } = newDb();
    try {
      const id = insertFile(db, rootId, { relPath: "clip.mp4" });
      const read = () => previewPexelsSources(db, "w", { fileIds: [id] })[0];
      const { metaKey } = read();
      const edit = { id, metaKey, source: url };
      expect(writePexelsSources(db, [edit], false)).toBe(1);
      expect(
        writePexelsSources(
          db,
          [{ ...edit, source: "https://www.pexels.com/video/9/" }],
          false,
        ),
      ).toBe(0);
      expect(read().saved?.url).toBe(url);

      db.prepare("UPDATE files SET content_hash = 'hashed' WHERE id = ?").run(
        id,
      );
      migrateMetaKey(db, metaKey, "hashed");
      db.prepare("UPDATE files SET rel_path = 'new-name.mp4' WHERE id = ?").run(
        id,
      );
      expect(read()).toMatchObject({
        relPath: "new-name.mp4",
        saved: { url },
        suggestion: null,
      });
      expect(writePexelsSources(db, [{ ...edit, source: null }], true)).toBe(0);
      expect(
        writePexelsSources(db, [{ id, metaKey: "hashed", source: null }], true),
      ).toBe(1);
      expect(read().saved).toBeNull();
    } finally {
      db.close();
    }
  });
});

it("shares a confirmed source across workspaces with the same content", () => {
  const {
    dbs: [first, second],
    cleanup,
  } = newSharedDbs(2);
  try {
    const contentHash = "same-content";
    const a = insertFile(first.db, first.rootId, {
      relPath: "stock.mp4",
      root: first.root,
      contentHash,
    });
    const b = insertFile(second.db, second.rootId, {
      relPath: "renamed.mp4",
      root: second.root,
      contentHash,
    });
    expect(
      writePexelsSources(
        first.db,
        [{ id: a, metaKey: contentHash, source: url }],
        false,
      ),
    ).toBe(1);
    expect(
      previewPexelsSources(second.db, "b", { fileIds: [b] })[0].saved?.url,
    ).toBe(url);
  } finally {
    cleanup();
  }
});
