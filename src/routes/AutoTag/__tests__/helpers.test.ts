import { describe, expect, it } from "vitest";
import {
  folderFileIndexes,
  keywordMatches,
  renameTag,
} from "@/routes/AutoTag/helpers";
import {
  compileKeyword,
  runKeyword,
  type AutoTagFile,
  type KeywordEntry,
} from "@shared/autoTag";

describe("renameTag", () => {
  const none = new Map<string, string>();

  it("renames in place, cleaning what was typed", () => {
    expect(renameTag(["Trip", "Harbor"], "Trip", "  Journey ", none)).toEqual({
      tags: ["Journey", "Harbor"],
      to: "Journey",
    });
  });

  it("takes the spelling the library already uses", () => {
    const existing = new Map([["journey", "JOURNEY"]]);
    expect(renameTag(["Trip"], "Trip", "journey", existing)).toEqual({
      tags: ["JOURNEY"],
      to: "JOURNEY",
    });
  });

  it("folds into a name the list holds already, in the list's spelling", () => {
    expect(renameTag(["Trip", "Port"], "Trip", "port", none)).toEqual({
      tags: ["Port"],
      to: "Port",
    });
  });

  it("changes nothing for the same name, an unusable one, or a tag not there", () => {
    expect(renameTag(["Trip"], "Trip", "Trip", none)).toBeNull();
    expect(renameTag(["Trip"], "Trip", "   ", none)).toBeNull();
    expect(renameTag(["Trip"], "Harbor", "Port", none)).toBeNull();
    // Another spelling of the library's tag is that tag: nothing to rename.
    expect(
      renameTag(["Trip"], "Trip", "TRIP", new Map([["trip", "Trip"]])),
    ).toBeNull();
  });
});

describe("folderFileIndexes", () => {
  const file = (workspaceId: string, folder: string): AutoTagFile => ({
    workspaceId,
    id: 1,
    name: "a.mp4",
    folder,
    metaKey: "k",
    tags: [],
  });

  it("is the files of the workspace under the folder, subfolders included", () => {
    const files = [
      file("ws", "Trips"),
      file("ws", "Trips/2024"),
      file("ws", "Trips2"),
      file("other", "Trips"),
      file("ws", ""),
    ];
    expect(
      folderFileIndexes(files, { workspaceId: "ws", folder: "Trips" }),
    ).toEqual([0, 1]);
    // The root is the whole workspace.
    expect(folderFileIndexes(files, { workspaceId: "ws", folder: "" })).toEqual(
      [0, 1, 2, 4],
    );
  });
});

describe("keywordMatches", () => {
  const entry = (terms: string[]): KeywordEntry => ({
    id: "k",
    terms,
    tags: ["T"],
    mode: "contains",
  });

  it("finds every name the keyword's expression matches, whatever the case", () => {
    // The final sigma lowers to itself but uppers to Σ, as σ does; ß uppers
    // to two letters; the dotted İ lowers to two characters.
    const cases: [string, string][] = [
      ["Σ", "ς.mp4"],
      ["σ", "ΟΔΟΣ.mp4"],
      ["ς", "σ.mp4"],
      ["straße", "STRASSE straße.mp4"],
      ["i", "İstanbul.mp4"],
      ["Yoga", "yoga.mp4"],
      // Half of a pair, as only a broken setting could hold.
      ["\uDC28", "\uD801\uDC28.mp4"],
    ];
    for (const [term, name] of cases) {
      const expression = runKeyword(compileKeyword(entry([term])), name);
      const found = keywordMatches(entry([term]), [name]);
      // Whatever the expression matches, the list shows.
      expect(found.length > 0).toBe(expression.length > 0);
    }
    expect(keywordMatches(entry(["Σ"]), ["ς.mp4"])).toHaveLength(1);
    // Whole words too, where the lookarounds only narrow the expression.
    expect(
      keywordMatches({ ...entry(["Yoga"]), mode: "word" }, ["YOGA class.mp4"]),
    ).toHaveLength(1);
  });
});
