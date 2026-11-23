import { describe, expect, it } from "vitest";
import {
  searchTokenLabel,
  tagHumanLabel,
  tagNamespaceLabel,
  tagValueLabel,
} from "@/lib/tagLabel";
import { en } from "@/i18n/locales/en";
import type { TFunc } from "@/i18n/I18nProvider";

// The label helpers only need a lookup, not the whole provider.
const t = ((key: string) =>
  (en as Record<string, string>)[key] ?? key) as unknown as TFunc;

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

  it("names a rating: directive by its comparison (#525)", () => {
    expect(searchTokenLabel(t, "rating:>=4")).toBe("Rating: >=4");
    expect(searchTokenLabel(t, "rating:3")).toBe("Rating: 3");
  });

  it("names an is:fav directive as favorites (#525)", () => {
    expect(searchTokenLabel(t, "is:fav")).toBe("♥ Favorites");
  });

  it("names a numeric directive by its field and comparison (#524)", () => {
    expect(searchTokenLabel(t, "SIZE:>1GB")).toBe("Size: >1gb");
    expect(searchTokenLabel(t, "duration:<1:30")).toBe("Duration: <1:30");
    expect(searchTokenLabel(t, "width:>=3840")).toBe("Width: >=3840");
    expect(searchTokenLabel(t, "height:1080")).toBe("Height: 1080");
    expect(searchTokenLabel(t, "size:big")).toBeNull();
  });

  it("names a negated directive as an exclusion (#523)", () => {
    expect(searchTokenLabel(t, "-ext:GIF")).toBe("Exclude: Extension: gif");
    expect(searchTokenLabel(t, "-draft")).toBeNull();
  });

  it("returns null for free text", () => {
    expect(searchTokenLabel(t, "beach")).toBeNull();
  });
});
