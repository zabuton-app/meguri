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
    // `meta:long` carries no namespace; the vocabulary supplies it.
    expect(searchTokenLabel(t, "meta:long")).toBe("Length: Long");
    expect(searchTokenLabel(t, "meta:4k")).toBe("Resolution: 4k");
  });

  it("accepts the qualified form too", () => {
    expect(searchTokenLabel(t, "meta:dur:long")).toBe("Length: Long");
  });

  it("reads an open-set value as itself", () => {
    // Codecs belong to no closed vocabulary, so there is no category to show.
    expect(searchTokenLabel(t, "meta:hevc")).toBe("hevc");
  });

  it("marks a user tag as one", () => {
    expect(searchTokenLabel(t, "tag:beach")).toBe("Tags: beach");
  });

  it("returns null for free text", () => {
    expect(searchTokenLabel(t, "beach")).toBeNull();
  });
});
