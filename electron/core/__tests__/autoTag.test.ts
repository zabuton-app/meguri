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
  MAX_AUTO_TAG_EXCLUDE,
  MAX_AUTO_TAG_RULES,
  MAX_RULE_MATCHES,
  compileEngine,
  compileKeyword,
  compilePattern,
  compileRule,
  defaultAutoTagConfig,
  builtinRulesAsShipped,
  defaultRules,
  excludeValues,
  folderMatcher,
  folderOf,
  formatExclude,
  isUnderFolder,
  proposalsFor,
  resetBuiltinRules,
  runKeyword,
  runRule,
  tagsForName,
  withFolderTags,
  type FolderRule,
  type KeywordEntry,
  type TagRule,
} from "../../../shared/autoTag.js";
import {
  segments,
  suggestCandidates,
  nameTagParts,
  tokenInfo,
  tokenizeName,
} from "../../../shared/autoTagAnalysis.js";
import { AutoTagConfigSchema } from "../../../shared/ipc/schema.js";
import { insertFile, newDb } from "./helpers.js";

/**
 * The built-in rules switched on (they ship switched off), parentheses aside:
 * the set the cases below were written against.
 */
const activeRules = (): TagRule[] =>
  defaultRules().map((r) => ({ ...r, enabled: r.id !== "paren" }));

const rule = (over: Partial<TagRule> = {}): TagRule => ({
  ...activeRules()[0],
  ...over,
});
const keyword = (over: Partial<KeywordEntry> = {}): KeywordEntry => ({
  id: "k",
  terms: ["Yoga", "ヨガ"],
  tags: ["Yoga"],
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
    const engine = engineOf(activeRules());
    expect(tagsForName(engine, NAMES[0])).toEqual(["ABCD"]);
    expect(tagsForName(engine, "IMG-2041.jpg")).toEqual([]);
  });

  it("takes every bracket pair and splits a list inside one", () => {
    const engine = engineOf(activeRules());
    expect(tagsForName(engine, NAMES[3])).toEqual(["Trip", "Kyoto"]);
    expect(tagsForName(engine, NAMES[4])).toEqual(["Trip", "Family"]);
    expect(tagsForName(engine, NAMES[6])).toEqual(["夏休み"]);
    // activeRules() leaves the round-bracket rule off.
    expect(tagsForName(engine, "(Draft) plan.mp4")).toEqual([]);
  });

  it("keeps the exclude list one value to a line, and still reads a comma-separated one", () => {
    // As typed: blank lines, stray spaces, a repeat in another case, and a
    // run with commas, which is how the list was kept before it had lines.
    const typed = "IMG\n\n  dsc \nimg\nMVI, GOPR、PXL\r\nDJI";
    expect(excludeValues(typed)).toEqual([
      "IMG",
      "dsc",
      "MVI",
      "GOPR",
      "PXL",
      "DJI",
    ]);
    expect(formatExclude(excludeValues(typed))).toBe(
      "IMG\ndsc\nMVI\nGOPR\nPXL\nDJI",
    );
    // Matched without regard to case, whichever way the list was written.
    for (const exclude of ["img\ndsc", "IMG, DSC"]) {
      const engine = engineOf([rule({ exclude })]);
      expect(tagsForName(engine, "IMG-2041.jpg")).toEqual([]);
      expect(tagsForName(engine, "DSC-0001.jpg")).toEqual([]);
      expect(tagsForName(engine, "ABCD-123 clip.mp4")).toEqual(["ABCD"]);
    }
  });

  it("holds a long exclude list, and checks it by lookup", () => {
    // A couple of thousand values: what the list is meant to hold.
    const values = Array.from({ length: 2000 }, (_, i) => `CODE${i}`);
    const exclude = formatExclude(values);
    expect(exclude.length).toBeLessThanOrEqual(MAX_AUTO_TAG_EXCLUDE);
    expect(
      AutoTagConfigSchema.safeParse({
        ...defaultAutoTagConfig(),
        rules: [rule({ exclude })],
      }).success,
    ).toBe(true);
    const compiled = compileRule(rule({ exclude }));
    expect(compiled?.exclude.size).toBe(2000);
    expect(compiled?.exclude.has("code1999")).toBe(true);
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
    const square = activeRules()[1];
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
    const square = activeRules()[1];
    expect(hitsOf(square, "[a​b‮] x.mp4")[0].tags).toEqual(["ab"]);
    expect(hitsOf(square, "[res:4k] x.mp4")[0].tags).toEqual([]);
  });
});

