// The auto-tagging engine and analysis (shared/), and the database side that
// attaches what they propose.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import {
  AUTO_TAG_PENDING_KEY,
  applyAutoTags,
  applyAutoTagsOnScan,
  attachAutoTags,
  autoTagFiles,
  detachTagPairs,
} from "../autoTag.js";
import {
  AutoTagTimeoutError,
  AutoTagUnavailableError,
  AutoTagWorkerClient,
} from "../autoTagDeriver.js";
import { getSetting, searchFiles } from "../queries.js";
import { addManualTag, fileTags } from "../tags.js";
import {
  MAX_RULE_MATCHES,
  compileEngine,
  compileKeyword,
  compilePattern,
  compileRule,
  defaultAutoTagConfig,
  defaultRules,
  proposalsFor,
  runKeyword,
  runRule,
  tagsForName,
  type KeywordEntry,
  type TagRule,
} from "../../../shared/autoTag.js";
import {
  candidateGroup,
  extractTerms,
  segments,
  suggestCandidates,
  nameTagParts,
  tokenInfo,
  tokenizeName,
} from "../../../shared/autoTagAnalysis.js";
import { AutoTagConfigSchema } from "../../../shared/ipc/schema.js";
import { insertFile, newDb } from "./helpers.js";

const rule = (over: Partial<TagRule> = {}): TagRule => ({
  ...defaultRules()[0],
  ...over,
});
const keyword = (over: Partial<KeywordEntry> = {}): KeywordEntry => ({
  id: "k",
  tag: "Yoga",
  aliases: ["ヨガ"],
  mode: "word",
  ...over,
});
const engineOf = (rules: TagRule[], keywords: KeywordEntry[] = []) =>
  compileEngine({ rules, keywords });
const hitsOf = (r: TagRule, name: string) => runRule(compileRule(r)!, name);

const NAMES = [
  "ABCD-123 Morning yoga routine.mp4",
  "ABCD-124 Evening yoga stretch.mp4",
  "WXY-001 Harbor walk.mp4",
  "[Trip][Kyoto] 竹林 散歩.mp4",
  "[Trip, Family] Harbor picnic.mp4",
  "【4K】Harbor night walk.mp4",
  "「夏休み」花火大会.mov",
  "IMG-2041.jpg",
  "ヨガ 練習 2024-05.mp4",
];

describe("rules", () => {
  it("tags a file by the code that leads its name, minus the excluded ones", () => {
    const engine = engineOf(defaultRules());
    expect(tagsForName(engine, NAMES[0])).toEqual(["ABCD"]);
    expect(tagsForName(engine, "IMG-2041.jpg")).toEqual([]);
  });

  it("takes every bracket pair and splits a list inside one", () => {
    const engine = engineOf(defaultRules());
    expect(tagsForName(engine, NAMES[3])).toEqual(["Trip", "Kyoto"]);
    expect(tagsForName(engine, NAMES[4])).toEqual(["Trip", "Family"]);
    expect(tagsForName(engine, NAMES[6])).toEqual(["夏休み"]);
    // The round-bracket rule ships disabled.
    expect(tagsForName(engine, "(Draft) plan.mp4")).toEqual([]);
  });

  it("reports where it matched, and marks a match that was excluded", () => {
    expect(hitsOf(rule(), NAMES[0])).toEqual([
      { start: 0, end: 8, tags: ["ABCD"] },
    ]);
    expect(hitsOf(rule(), "IMG-2041.jpg")).toEqual([
      { start: 0, end: 8, tags: [] },
    ]);
  });

  it("applies the template, the case mode and case-insensitive matching", () => {
    expect(hitsOf(rule({ template: "code-$1" }), NAMES[0])[0].tags).toEqual([
      "code-ABCD",
    ]);
    expect(hitsOf(rule({ template: "Series" }), NAMES[0])[0].tags).toEqual([
      "Series",
    ]);
    expect(hitsOf(rule(), "abcd-123 x.mp4")).toEqual([]);
    expect(
      hitsOf(rule({ ci: true, caseMode: "upper" }), "abcd-123 x.mp4")[0].tags,
    ).toEqual(["ABCD"]);
  });

  it("never reads the extension and stops a pattern that matches everywhere", () => {
    expect(hitsOf(rule({ pattern: "(mp4)" }), "clip.mp4")).toEqual([]);
    const all = hitsOf(rule({ pattern: "([a-z])" }), `${"ab".repeat(80)}.mp4`);
    expect(all).toHaveLength(MAX_RULE_MATCHES);
  });

  it("reports an invalid pattern and accepts legacy escapes", () => {
    expect(compilePattern("(", false)).toHaveProperty("error");
    expect(compilePattern("^([A-Z]+)\\-\\d+", false)).toHaveProperty("regex");
    expect(compileRule(rule({ pattern: "(" }))).toBeNull();
  });

  it("keeps a tag name within the length the rest of the app accepts", () => {
    const square = defaultRules()[1];
    // 63 letters and two emoji: cut by code point, to 64 UTF-16 units or fewer.
    const [tag] = hitsOf(square, `[${"x".repeat(63)}😀😀] y.mp4`)[0].tags;
    expect(tag).toBe("x".repeat(63));
    expect(tag.length).toBeLessThanOrEqual(64);
    // Folding case can lengthen a name; the cut comes after it.
    const [upper] = hitsOf(
      { ...square, caseMode: "upper" },
      `[${"ß".repeat(40)}] y.mp4`,
    )[0].tags;
    expect(upper).toBe("S".repeat(64));
    expect(hitsOf(square, "[a \u200b b] x.mp4")[0].tags).toEqual(["a b"]);
  });

  it("keeps invisible characters and reserved names out of tags", () => {
    const square = defaultRules()[1];
    expect(hitsOf(square, "[a​b‮] x.mp4")[0].tags).toEqual(["ab"]);
    expect(hitsOf(square, "[res:4k] x.mp4")[0].tags).toEqual([]);
  });
});

