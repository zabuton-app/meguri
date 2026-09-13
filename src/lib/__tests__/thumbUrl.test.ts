import { describe, expect, it } from "vitest";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";

describe("hasThumbFile", () => {
  it("needs both a finished extraction and a file behind it", () => {
    expect(hasThumbFile({ thumbStatus: "done", hasThumb: 1 })).toBe(true);
    // Audio without embedded cover art: done, but nothing was written.
    expect(hasThumbFile({ thumbStatus: "done", hasThumb: 0 })).toBe(false);
    expect(hasThumbFile({ thumbStatus: "pending", hasThumb: 1 })).toBe(false);
    expect(hasThumbFile({ thumbStatus: "error", hasThumb: 0 })).toBe(false);
  });
});

describe("thumbUrl", () => {
  it("addresses the thumbnail through the owning workspace", () => {
    expect(thumbUrl("http://127.0.0.1:1", "ws1", 7)).toBe(
      "http://127.0.0.1:1/ws/ws1/thumb/7",
    );
  });

  it("appends the cache buster only when a version is given", () => {
    expect(thumbUrl("http://h", "ws1", 7, 0)).toBe(
      "http://h/ws/ws1/thumb/7?v=0",
    );
    expect(thumbUrl("http://h", "ws1", 7, 3)).toBe(
      "http://h/ws/ws1/thumb/7?v=3",
    );
  });

  it("is null until the media origin and workspace are known", () => {
    expect(thumbUrl("", "ws1", 7)).toBeNull();
    expect(thumbUrl("http://h", "", 7)).toBeNull();
  });
});