describe("keywords", () => {
  const hits = (k: KeywordEntry, name: string) =>
    runKeyword(compileKeyword(k), name).map((h) => h.text);

  it("finds any of the terms, whatever the case", () => {
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
    const movie = keyword({ terms: ["Movie", "mov"], tags: ["Movie"] });
    expect(hits(movie, "holiday.mov")).toEqual([]);
    expect(hits(movie, "mov night.mp4")).toEqual(["mov"]);
    expect(
      hits(
        keyword({ terms: ["AV"], tags: ["AV"], mode: "contains" }),
        "clip.avi",
      ),
    ).toEqual([]);
  });

  it("matches a decomposed (macOS) name against a keyword typed normally", () => {
    const engine = engineOf(
      [],
      [keyword({ terms: ["ガール"], tags: ["ガール"] })],
    );
    expect(tagsForName(engine, `${"ガール".normalize("NFD")} 01.mp4`)).toEqual([
      "ガール",
    ]);
  });
});

describe("proposals", () => {
  it("lists rules first, then the dictionary, one spelling per tag", () => {
    const engine = engineOf(activeRules(), [
      keyword({ id: "trip", terms: ["trip"], tags: ["trip"] }),
      keyword(),
    ]);
    expect(proposalsFor(engine, "[Trip] yoga camp.mp4")).toEqual([
      { tag: "Trip", key: "trip", source: { kind: "rule", ruleId: "square" } },
      { tag: "Yoga", key: "yoga", source: { kind: "keyword", keywordId: "k" } },
    ]);
  });

  it("gives every tag of a keyword entry, and nothing for one with none", () => {
    const code = keyword({
      id: "code",
      terms: ["ABCD-123"],
      tags: ["ABCD", "Series"],
      mode: "contains",
    });
    expect(tagsForName(engineOf([], [code]), "ABCD-123 intro.mp4")).toEqual([
      "ABCD",
      "Series",
    ]);
    const bare = keyword({ tags: [] });
    expect(tagsForName(engineOf([], [bare]), NAMES[0])).toEqual([]);
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

  it("suggests the frequent words the engine misses, and nothing it gives", () => {
    const cands = suggestCandidates(
      engineOf(activeRules(), [keyword()]),
      NAMES,
      {
        minFreq: 2,
        stop,
      },
    );
    const by = new Map(cands.map((c) => [c.key, c]));
    // "Harbor" is in three names and nothing claims it.
    expect(by.get("harbor")).toMatchObject({ name: "Harbor", count: 3 });
    // What a rule or a keyword produces is theirs, not a suggestion.
    expect(by.has("abcd")).toBe(false);
    expect(by.has("trip")).toBe(false);
    expect(by.has("yoga")).toBe(false);
    // Once, or a stop word, or already a tag: not offered either.
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

  it("hides a word only in the names a rule gives it to as a tag", () => {
    // The bracket rule tags the first file "Trip"; the other two hold the word
    // plain, and nothing gives it to them.
    const names = ["[Trip] Kyoto.mp4", "Trip to Nara.mp4", "Trip day.mp4"];
    const found = suggestCandidates(engineOf(activeRules()), names, {
      minFreq: 2,
      stop: new Set(),
    });
    const trip = found.find((c) => c.key === "trip");
    expect(trip).toMatchObject({ name: "Trip", count: 2 });
    expect([...(trip?.files.keys() ?? [])]).toEqual([1, 2]);
  });

  it("does not let a folder rule's tag hide the word in other files' names", () => {
    const engine = compileEngine({
      rules: [],
      keywords: [],
      folders: [
        {
          id: "f1",
          workspaceId: "ws",
          folder: "Trips",
          tags: ["Harbor"],
          enabled: true,
        },
      ],
    });
    // The folder rule says nothing about the names: the word is still a
    // suggestion for the files whose names hold it.
    const names = ["a.mp4", "harbor walk.mp4", "harbor pier.mp4"];
    const found = suggestCandidates(engine, names, {
      minFreq: 2,
      stop: new Set(),
    });
    expect([
      ...(found.find((c) => c.key === "harbor")?.files.keys() ?? []),
    ]).toEqual([1, 2]);
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
    // There to look at, none of them running until switched on.
    expect(config.rules.some((r) => r.enabled)).toBe(false);
    expect(AutoTagConfigSchema.safeParse(config).success).toBe(true);
  });

  it("puts the built-in rules back as they ship, ahead of the rules added", () => {
    const [prefix, , sumi] = activeRules();
    const mine = rule({ id: "mine", name: "Mine", pattern: "^(Y+)" });
    const reset = resetBuiltinRules([
      mine,
      // Edited, switched on, out of order; two others deleted.
      { ...sumi, pattern: "x", exclude: "" },
      { ...prefix, template: "$0" },
    ]);
    expect(reset).toEqual([...defaultRules(), mine]);
    // Nothing to restore from: the defaults alone.
    expect(resetBuiltinRules([])).toEqual(defaultRules());

    // "As shipped" is whatever a reset would leave alone.
    expect(builtinRulesAsShipped(reset)).toBe(true);
    expect(builtinRulesAsShipped(defaultRules())).toBe(true);
    expect(builtinRulesAsShipped(activeRules())).toBe(false);
    expect(builtinRulesAsShipped(defaultRules().slice(1))).toBe(false);
    expect(builtinRulesAsShipped([mine, ...defaultRules()])).toBe(false);
  });

  it("keeps every rule the user added when a reset has no room for all the built-in ones", () => {
    const own = Array.from({ length: MAX_AUTO_TAG_RULES - 2 }, (_, i) =>
      rule({ id: `mine-${i}`, pattern: `^(${i})` }),
    );
    const reset = resetBuiltinRules(own);
    expect(reset).toHaveLength(MAX_AUTO_TAG_RULES);
    expect(reset.slice(2)).toEqual(own);
    expect(reset.slice(0, 2).map((r) => r.id)).toEqual(["prefix", "square"]);
    // Which is as far as a reset can go: nothing more to offer.
    expect(builtinRulesAsShipped(reset)).toBe(true);
  });

  it("stores folder rules, and refuses a folder path that is not a folder's", () => {
    const rule = {
      id: "f1",
      workspaceId: "ws",
      folder: "Trips/2024",
      tags: ["Trip"],
      enabled: true,
    };
    const config = { ...defaultAutoTagConfig(), folders: [rule] };
    expect(AutoTagConfigSchema.safeParse(config).success).toBe(true);
    for (const folder of ["../etc", "a//b", "/abs", "a/"]) {
      expect(
        AutoTagConfigSchema.safeParse({
          ...config,
          folders: [{ ...rule, folder }],
        }).success,
      ).toBe(false);
    }
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
    const engine = { rules: activeRules(), keywords: [keyword()] };

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

  it("tags the files under a folder of this workspace, subfolders included", async () => {
    const at = (relPath: string) => insertFile(db, rootId, { relPath });
    const inFolder = at("Trips/2024/harbor.mp4");
    // Written with the other separator, as Windows stores it.
    const deeper = at("Trips\\2024\\day1\\walk.mp4");
    const sibling = at("Trips/2024b/pier.mp4");
    const elsewhere = at("Work/plan.mp4");
    const folders: FolderRule[] = [
      {
        id: "f1",
        workspaceId: "ws",
        folder: "Trips/2024",
        tags: ["Trip", "2024"],
        enabled: true,
      },
      // The same path in another workspace is another folder.
      {
        id: "f2",
        workspaceId: "other",
        folder: "",
        tags: ["Other"],
        enabled: true,
      },
      {
        id: "f3",
        workspaceId: "ws",
        folder: "Work",
        tags: ["Job"],
        enabled: false,
      },
    ];
    const engine = { rules: [], keywords: [], folders };

    // Without being told which workspace this is, no folder rule applies.
    expect((await applyAutoTags(db, { engine })).added).toBe(0);

    const result = await applyAutoTags(db, { engine, workspaceId: "ws" });
    expect(result).toEqual({ files: 2, added: 4, completed: true });
    expect(names(inFolder)).toEqual(["2024", "Trip"]);
    expect(names(deeper)).toEqual(["2024", "Trip"]);
    // A folder whose name merely starts the same is not under it.
    expect(names(sibling)).toEqual([]);
    expect(names(elsewhere)).toEqual([]);
  });

  it("adds a folder's tags after what the name gave, without repeats", () => {
    const engine = compileEngine({
      rules: activeRules(),
      keywords: [],
      folders: [
        {
          id: "f1",
          workspaceId: "ws",
          folder: "",
          tags: ["abcd", " Clips ", "res:hd", "clips"],
          enabled: true,
        },
      ],
    });
    const reaching = folderMatcher(engine.folders);
    const place = { workspaceId: "ws", folder: "a/b" };
    const tagsAt = (name: string, where = place) =>
      withFolderTags(tagsForName(engine, name), reaching(where));
    // "abcd" is the rule's ABCD already; a reserved name is no tag.
    expect(tagsAt(NAMES[0])).toEqual(["ABCD", "Clips"]);
    expect(tagsAt("plain.mp4")).toEqual(["abcd", "Clips"]);
    // The same path in another workspace is not this folder.
    expect(
      tagsAt("plain.mp4", { workspaceId: "other", folder: "a/b" }),
    ).toEqual([]);
    // A name alone does not say where its file is.
    expect(tagsForName(engine, "plain.mp4")).toEqual([]);
    expect(isUnderFolder("a/b", "a")).toBe(true);
    expect(isUnderFolder("ab", "a")).toBe(false);
    expect(folderOf("a\\b\\c.mp4")).toBe("a/b");
    expect(folderOf("c.mp4")).toBe("");
  });

  it("matches a folder written decomposed, and a rule for the whole workspace", async () => {
    // macOS hands names over decomposed (NFD); the rule was written from the
    // screen, which shows them composed (NFC).
    const nfd = "Cafe\u0301";
    const inFolder = insertFile(db, rootId, { relPath: `${nfd}/menu.mp4` });
    const atRoot = insertFile(db, rootId, { relPath: "top.mp4" });
    const folders: FolderRule[] = [
      {
        id: "f1",
        workspaceId: "ws",
        folder: "Caf\u00e9",
        tags: ["Cafe"],
        enabled: true,
      },
      { id: "f2", workspaceId: "ws", folder: "", tags: ["All"], enabled: true },
    ];
    await applyAutoTags(db, {
      engine: { rules: [], keywords: [], folders },
      workspaceId: "ws",
    });
    expect(names(inFolder)).toEqual(["All", "Cafe"]);
    expect(names(atRoot)).toEqual(["All"]);
  });

  it("keeps owing the files of a scan that was cut short", async () => {
    const id = insertFile(db, rootId, { relPath: NAMES[0] });
    const engine = { rules: activeRules(), keywords: [] };
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
          folder: "dir",
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

  const engine = { rules: activeRules(), keywords: [] };
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
