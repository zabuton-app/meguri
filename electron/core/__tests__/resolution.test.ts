import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertFile, newDb } from "./helpers.js";
import { searchFiles, setRating } from "../queries.js";
import { searchWorkspaces } from "../crossWorkspace.js";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import type { SearchQuery } from "../types.js";

describe("resolution and visual-media filters", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => ({ db, rootId } = newDb()));
  afterEach(() => db.close());

  function seed() {
    for (const [name, width, height, kind] of [
      ["hd", 1280, 720, "video"],
      ["uhd", 3840, 2160, "video"],
      ["portrait", 2160, 3840, "video"],
      ["dci", 4096, 2160, "video"],
      ["cinema", 4096, 1716, "video"],
      ["8k", 7680, 4320, "video"],
      ["photo", 4000, 3000, "image"],
      ["audio", 3840, 2160, "audio"],
      ["unknown", null, null, "video"],
    ] as const) {
      insertFile(db, rootId, { relPath: name, width, height, kind });
    }
  }

  function names(query: SearchQuery) {
    return searchFiles(db, query)
      .items.map((file) => file.relPath)
      .sort();
  }

  it("selects exact UHD dimensions in either orientation", () => {
    seed();
    expect(
      names({ kind: "video", resolution: { preset: "uhd", match: "exact" } }),
    ).toEqual(["portrait", "uhd"]);
  });

  it("includes higher resolutions and images, and excludes missing dimensions", () => {
    seed();
    expect(
      names({
        kind: "visual",
        resolution: { preset: "uhd", match: "atLeast" },
      }),
    ).toEqual(["8k", "cinema", "dci", "photo", "portrait", "uhd"]);
  });

  it("keeps single-kind filtering and DCI dimensions distinct", () => {
    seed();
    expect(
      names({ kind: "image", resolution: { preset: "uhd", match: "atLeast" } }),
    ).toEqual(["photo"]);
    expect(
      names({ kind: "video", resolution: { preset: "dci4k", match: "exact" } }),
    ).toEqual(["dci"]);
  });

  it("combines rating and resolution across scan roots before sorting", () => {
    const other = newDb();
    try {
      const first = insertFile(db, rootId, {
        relPath: "b.mp4",
        width: 3840,
        height: 2160,
      });
      const second = insertFile(other.db, other.rootId, {
        relPath: "a.mp4",
        width: 4096,
        height: 2160,
      });
      const low = insertFile(other.db, other.rootId, {
        relPath: "low.mp4",
        width: 1280,
        height: 720,
      });
      setRating(db, first, 4);
      setRating(other.db, second, 5);
      setRating(other.db, low, 5);
      const result = searchWorkspaces(
        [
          { id: "first", core: { db } as Core },
          { id: "second", core: { db: other.db } as Core },
        ],
        {
          ratingMin: 4,
          resolution: { preset: "uhd", match: "atLeast" },
          sort: "name",
          sortDir: "asc",
        },
      );
      expect(
        result.items.map((file) => [file.workspaceId, file.relPath]),
      ).toEqual([
        ["second", "a.mp4"],
        ["first", "b.mp4"],
      ]);
    } finally {
      other.db.close();
    }
  });
});
