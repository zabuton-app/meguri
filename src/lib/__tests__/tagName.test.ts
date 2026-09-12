import { describe, expect, it } from "vitest";
import {
  isEditableTag,
  isReservedTagName,
  hasOpenQuote,
  joinSearchTokens,
  parseQualifiedTagName,
  parseTagSearchToken,
  reservedTagPrefix,
  qualifiedTagName,
  splitSearchTokens,
  tagSearchKey,
  tagSearchToken,
} from "@shared/tags";

describe("qualifiedTagName", () => {
  it("returns the bare name for a manual tag", () => {
    expect(qualifiedTagName("", "beach")).toBe("beach");
  });

  it("joins namespace and name with a colon", () => {
    expect(qualifiedTagName("res", "4k")).toBe("res:4k");
  });
});

describe("parseQualifiedTagName", () => {
  it("splits a known auto-meta prefix", () => {
    expect(parseQualifiedTagName("res:4k")).toEqual({
      namespace: "res",
      name: "4k",
    });
    expect(parseQualifiedTagName("orient:vertical")).toEqual({
      namespace: "orient",
      name: "vertical",
    });
  });

  it("leaves an unknown prefix alone so manual tags with colons survive", () => {
    expect(parseQualifiedTagName("todo:later")).toEqual({
      namespace: "",
      name: "todo:later",
    });
  });

  it("treats a bare name as having no namespace", () => {
    expect(parseQualifiedTagName("beach")).toEqual({
      namespace: "",
      name: "beach",
    });
  });

  it("does not split on a leading or trailing colon", () => {
    expect(parseQualifiedTagName(":4k")).toEqual({
      namespace: "",
      name: ":4k",
    });
    expect(parseQualifiedTagName("res:")).toEqual({
      namespace: "",
      name: "res:",
    });
  });

  it("round-trips every qualified form it produces", () => {
    for (const [ns, name] of [
      ["", "beach"],
      ["res", "4k"],
      ["dur", "long"],
      ["codec", "hevc"],
    ] as const) {
      expect(parseQualifiedTagName(qualifiedTagName(ns, name))).toEqual({
        namespace: ns,
        name,
      });
    }
  });
});

describe("isEditableTag", () => {
  it("is true only for the empty namespace", () => {
    expect(isEditableTag("")).toBe(true);
    expect(isEditableTag("res")).toBe(false);
    expect(isEditableTag("dur")).toBe(false);
  });
});

describe("tagSearchToken", () => {
  it("uses one prefix for every tag, generated ones included", () => {
    // The categories share no values, so the bare `tag:4k` is unambiguous — and
    // much easier to read and type than a second prefix plus a namespace.
    expect(tagSearchToken("beach")).toBe("tag:beach");
    expect(tagSearchToken("4k")).toBe("tag:4k");
    expect(tagSearchToken("long")).toBe("tag:long");
  });

  it("quotes a value with whitespace, doubling an inner quote", () => {
    expect(tagSearchToken("beach house")).toBe('tag:"beach house"');
    expect(tagSearchToken('a "b" c')).toBe('tag:"a ""b"" c"');
  });

  it("round-trips through the tokenizer", () => {
    for (const name of ["beach", "beach house", 'a "b" c']) {
      const token = tagSearchToken(name);
      expect(parseTagSearchToken(splitSearchTokens(token)[0])).toBe(name);
    }
  });
});

describe("splitSearchTokens / joinSearchTokens", () => {
  it("splits on whitespace and keeps quoted phrases together", () => {
    expect(splitSearchTokens('beach tag:"sea side" 2024')).toEqual([
      "beach",
      "tag:sea side",
      "2024",
    ]);
  });

  it("treats a doubled quote inside a quoted run as a literal", () => {
    expect(splitSearchTokens('tag:"a ""b"""')).toEqual(['tag:a "b"']);
  });

  it("folds a directive typed with a space after the colon", () => {
    // `tag: beach` is what a person types; leaving "beach" as free text would
    // quietly hand back the substring match the directive is there to avoid.
    expect(splitSearchTokens("tag: beach")).toEqual(["tag:beach"]);
    expect(splitSearchTokens('tag: 4k tag: "sea side"')).toEqual([
      "tag:4k",
      "tag:sea side",
    ]);
  });

  it("leaves a trailing bare prefix alone", () => {
    // Mid-typing state: there is no value to attach yet.
    expect(splitSearchTokens("sunset tag:")).toEqual(["sunset", "tag:"]);
  });

  it("drops stray quotes rather than searching for them", () => {
    expect(splitSearchTokens('" beach')).toEqual(["beach"]);
    expect(splitSearchTokens('"beach"')).toEqual(["beach"]);
  });

  it("re-quotes only what needs it", () => {
    expect(joinSearchTokens(["beach", "tag:sea side", "tag:4k"])).toBe(
      'beach tag:"sea side" tag:4k',
    );
  });
});

