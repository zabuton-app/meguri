import { describe, expect, it } from "vitest";
import {
  searchTokenLabel,
  tagHumanLabel,
  tagNamespaceLabel,
  tagValueLabel,
} from "@/lib/tagLabel";
import { en } from "@/i18n/locales/en";
import type { TFunc } from "@/i18n/I18nProvider";
import { pickMessage, type Message } from "@/i18n/message";

// The label helpers only need a lookup, not the whole provider.
const t = ((key: string) =>
  (en as Record<string, string>)[key] ?? key) as unknown as TFunc;

// For the labels that take params: picks the plural by `count`, then fills
// each `{param}` in.
const rules = new Intl.PluralRules("en");
const tp = ((key: string, params: Record<string, string | number> = {}) =>
  pickMessage(
    (en as Record<string, Message>)[key] ?? key,
    rules,
    params.count,
  ).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name]),
  )) as unknown as TFunc;

describe("tagNamespaceLabel", () => {
  it("translates a known namespace", () => {
    expect(tagNamespaceLabel(t, "res")).toBe("Resolution");
    expect(tagNamespaceLabel(t, "dur")).toBe("Length");
  });

  it("falls back to the raw namespace for an unknown one", () => {
    // An open namespace set is expected: a future tag source defines its own.
    expect(tagNamespaceLabel(t, "studio")).toBe("studio");
  });
});

describe("tagValueLabel", () => {
  it("translates values from a closed set", () => {
    expect(tagValueLabel(t, "dur", "long")).toBe("Long");
    expect(tagValueLabel(t, "orient", "vertical")).toBe("Portrait");
  });

  it("falls back to the raw value for open sets", () => {
    expect(tagValueLabel(t, "codec", "av1")).toBe("av1");
    expect(tagValueLabel(t, "res", "4k")).toBe("4k");
  });
});

describe("tagHumanLabel", () => {
  it("passes a manual tag through untouched", () => {
    expect(tagHumanLabel(t, "", "beach")).toBe("beach");
  });

  it("combines the namespace and value labels", () => {
    expect(tagHumanLabel(t, "dur", "long")).toBe("Length: Long");
  });

  it("degrades to raw text when neither tier knows the tag", () => {
    expect(tagHumanLabel(t, "studio", "a24")).toBe("studio: a24");
  });
});

describe("searchTokenLabel", () => {
  it("recovers the category from a bare generated value", () => {
    // `tag:long` carries no namespace; the vocabulary supplies it.
    expect(searchTokenLabel(t, "tag:long")).toBe("Length: Long");
    expect(searchTokenLabel(t, "tag:4k")).toBe("Resolution: 4k");
  });

  it("accepts the qualified form too", () => {
    expect(searchTokenLabel(t, "tag:dur:long")).toBe("Length: Long");
  });

  it("reads an open-set value as itself", () => {
    // Codecs belong to no closed vocabulary, so there is no category to show.
    expect(searchTokenLabel(t, "tag:hevc")).toBe("Tags: hevc");
  });

  it("marks a user tag as one", () => {
    expect(searchTokenLabel(t, "tag:beach")).toBe("Tags: beach");
  });

  it("names an ext: directive by its folded extension (#538)", () => {
    expect(searchTokenLabel(t, "ext:.MP4")).toBe("Extension: mp4");
  });

  it("words a rating: directive's comparison (#732)", () => {
    expect(searchTokenLabel(tp, "rating:>=4")).toBe("4 stars and up");
    expect(searchTokenLabel(tp, "rating:>4")).toBe("More than 4 stars");
    expect(searchTokenLabel(tp, "rating:<=2")).toBe("2 stars and below");
    expect(searchTokenLabel(tp, "rating:<2")).toBe("Fewer than 2 stars");
    expect(searchTokenLabel(tp, "rating:3")).toBe("3 stars");
    expect(searchTokenLabel(tp, "rating:0")).toBe("No rating");
    expect(searchTokenLabel(tp, "rating:>=1")).toBe("1 star and up");
    expect(searchTokenLabel(tp, "rating:1")).toBe("1 star");
  });

  it("names an is:fav directive as favorites (#525)", () => {
    expect(searchTokenLabel(t, "is:fav")).toBe("Favorites (is:fav)");
  });

  it("words a numeric directive's comparison, with the value as typed (#524, #733)", () => {
    expect(searchTokenLabel(tp, "SIZE:>1GB")).toBe("Size over 1gb");
    expect(searchTokenLabel(tp, "duration:<1:30")).toBe("Duration under 1:30");
    expect(searchTokenLabel(tp, "width:>=3840")).toBe("Width 3840 or more");
    expect(searchTokenLabel(tp, "size:<=10mb")).toBe("Size 10mb or less");
    expect(searchTokenLabel(tp, "height:1080")).toBe("Height 1080");
    expect(searchTokenLabel(tp, "size:big")).toBeNull();
  });

  it("names a negated directive as an exclusion (#523)", () => {
    expect(searchTokenLabel(t, "-ext:GIF")).toBe("Exclude: Extension: gif");
    expect(searchTokenLabel(t, "-draft")).toBeNull();
  });

  it("returns null for free text", () => {
    expect(searchTokenLabel(t, "beach")).toBeNull();
  });
});
