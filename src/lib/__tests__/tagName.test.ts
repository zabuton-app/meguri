import { describe, expect, it } from "vitest";
import {
  hashSearchToken,
  isEditableTag,
  isReservedTagName,
  isSearchDirective,
  parseHashSearchToken,
  parseNumericSearchToken,
  parseNegatedSearchToken,
  searchDirectiveKey,
  hasOpenQuote,
  joinSearchTokens,
  parseQualifiedTagName,
  parseTagSearchToken,
  reservedTagPrefix,
  qualifiedTagName,
  splitSearchTokens,
  tagIdentityKey,
  tagSearchKey,
  tagSearchToken,
  tidyTagName,
} from "@shared/tags";

describe("tidyTagName", () => {
  // The rule written out the long way: the shortcuts must give exactly this.
  const reference = (raw: string) =>
    raw
      .replace(/\p{Cf}/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\p{Cc}/gu, "")
      .normalize("NFC")
      .replace(/ {2,}/g, " ")
      .trim();

  it("tidies spacing, composition and invisible characters", () => {
    expect(tidyTagName("  New \t Name ")).toBe("New Name");
    expect(tidyTagName("cafe\u0301")).toBe("caf\u00e9");
    expect(tidyTagName("tr\u200bip")).toBe("trip");
    expect(tidyTagName("a \u200b b")).toBe("a b");
    expect(tidyTagName("旅行\u3000タグ")).toBe("旅行 タグ");
    // U+FEFF is whitespace to JS, and a format character all the same.
    expect(tidyTagName("tr\ufeffip")).toBe("trip");
    // Composed once the invisible character between is gone.
    expect(tidyTagName("e\u200b\u0301")).toBe("\u00e9");
    expect(tidyTagName("e\u0000\u0301")).toBe("\u00e9");
  });

  it("is a fixed point: a tidy name tidies to itself", () => {
    for (const raw of ["e\u200b\u0301", "a\ufeff \u0301b", " \u0301\t"]) {
      const once = tidyTagName(raw);
      expect(tidyTagName(once), JSON.stringify(raw)).toBe(once);
    }
  });

  it("gives what the long way gives, tidy names and untidy alike", () => {
    // Deterministic, so a failure can be run again.
    let seed = 1;
    const next = () => (seed = (seed * 48271) % 2147483647);
    const alphabet = [
      "a",
      "Z",
      "~",
      "!",
      " ",
      " ",
      "\t",
      "\n",
      "\u00a0",
      "\u3000",
      "\u2028",
      "\u200b",
      "\u200e",
      "\ufeff",
      "\u0000",
      "\u007f",
      "\u0301",
      "\u3099",
      "e",
      "か",
      "旅",
      "é",
      "\u212b",
      "\ud83d\ude00",
    ];
    for (let i = 0; i < 20_000; i++) {
      const length = next() % 8;
      let raw = "";
      for (let j = 0; j < length; j++) {
        raw += alphabet[next() % alphabet.length];
      }
      expect(tidyTagName(raw), JSON.stringify(raw)).toBe(reference(raw));
    }
  });
});

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

  it("keeps the namespace of a tag whose values are free text", () => {
    // `jazz` can be a manual tag too: the genre alone must not find it.
    expect(tagSearchToken("jazz", "audio_genre")).toBe("tag:audio_genre:jazz");
    expect(tagSearchToken("A minor", "audio_key")).toBe(
      'tag:"audio_key:A minor"',
    );
    expect(tagSearchToken("long", "dur")).toBe("tag:long");
    // Everyday words are no exception: a bare value does not search them.
    expect(tagSearchToken("fast", "audio_tempo")).toBe("tag:audio_tempo:fast");
    expect(tagSearchToken("beach", "")).toBe("tag:beach");
    expect(
      parseTagSearchToken(
        splitSearchTokens(tagSearchToken("A minor", "audio_key"))[0],
      ),
    ).toBe("audio_key:A minor");
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

  it("keeps a negation's - outside the quotes (#523)", () => {
    expect(splitSearchTokens('-tag:"sea side" -"old trip"')).toEqual([
      "-tag:sea side",
      "-old trip",
    ]);
    expect(joinSearchTokens(["-tag:sea side", "-old trip", "-draft"])).toBe(
      '-tag:"sea side" -"old trip" -draft',
    );
    expect(splitSearchTokens("-tag: beach")).toEqual(["-tag:beach"]);
  });

  it("round-trips a quoted leading - as text, not a negation (#523)", () => {
    const tokens = splitSearchTokens('"-intro" " -outro"');
    expect(tokens.map((t) => parseNegatedSearchToken(t))).toEqual([
      { negated: false, body: "-intro" },
      { negated: false, body: "-outro" },
    ]);
    expect(joinSearchTokens(tokens)).toBe('"-intro" "-outro"');
    expect(splitSearchTokens(joinSearchTokens(tokens))).toEqual(tokens);
  });

  it("keeps a quoted leading - in a directive typed with a space (#523)", () => {
    expect(splitSearchTokens('tag: "-intro"')).toEqual(["tag:-intro"]);
    expect(splitSearchTokens('-tag: "-intro"')).toEqual(["-tag:-intro"]);
  });
});