describe("reservedTagPrefix", () => {
  it("names the prefix a manual tag would impersonate", () => {
    expect(reservedTagPrefix("res:8k")).toBe("res");
    // Including the search directive, which parseQualifiedTagName does not
    // split — it only knows the auto-meta namespaces.
    expect(reservedTagPrefix("TAG:foo")).toBe("tag");
  });

  it("is null for a name that claims nothing", () => {
    expect(reservedTagPrefix("todo:later")).toBeNull();
    // `meta` is no longer a directive, so it is no longer reserved either.
    expect(reservedTagPrefix("meta:foo")).toBeNull();
    expect(reservedTagPrefix("beach")).toBeNull();
    expect(reservedTagPrefix("res:")).toBeNull();
  });
});

describe("hasOpenQuote", () => {
  it("reports a phrase the user has not closed yet", () => {
    // The search box needs this to tell a token boundary from a space typed
    // inside a tag name.
    expect(hasOpenQuote('tag:"beach ')).toBe(true);
    expect(hasOpenQuote('tag:"beach house" ')).toBe(false);
  });

  it("counts a doubled quote as a literal, not as a delimiter", () => {
    expect(hasOpenQuote('tag:"a ""b"""')).toBe(false);
    expect(hasOpenQuote('tag:"a ""b"" ')).toBe(true);
  });

  it("is false for a query with no quotes at all", () => {
    expect(hasOpenQuote("beach tag:4k ")).toBe(false);
  });
});

describe("parseTagSearchToken", () => {
  it("extracts the value after the prefix", () => {
    expect(parseTagSearchToken("tag:beach")).toBe("beach");
    expect(parseTagSearchToken("tag:4k")).toBe("4k");
    // The qualified form of a generated tag passes through whole.
    expect(parseTagSearchToken("tag:res:4k")).toBe("res:4k");
  });

  it("is case-insensitive on the prefix", () => {
    expect(parseTagSearchToken("TAG:long")).toBe("long");
  });

  it("returns null for ordinary text and for a bare prefix", () => {
    expect(parseTagSearchToken("beach")).toBeNull();
    expect(parseTagSearchToken("tagline")).toBeNull();
    expect(parseTagSearchToken("tag:")).toBeNull();
    expect(parseTagSearchToken("todo:later")).toBeNull();
  });
});

describe("tagSearchKey", () => {
  it("folds the difference two spellings of one condition can have", () => {
    expect(tagSearchKey("tag:4K")).toBe("4k");
    expect(tagSearchKey("TAG:Beach")).toBe(tagSearchKey("tag:beach"));
    // Quoting is the tokenizer's business, not the key's.
    expect(tagSearchKey(splitSearchTokens('tag:"Beach House"')[0])).toBe(
      "beach house",
    );
  });

  it("leaves non-ASCII case alone, as the SQL that resolves the tag does", () => {
    // SQLite's NOCASE collation folds ASCII only, so these are two tags there;
    // folding them here would drop one of the two conditions without a trace.
    expect(tagSearchKey("tag:ÉTÉ")).not.toBe(tagSearchKey("tag:été"));
  });

  it("returns null for anything that is not a directive", () => {
    expect(tagSearchKey("beach")).toBeNull();
    expect(tagSearchKey("tag:")).toBeNull();
  });
});

describe("isReservedTagName", () => {
  it("rejects a name impersonating an auto-meta namespace", () => {
    expect(isReservedTagName("res:4k")).toBe(true);
    expect(isReservedTagName("codec:av1")).toBe(true);
  });

  it("rejects the search directive prefix, in any case", () => {
    // Otherwise a manual tag named `tag:foo` would be shadowed by the directive.
    expect(isReservedTagName("tag:foo")).toBe(true);
    expect(isReservedTagName("TAG:foo")).toBe(true);
  });

  it("accepts a manual name whose prefix is not reserved", () => {
    expect(isReservedTagName("todo:later")).toBe(false);
    expect(isReservedTagName("beach")).toBe(false);
  });

  it("accepts degenerate colon placements", () => {
    expect(isReservedTagName(":4k")).toBe(false);
    expect(isReservedTagName("res:")).toBe(false);
  });

  it("honours a caller-supplied reserved set", () => {
    expect(isReservedTagName("studio:a24", ["studio"])).toBe(true);
    expect(isReservedTagName("res:4k", ["studio"])).toBe(false);
  });
});