describe("keywords", () => {
  const hits = (k: KeywordEntry, name: string) =>
    runKeyword(compileKeyword(k)!, name).map((h) => h.text);

  it("finds the tag or any alias, whatever the case", () => {
    expect(hits(keyword(), NAMES[0])).toEqual(["yoga"]);
    expect(hits(keyword(), NAMES[8])).toEqual(["ヨガ"]);
    expect(tagsForName(engineOf([], [keyword()]), NAMES[8])).toEqual(["Yoga"]);
  });

  it("in word mode an ASCII term must stand alone; Japanese always matches inside", () => {
    expect(hits(keyword(), "yogamat review.mp4")).toEqual([]);
    expect(hits(keyword({ mode: "contains" }), "yogamat review.mp4")).toEqual([
      "yoga",
    ]);
    expect(hits(keyword(), "朝ヨガ教室.mp4")).toEqual(["ヨガ"]);
  });

  it("never reads the extension, like the rules", () => {
    const movie = keyword({ tag: "Movie", aliases: ["mov"] });
    expect(hits(movie, "holiday.mov")).toEqual([]);
    expect(hits(movie, "mov night.mp4")).toEqual(["mov"]);
    expect(
      hits(keyword({ tag: "AV", aliases: [], mode: "contains" }), "clip.avi"),
    ).toEqual([]);
  });

  it("matches a decomposed (macOS) name against a keyword typed normally", () => {
    const engine = engineOf([], [keyword({ tag: "ガール", aliases: [] })]);
    expect(tagsForName(engine, `${"ガール".normalize("NFD")} 01.mp4`)).toEqual([
      "ガール",
    ]);
  });
});

describe("proposals", () => {
  it("lists rules first, then the dictionary, one spelling per tag", () => {
    const engine = engineOf(defaultRules(), [
      keyword({ id: "trip", tag: "trip", aliases: [] }),
      keyword(),
    ]);
    expect(proposalsFor(engine, "[Trip] yoga camp.mp4")).toEqual([
      { tag: "Trip", key: "trip", source: { kind: "rule", ruleId: "square" } },
      { tag: "Yoga", key: "yoga", source: { kind: "keyword", keywordId: "k" } },
    ]);
  });
});