describe("parseNegatedSearchToken", () => {
  it("takes a leading - as a negation of the rest (#523)", () => {
    expect(parseNegatedSearchToken("-tag:beach")).toEqual({
      negated: true,
      body: "tag:beach",
    });
    expect(parseNegatedSearchToken("-draft")).toEqual({
      negated: true,
      body: "draft",
    });
    expect(parseNegatedSearchToken("draft")).toEqual({
      negated: false,
      body: "draft",
    });
  });

  it("leaves a lone - as text", () => {
    expect(splitSearchTokens("beach - ")).toEqual(["beach", "-"]);
    expect(parseNegatedSearchToken("-")).toEqual({
      negated: false,
      body: "-",
    });
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

describe("tagIdentityKey", () => {
  it("is the same for spellings that differ only by case", () => {
    expect(tagIdentityKey("Trip")).toBe(tagIdentityKey("trip"));
    expect(tagIdentityKey("ÉTÉ")).toBe(tagIdentityKey("été"));
    expect(tagIdentityKey("Été TRIP")).toBe(tagIdentityKey("éTÉ trip"));
  });

  it("tells different names apart", () => {
    expect(tagIdentityKey("été")).not.toBe(tagIdentityKey("ete"));
    expect(tagIdentityKey("旅行")).not.toBe(tagIdentityKey("旅"));
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

  it("folds non-ASCII case too, as the SQL that resolves the tag does", () => {
    // Both resolve by tagIdentityKey: one tag there, so one condition here.
    expect(tagSearchKey("tag:ÉTÉ")).toBe(tagSearchKey("tag:été"));
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

describe("parseHashSearchToken", () => {
  it("reads a hex prefix of four characters or more, lower-cased", () => {
    expect(parseHashSearchToken("hash:3FA9")).toBe("3fa9");
    expect(parseHashSearchToken("HASH:3fa9c1d2")).toBe("3fa9c1d2");
    expect(parseHashSearchToken("hash:" + "a".repeat(64))).toBe("a".repeat(64));
  });

  it("leaves short, non-hex and over-long values as free text", () => {
    expect(parseHashSearchToken("hash:3fa")).toBeNull();
    expect(parseHashSearchToken("hash:3fag")).toBeNull();
    expect(parseHashSearchToken("hash:")).toBeNull();
    expect(parseHashSearchToken("hash:" + "a".repeat(65))).toBeNull();
    expect(parseHashSearchToken("3fa9c1d2")).toBeNull();
  });

  it("folds a value typed after a space, as tag: does", () => {
    expect(splitSearchTokens("hash: 3fa9c1d2 trip")).toEqual([
      "hash:3fa9c1d2",
      "trip",
    ]);
  });

  it("round-trips through hashSearchToken", () => {
    expect(parseHashSearchToken(hashSearchToken("3FA9C1D2"))).toBe("3fa9c1d2");
  });
});

describe("parseNumericSearchToken (#524)", () => {
  const read = (token: string) => {
    const num = parseNumericSearchToken(token);
    return num && [num.field, num.op, num.value];
  };

  it("reads each comparison, and none as equality", () => {
    expect(read("width:>3840")).toEqual(["width", ">", 3840]);
    expect(read("width:>=3840")).toEqual(["width", ">=", 3840]);
    expect(read("height:<720")).toEqual(["height", "<", 720]);
    expect(read("height:<=720")).toEqual(["height", "<=", 720]);
    expect(read("HEIGHT:1080")).toEqual(["height", "=", 1080]);
  });

  it("reads size units as binary, in any case, and no unit as bytes", () => {
    expect(read("size:>1gb")).toEqual(["size", ">", 1024 ** 3]);
    expect(read("size:<1.5MB")).toEqual(["size", "<", 1.5 * 1024 ** 2]);
    expect(read("size:>=2kb")).toEqual(["size", ">=", 2048]);
    expect(read("size:500b")).toEqual(["size", "=", 500]);
    expect(read("size:500")).toEqual(["size", "=", 500]);
  });

  it("reads duration units and clock times in seconds", () => {
    expect(read("duration:<30s")).toEqual(["duration", "<", 30]);
    expect(read("duration:>20m")).toEqual(["duration", ">", 1200]);
    expect(read("duration:>=1.5h")).toEqual(["duration", ">=", 5400]);
    expect(read("duration:90")).toEqual(["duration", "=", 90]);
    expect(read("duration:1:30")).toEqual(["duration", "=", 90]);
    expect(read("duration:<90:00")).toEqual(["duration", "<", 5400]);
    expect(read("duration:>1:02:03")).toEqual(["duration", ">", 3723]);
  });

  it("leaves an unparsable value as free text", () => {
    for (const token of [
      "size:",
      "size:>",
      "size:big",
      "size:1tb",
      "size:1constructor",
      "size:-1mb",
      "size:=1mb",
      "size:>>1mb",
      "width:1.5",
      "width:1920px",
      "height:>1080p",
      "duration:1:3",
      "duration:1:60",
      "duration:1:60:00",
      "duration:30d",
      "sizes:>1gb",
      ">1gb",
    ]) {
      expect(parseNumericSearchToken(token)).toBeNull();
    }
  });

  it("folds a value typed after a space, as tag: does", () => {
    expect(splitSearchTokens("size: >1gb trip")).toEqual(["size:>1gb", "trip"]);
    expect(parseNumericSearchToken("size:>1gb")?.text).toBe(">1gb");
  });
});

describe("searchDirectiveKey / isSearchDirective", () => {
  it("keys tag and hash directives apart, and folds each as its kind does", () => {
    expect(searchDirectiveKey("hash:3FA9")).toBe(
      searchDirectiveKey("hash:3fa9"),
    );
    expect(searchDirectiveKey("tag:Beach")).toBe(
      searchDirectiveKey("tag:beach"),
    );
    // A tag named like a hash is a different condition.
    expect(searchDirectiveKey("tag:3fa9")).not.toBe(
      searchDirectiveKey("hash:3fa9"),
    );
    expect(searchDirectiveKey("3fa9")).toBeNull();
  });

  it("keys a numeric directive on the value it compares (#524)", () => {
    expect(searchDirectiveKey("size:>1gb")).toBe(
      searchDirectiveKey("SIZE:>1024mb"),
    );
    expect(searchDirectiveKey("size:>1gb")).not.toBe(
      searchDirectiveKey("size:>=1gb"),
    );
    expect(searchDirectiveKey("width:1920")).not.toBe(
      searchDirectiveKey("height:1920"),
    );
    expect(isSearchDirective("duration:<30s")).toBe(true);
    expect(isSearchDirective("size:big")).toBe(false);
  });

  it("keys a negated directive apart from the same one included (#523)", () => {
    expect(searchDirectiveKey("-tag:Beach")).toBe(
      searchDirectiveKey("-tag:beach"),
    );
    expect(searchDirectiveKey("-tag:beach")).not.toBe(
      searchDirectiveKey("tag:beach"),
    );
    expect(searchDirectiveKey("-ext:GIF")).toBe(searchDirectiveKey("-ext:gif"));
    expect(searchDirectiveKey("-draft")).toBeNull();
  });

  it("calls a negated directive a directive, and negated text text (#523)", () => {
    expect(isSearchDirective("-tag:beach")).toBe(true);
    expect(isSearchDirective("-hash:3fa9")).toBe(true);
    expect(isSearchDirective("-ext:gif")).toBe(true);
    expect(isSearchDirective("-draft")).toBe(false);
    // Quoted, the - is text, so the rest is no directive either.
    expect(isSearchDirective(splitSearchTokens('"-tag:beach"')[0])).toBe(false);
  });

  it("calls both kinds directives, and nothing else", () => {
    expect(isSearchDirective("tag:beach")).toBe(true);
    expect(isSearchDirective("hash:3fa9")).toBe(true);
    expect(isSearchDirective("hash:3f")).toBe(false);
    expect(isSearchDirective("beach")).toBe(false);
  });
});
