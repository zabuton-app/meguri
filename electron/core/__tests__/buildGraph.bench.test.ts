// Scale check for the graph payload (spec SC-001): 5,000 files and their tags
// must be gathered well inside the two seconds the first draw is allowed. The
// threshold is loose so a busy CI machine does not make it flaky.
import { describe, expect, it } from "vitest";
import type { Core } from "../index.js";
import { buildGraph } from "../graph/buildGraph.js";
import { insertFile, newDb } from "./helpers.js";

const FILES = 5_000;
const TAGS = 200;

describe("buildGraph at scale", () => {
  it("builds 5,000 files with ~12,000 tag links in under 500ms", () => {
    const { db, rootId } = newDb();
    const insertTag = db.prepare(
      "INSERT INTO tags (namespace, name) VALUES ('', ?)",
    );
    const link = db.prepare(
      "INSERT OR IGNORE INTO meta_tags (meta_key, tag_id, source) VALUES (?, ?, 'manual')",
    );
    db.transaction(() => {
      for (let t = 0; t < TAGS; t++) insertTag.run(`tag${t}`);
      // Deterministic power-law-ish spread: low tag ids are the big hubs.
      let seed = 7;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < FILES; i++) {
        insertFile(db, rootId, {
          relPath: `dir${i % 50}/file${i}.jpg`,
          kind: "image",
          contentHash: `hash${i}`,
        });
        const n = 1 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const tag = 1 + Math.floor(TAGS * rnd() ** 3);
          link.run(`hash${i}`, tag);
        }
      }
    })();

    const started = performance.now();
    const payload = buildGraph(
      [{ id: "w", core: { db } as Core }],
      {},
      { cap: FILES },
    );
    const elapsed = performance.now() - started;
    const links = payload.edgeSets[0]?.a.length ?? 0;
    console.log(
      `buildGraph: ${FILES} files, ${payload.tags.name.length} tags, ${links} links in ${elapsed.toFixed(0)}ms`,
    );

    expect(payload.files.id.length).toBe(FILES);
    expect(links).toBeGreaterThan(FILES);
    expect(elapsed).toBeLessThan(500);
  });
});
