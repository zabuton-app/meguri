import { describe, expect, it } from "vitest";
import {
  isEditableTag,
  isReservedTagName,
  hasOpenQuote,
  joinSearchTokens,
  parseMetaSearchToken,
  parseQualifiedTagName,
  parseTagSearchToken,
  reservedTagPrefix,
  qualifiedTagName,
  splitSearchTokens,
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
  it("uses tag: for the user's own tags", () => {
    expect(tagSearchToken("", "beach")).toBe("tag:beach");
  });

  it("uses meta: with the bare value for generated tags", () => {
    // The categories share no values, so `meta:4k` is unambiguous — and much
    // easier to read and type than `meta:res:4k`.
    expect(tagSearchToken("res", "4k")).toBe("meta:4k");
    expect(tagSearchToken("dur", "long")).toBe("meta:long");
  });

  it("quotes a value with whitespace, doubling an inner quote", () => {
    expect(tagSearchToken("", "beach house")).toBe('tag:"beach house"');
    expect(tagSearchToken("", 'a "b" c')).toBe('tag:"a ""b"" c"');
  });

  it("round-trips through the tokenizer", () => {
    for (const name of ["beach", "beach house", 'a "b" c']) {
      const token = tagSearchToken("", name);
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
    expect(splitSearchTokens('meta: 4k tag: "sea side"')).toEqual([
      "meta:4k",
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
    expect(joinSearchTokens(["beach", "tag:sea side", "meta:4k"])).toBe(
      'beach tag:"sea side" meta:4k',
    );
  });
});

describe("reservedTagPrefix", () => {
  it("names the prefix a manual tag would impersonate", () => {
    expect(reservedTagPrefix("res:8k")).toBe("res");
    // Including the search directives, which parseQualifiedTagName does not
    // split — it only knows the auto-meta namespaces.
    expect(reservedTagPrefix("meta:foo")).toBe("meta");
    expect(reservedTagPrefix("TAG:foo")).toBe("tag");
  });

  it("is null for a name that claims nothing", () => {
    expect(reservedTagPrefix("todo:later")).toBeNull();
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
    expect(hasOpenQuote("beach meta:4k ")).toBe(false);
  });
});

describe("parseMetaSearchToken", () => {
  it("extracts the value after the prefix", () => {
    expect(parseMetaSearchToken("meta:4k")).toBe("4k");
    expect(parseMetaSearchToken("meta:res:4k")).toBe("res:4k");
  });

  it("is case-insensitive on the prefix", () => {
    expect(parseMetaSearchToken("META:long")).toBe("long");
  });

  it("returns null for ordinary text and for a bare prefix", () => {
    expect(parseMetaSearchToken("beach")).toBeNull();
    expect(parseMetaSearchToken("metadata")).toBeNull();
    expect(parseMetaSearchToken("meta:")).toBeNull();
    expect(parseMetaSearchToken("todo:later")).toBeNull();
  });
});

describe("isReservedTagName", () => {
  it("rejects a name impersonating an auto-meta namespace", () => {
    expect(isReservedTagName("res:4k")).toBe(true);
    expect(isReservedTagName("codec:av1")).toBe(true);
  });

  it("rejects the search directive prefix, in any case", () => {
    // Otherwise a manual tag named `meta:foo` would be shadowed by the directive.
    expect(isReservedTagName("meta:foo")).toBe(true);
    expect(isReservedTagName("META:foo")).toBe(true);
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
