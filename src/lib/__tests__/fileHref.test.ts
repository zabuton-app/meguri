import { describe, expect, it } from "vitest";
import { fileHref } from "@/lib/fileHref";

describe("fileHref", () => {
  it("always carries the owning workspace", () => {
    expect(fileHref(1, "ws1")).toBe("/file/1?ws=ws1");
  });

  it("adds the autoplay opt-out only when asked for", () => {
    expect(fileHref(1, "ws1", { autoplay: true })).toBe("/file/1?ws=ws1");
    expect(fileHref(1, "ws1", { autoplay: false })).toBe(
      "/file/1?ws=ws1&autoplay=0",
    );
  });

  it("composes Discovery's origin, seek position and filter", () => {
    // What Discovery's slides and scene rail hand to the detail view, so its
    // close lands back on the same queue.
    expect(
      fileHref(1, "ws1", {
        from: "discover",
        filter: '{"kind":"video"}',
        t: 42,
      }),
    ).toBe(
      `/file/1?ws=ws1&t=42&from=discover&filter=${encodeURIComponent('{"kind":"video"}')}`,
    );
    // An empty filter (no query) is omitted rather than sent as `filter=`.
    expect(fileHref(1, "ws1", { from: "discover", filter: undefined })).toBe(
      "/file/1?ws=ws1&from=discover",
    );
  });
});
