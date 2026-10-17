import { describe, expect, it } from "vitest";
import { visibleSet } from "../model/visibility";
import {
  thumbnailsActive,
  thumbnailsOverLimit,
  visibleFileCount,
} from "../model/thumbnails";
import { graphOf } from "./fixtures";

const on = { thumbnails: true, thumbnailLimit: 3 };

describe("visibleFileCount", () => {
  it("counts the visible files, not the tags", () => {
    const g = graphOf([
      { path: "a.mp4", tags: ["sea"] },
      { path: "b.mp4", tags: ["sea"] },
      { path: "c.mp4" },
    ]);
    const options = { edgeSources: {}, showAutoTags: false };
    expect(
      visibleFileCount(g, visibleSet(g, { ...options, showOrphans: false })),
    ).toBe(2);
    expect(
      visibleFileCount(g, visibleSet(g, { ...options, showOrphans: true })),
    ).toBe(3);
  });
});

describe("thumbnailsActive", () => {
  it("draws thumbnails up to and including the limit", () => {
    expect(thumbnailsActive({ display: on, visibleFiles: 1, dims: 2 })).toBe(
      true,
    );
    expect(thumbnailsActive({ display: on, visibleFiles: 3, dims: 2 })).toBe(
      true,
    );
    expect(thumbnailsActive({ display: on, visibleFiles: 4, dims: 2 })).toBe(
      false,
    );
  });

  it("draws none with nothing on show, switched off, or in 3D", () => {
    expect(thumbnailsActive({ display: on, visibleFiles: 0, dims: 2 })).toBe(
      false,
    );
    expect(
      thumbnailsActive({
        display: { ...on, thumbnails: false },
        visibleFiles: 1,
        dims: 2,
      }),
    ).toBe(false);
    expect(thumbnailsActive({ display: on, visibleFiles: 1, dims: 3 })).toBe(
      false,
    );
    expect(
      thumbnailsActive({
        display: { ...on, thumbnailLimit: 0 },
        visibleFiles: 1,
        dims: 2,
      }),
    ).toBe(false);
  });
});

describe("thumbnailsOverLimit", () => {
  it("only when switched on, in 2D, past the limit", () => {
    expect(thumbnailsOverLimit({ display: on, visibleFiles: 4, dims: 2 })).toBe(
      true,
    );
    expect(thumbnailsOverLimit({ display: on, visibleFiles: 3, dims: 2 })).toBe(
      false,
    );
    expect(thumbnailsOverLimit({ display: on, visibleFiles: 4, dims: 3 })).toBe(
      false,
    );
    expect(
      thumbnailsOverLimit({
        display: { ...on, thumbnails: false },
        visibleFiles: 4,
        dims: 2,
      }),
    ).toBe(false);
  });
});
