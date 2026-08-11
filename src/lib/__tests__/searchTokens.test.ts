import { describe, expect, it } from "vitest";
import {
  MAX_TAG_SUGGESTIONS,
  pendingDirective,
  tagSuggestions,
} from "@/lib/searchTokens";
import type { TagSummary } from "@/ipc/types";

function tag(name: string, fileCount = 1, namespace = ""): TagSummary {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws"],
  };
}

describe("pendingDirective", () => {
  it("reports the directive the caret is inside", () => {
    expect(pendingDirective("tag:be")).toEqual({ prefix: "tag", value: "be" });
    expect(pendingDirective("sunset meta:4")).toEqual({
      prefix: "meta",
      value: "4",
    });
  });

  it("reports an empty value right after the colon", () => {
    // Enough to offer the whole vocabulary before a letter is typed.
    expect(pendingDirective("tag:")).toEqual({ prefix: "tag", value: "" });
  });

  it("is null once the token is closed", () => {
    // A closed token has already become a chip; there is nothing to complete.
    expect(pendingDirective("tag:beach ")).toBeNull();
  });

  it("stays open inside an unterminated phrase", () => {
    // Still completable: the quote means the user is mid-phrase, not done.
    expect(pendingDirective('tag:"beach ')).toEqual({
      prefix: "tag",
      value: "beach",
    });
  });

  it("is null for ordinary text", () => {
    expect(pendingDirective("beach")).toBeNull();
    expect(pendingDirective("")).toBeNull();
    expect(pendingDirective("todo:later")).toBeNull();
  });
});

describe("tagSuggestions", () => {
  it("caps the list so it stays scannable", () => {
    const many = Array.from({ length: 30 }, (_, i) => tag(`t${i}`, i));
    const out = tagSuggestions(many, { prefix: "tag", value: "t" });
    expect(out).toHaveLength(MAX_TAG_SUGGESTIONS);
    // The cap keeps the most-used, not the first ones the query happened to return.
    expect(out[0].name).toBe("t29");
  });

  it("matches a generated tag by its qualified name too", () => {
    const out = tagSuggestions([tag("4k", 1, "res")], {
      prefix: "meta",
      value: "res:4",
    });
    expect(out.map((t) => t.qualified)).toEqual(["res:4k"]);
  });

  it("honours an explicit limit", () => {
    const out = tagSuggestions(
      [tag("a"), tag("b")],
      {
        prefix: "tag",
        value: "",
      },
      1,
    );
    expect(out).toHaveLength(1);
  });
});