describe("analysis", () => {
  const stop = new Set(["routine"]);

  it("cuts a name into highlighted and plain runs", () => {
    expect(
      segments("ab-cd", [
        { start: 3, end: 5 },
        { start: 0, end: 2, muted: true },
      ]),
    ).toEqual([
      { text: "ab", kind: "muted" },
      { text: "-", kind: "plain" },
      { text: "cd", kind: "hit" },
    ]);
  });

  it("suggests what the engine yields plus frequent words it misses", () => {
    const cands = suggestCandidates(
      engineOf(defaultRules(), [keyword()]),
      NAMES,
      {
        minFreq: 2,
        stop,
      },
    );
    const by = new Map(cands.map((c) => [c.key, c]));
    expect(by.get("abcd")).toMatchObject({ count: 2, origins: ["prefix"] });
    expect(by.get("trip")).toMatchObject({ count: 2, origins: ["bracket"] });
    expect(by.get("yoga")).toMatchObject({ count: 3, origins: ["keyword"] });
    expect(by.get("yoga")!.variants.sort()).toEqual(["yoga", "ヨガ"]);
    // "Harbor" is in three names and nothing claims it.
    expect(by.get("harbor")).toMatchObject({ name: "Harbor", count: 3 });
    expect(candidateGroup(by.get("harbor")!)).toBe("frequent");
    // Once, or a stop word, or already a tag: not offered as a frequent word.
    expect(by.has("picnic")).toBe(false);
    expect(by.has("routine")).toBe(false);
    expect(cands[0].count).toBeGreaterThanOrEqual(cands[1].count);
  });

  it("cuts a name into clickable tokens and says what each one is", () => {
    const tokens = tokenizeName("ABCD-123 [Trip, Family]_harbor.mp4");
    expect(tokens.filter((t) => !t.sep).map((t) => t.text)).toEqual([
      "ABCD-123",
      "[Trip, Family]",
      "harbor",
    ]);
    expect(tokens.map((t) => t.text).join("")).toBe(
      "ABCD-123 [Trip, Family]_harbor.mp4",
    );
    expect(tokenInfo("ABCD-123")).toEqual({ type: "code", value: "ABCD" });
    const bracket = tokenInfo("[Trip, Family]");
    expect(bracket).toMatchObject({ type: "bracket", bracket: "square" });
    expect(tokenInfo("harbor")).toEqual({ type: "word", value: "harbor" });
  });

  it("offers a name's words, code prefix and bracket entries as tags", () => {
    const name = "ABCD-123 [Trip, Family]_harbor.mp4";
    const parts = nameTagParts(name);
    // Nothing of the name is lost or reordered.
    expect(parts.map((p) => p.text).join("")).toBe(name);
    expect(parts.filter((p) => p.tag !== null)).toEqual([
      // A code is tagged by its prefix, not by the whole of it.
      { text: "ABCD-123", tag: "ABCD" },
      // Each entry inside the brackets is a tag of its own.
      { text: "Trip", tag: "Trip" },
      { text: "Family", tag: "Family" },
      { text: "harbor", tag: "harbor" },
    ]);
    // The extension, the brackets and what separates entries are plain text.
    expect(parts.filter((p) => p.tag === null).map((p) => p.text)).toEqual([
      " ",
      "[",
      ",",
      " ",
      "]",
      "_",
      ".mp4",
    ]);
  });

  it("tags a word without the punctuation around it, and never by punctuation alone", () => {
    const tagsOf = (name: string) =>
      nameTagParts(name)
        .filter((p) => p.tag !== null)
        .map((p) => [p.text, p.tag]);
    // The dash between the two is not a tag.
    expect(tagsOf("Artist - Title.mp4")).toEqual([
      ["Artist", "Artist"],
      ["Title", "Title"],
    ]);
    // Outside brackets as inside them: the comma is not part of the tag.
    expect(tagsOf("Trip, Family.mp4")).toEqual([
      ["Trip,", "Trip"],
      ["Family", "Family"],
    ]);
    expect(tagsOf("(2019) #live 【旅行、家族】.mkv")).toEqual([
      ["(2019)", "2019"],
      ["#live", "live"],
      ["旅行", "旅行"],
      ["家族", "家族"],
    ]);
    // A code is still a code with punctuation around it.
    expect(tagsOf("(ABCD-123) #EFGH-45.mp4")).toEqual([
      ["(ABCD-123)", "ABCD"],
      ["#EFGH-45", "EFGH"],
    ]);
    expect(tagsOf("[] [ , ] _-_.mp4")).toEqual([]);
  });

  it("offers no tag for a part that cannot be one", () => {
    // A reserved prefix would impersonate a tag the app derives itself.
    const parts = nameTagParts("res:hd clip.mp4");
    expect(parts.find((p) => p.text === "res:hd")?.tag).toBeNull();
    expect(parts.find((p) => p.text === "clip")?.tag).toBe("clip");
  });

  it("extracts terms by kind, grouping spellings and counting files", () => {
    const terms = extractTerms([...NAMES, "harbor_fog.mp4"], stop);
    const by = new Map(terms.map((t) => [t.key, t]));
    expect(by.get("abcd")).toMatchObject({ type: "code", count: 2 });
    expect(by.get("trip")).toMatchObject({ type: "bracket", count: 2 });
    expect(by.get("harbor")).toMatchObject({
      type: "word",
      display: "Harbor",
      count: 4,
    });
    expect(by.get("harbor")!.variants).toEqual(["Harbor", "harbor"]);
    expect(by.get("花火大会")).toMatchObject({ type: "ja", count: 1 });
    // Inside a bracket it is a bracket term, not also a word.
    expect(by.get("kyoto")).toMatchObject({ type: "bracket" });
    expect(by.has("routine")).toBe(false);
  });
});

