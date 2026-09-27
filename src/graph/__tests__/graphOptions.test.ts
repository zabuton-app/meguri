import { describe, expect, it } from "vitest";
import { defaultGraphOptions, parseGraphOptions } from "../graphOptions";

describe("parseGraphOptions", () => {
  it("falls back to the defaults for nothing or garbage", () => {
    expect(parseGraphOptions(null)).toEqual(defaultGraphOptions());
    expect(parseGraphOptions("{")).toEqual(defaultGraphOptions());
    expect(parseGraphOptions("42")).toEqual(defaultGraphOptions());
  });

  it("keeps valid fields and drops unknown or mistyped ones", () => {
    const got = parseGraphOptions(
      JSON.stringify({
        showAutoTags: true,
        showOrphans: "yes",
        edgeSources: { tag: false, bogus: true },
      }),
    );
    expect(got).toEqual({
      showAutoTags: true,
      showOrphans: false,
      edgeSources: { tag: false },
    });
  });
});
