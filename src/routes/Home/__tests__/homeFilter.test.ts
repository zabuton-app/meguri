import { describe, expect, it } from "vitest";
import { addSearchTokens } from "@/routes/Home/utils";

describe("addSearchTokens", () => {
  it("puts the token into the query when there is none", () => {
    expect(addSearchTokens({}, ["tag:beach"])).toEqual({ q: "tag:beach" });
  });

  it("AND-appends to existing text without dropping other conditions", () => {
    const before = { q: "sunset", kind: "video" as const };
    expect(addSearchTokens(before, ["tag:4k"])).toEqual({
      q: "sunset tag:4k",
      kind: "video",
    });
  });

  it("returns the same reference when every token is already present", () => {
    // Reference stability keeps the files_search query key identical, so the
    // cached page and the scroll position survive a redundant click.
    const before = { q: "tag:beach" };
    expect(addSearchTokens(before, ["tag:beach"])).toBe(before);
  });

  it("adds only the tokens that are missing", () => {
    expect(
      addSearchTokens({ q: "tag:beach" }, ["tag:beach", "tag:4k"]),
    ).toEqual({ q: "tag:beach tag:4k" });
  });

  it("keeps a quoted multi-word tag as one token", () => {
    const after = addSearchTokens({ q: 'tag:"beach house"' }, ["tag:4k"]);
    expect(after.q).toBe('tag:"beach house" tag:4k');
    // And a second click on the same tag is still a no-op.
    expect(addSearchTokens(after, ['tag:"beach house"'])).toBe(after);
  });

  it("recognises a condition the box holds in another case", () => {
    // The tag resolves case-insensitively in SQL, so `tag:4K` and a click on
    // "4k" are one condition — the search box folds a typed repeat the same way.
    const before = { q: "tag:4K" };
    expect(addSearchTokens(before, ["tag:4k"])).toBe(before);
  });

  it("keeps two tags that differ beyond ASCII apart", () => {
    // SQLite's NOCASE collation only folds ASCII, so these really are two tags.
    const after = addSearchTokens({ q: "tag:été" }, ["tag:ÉTÉ"]);
    expect(after.q).toBe("tag:été tag:ÉTÉ");
  });

  it("still compares free text exactly", () => {
    expect(addSearchTokens({ q: "sunset" }, ["Sunset"]).q).toBe(
      "sunset Sunset",
    );
  });

  it("ignores empty tokens", () => {
    const before = { q: "tag:beach" };
    expect(addSearchTokens(before, [""])).toBe(before);
  });
});