describe("configuration", () => {
  it("ships rules but does not tag on scan until asked to", () => {
    const config = defaultAutoTagConfig();
    expect(config.applyOnScan).toBe(false);
    expect(config.rules.map((r) => r.id)).toEqual([
      "prefix",
      "square",
      "sumi",
      "kagi",
      "paren",
    ]);
    expect(AutoTagConfigSchema.safeParse(config).success).toBe(true);
  });

  it("stores a rule whose pattern is still being typed", () => {
    const config = {
      ...defaultAutoTagConfig(),
      rules: [rule({ pattern: "(" })],
    };
    expect(AutoTagConfigSchema.safeParse(config).success).toBe(true);
    expect(compileEngine(config).rules).toEqual([]);
  });
});

describe("attaching tags", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  const names = (id: number) => fileTags(db, id).map((t) => t.name);

  it("adds the user's own tags, reusing one that differs only by case", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    addManualTag(db, a, "Yoga");

    const result = attachAutoTags(db, [
      { fileIds: [a, b], tags: ["yoga", "Trip"] },
    ]);
    expect(names(a)).toEqual(["Trip", "Yoga"]);
    expect(names(b)).toEqual(["Trip", "Yoga"]);
    expect(fileTags(db, b).every((t) => t.source === "manual")).toBe(true);
    // `a` already had Yoga: three pairs were added, not four.
    expect(result).toMatchObject({ files: 2 });
    expect(result.pairs).toHaveLength(3);
    // The tags are searchable like any hand-applied one.
    expect(
      searchFiles(db, { q: "Trip" })
        .items.map((f) => f.id)
        .sort(),
    ).toEqual([a, b].sort());
  });

  it("reuses a tag that differs by case beyond ASCII too", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    addManualTag(db, a, "Été");
    const b = insertFile(db, rootId, { relPath: "b.mp4" });
    attachAutoTags(db, [{ fileIds: [b], tags: ["été"] }]);
    expect(names(b)).toEqual(["Été"]);
  });

  it("counts the files named, though copies share one set of tags", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "h" });
    const b = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "h" });
    const result = attachAutoTags(db, [{ fileIds: [a, b], tags: ["Trip"] }]);
    expect(result.files).toBe(2);
    expect(result.pairs).toHaveLength(1);
    expect(names(b)).toEqual(["Trip"]);
  });

  it("takes back exactly what it added", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    addManualTag(db, a, "Yoga");
    const { pairs } = attachAutoTags(db, [
      { fileIds: [a], tags: ["Yoga", "Trip"] },
    ]);
    expect(detachTagPairs(db, pairs)).toBe(1);
    expect(names(a)).toEqual(["Yoga"]);
    expect(searchFiles(db, { q: "Trip" }).items).toEqual([]);
  });

  it("skips reserved names and files that are gone", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4" });
    const result = attachAutoTags(db, [
      { fileIds: [a, 9999], tags: ["res:4k", "  "] },
    ]);
    expect(result).toEqual({ files: 0, pairs: [] });
    expect(names(a)).toEqual([]);
  });

  it("runs the engine over every file, or only the ones named", async () => {
    const ids = NAMES.map((relPath) =>
      insertFile(db, rootId, { relPath: `dir/${relPath}` }),
    );
    const engine = { rules: defaultRules(), keywords: [keyword()] };

    const some = await applyAutoTags(db, { engine, fileIds: [ids[0], ids[7]] });
    expect(some).toEqual({ files: 1, added: 2, completed: true });
    expect(names(ids[0])).toEqual(["ABCD", "Yoga"]);
    expect(names(ids[3])).toEqual([]);

    const all = await applyAutoTags(db, { engine });
    expect(all.completed).toBe(true);
    expect(names(ids[3])).toEqual(["Kyoto", "Trip"]);
    expect(names(ids[8])).toEqual(["Yoga"]);
    // Nothing left to add the second time.
    expect((await applyAutoTags(db, { engine })).added).toBe(0);
  });

  it("keeps owing the files of a scan that was cut short", async () => {
    const id = insertFile(db, rootId, { relPath: NAMES[0] });
    const engine = { rules: defaultRules(), keywords: [] };
    const controller = new AbortController();
    controller.abort();
    await applyAutoTagsOnScan(db, {
      engine,
      changedIds: [id],
      signal: controller.signal,
    });
    expect(names(id)).toEqual([]);
    expect(getSetting(db, AUTO_TAG_PENDING_KEY)).toBe(JSON.stringify([id]));

    // The next scan sees the file as unchanged, and tags it anyway.
    await applyAutoTagsOnScan(db, { engine, changedIds: [] });
    expect(names(id)).toEqual(["ABCD"]);
    expect(getSetting(db, AUTO_TAG_PENDING_KEY)).toBe("[]");
  });

  it("loads names, own tags and the tag catalog for the screen", () => {
    const a = insertFile(db, rootId, { relPath: `dir/${NAMES[0]}` });
    addManualTag(db, a, "Yoga");
    const gone = insertFile(db, rootId, { relPath: "gone.mp4" });
    db.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?").run(gone);

    expect(autoTagFiles(db, "ws")).toEqual({
      files: [
        {
          workspaceId: "ws",
          id: a,
          name: NAMES[0],
          metaKey: `p:${rootId}:dir/${NAMES[0]}`,
          tags: ["Yoga"],
        },
      ],
      total: 1,
      existingTags: ["Yoga"],
    });
  });
});

describe("AutoTagWorkerClient", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-auto-tag-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const engine = { rules: defaultRules(), keywords: [] };
  function workerFile(body: string): string {
    const file = path.join(dir, "worker.cjs");
    fs.writeFileSync(
      file,
      `const { parentPort } = require("node:worker_threads");\n${body}`,
    );
    return file;
  }

  it("kills a worker that does not answer and reports a timeout", async () => {
    const client = new AutoTagWorkerClient(
      workerFile(`parentPort.on("message", () => { for (;;) {} });`),
      200,
    );
    await expect(client.derive(engine, ["a.mp4"])).rejects.toBeInstanceOf(
      AutoTagTimeoutError,
    );
    client.dispose();
  });

  it("returns what the worker derived", async () => {
    const client = new AutoTagWorkerClient(
      workerFile(
        `parentPort.on("message", (m) => parentPort.postMessage({
           id: m.id, ok: true, tags: m.names.map((n) => [n]),
         }));`,
      ),
    );
    expect(await client.derive(engine, ["a.mp4", "b.mp4"])).toEqual([
      ["a.mp4"],
      ["b.mp4"],
    ]);
    client.dispose();
  });

  it("evaluates nothing on this thread when the worker cannot be loaded", async () => {
    const client = new AutoTagWorkerClient(path.join(dir, "missing.cjs"));
    await expect(client.derive(engine, [NAMES[0]])).rejects.toBeInstanceOf(
      AutoTagUnavailableError,
    );
    client.dispose();
    await expect(client.derive(engine, [NAMES[0]])).rejects.toBeInstanceOf(
      AutoTagUnavailableError,
    );
  });
});
