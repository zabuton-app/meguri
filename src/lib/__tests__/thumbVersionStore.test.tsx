import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  bumpThumbVersions,
  getThumbVersion,
  resetThumbVersionsForTest,
  useThumbVersionOf,
} from "@/lib/thumbVersionStore";

describe("thumbVersionStore", () => {
  afterEach(() => {
    resetThumbVersionsForTest();
  });

  it("adds each batch onto the file's count", () => {
    bumpThumbVersions(new Map([["w:1", 1]]));
    bumpThumbVersions(new Map([["w:1", 2]]));
    expect(getThumbVersion("w", 1)).toBe(3);
    expect(getThumbVersion("w", 2)).toBe(0);
  });

  it("re-renders only the thumbnails of the files a batch names", () => {
    let rendersA = 0;
    let rendersB = 0;
    const a = renderHook(() => {
      rendersA++;
      return useThumbVersionOf("w", 1);
    });
    const b = renderHook(() => {
      rendersB++;
      return useThumbVersionOf("w", 2);
    });
    const before = { a: rendersA, b: rendersB };

    act(() => {
      bumpThumbVersions(new Map([["w:1", 1]]));
    });
    expect(a.result.current).toBe(1);
    expect(rendersA).toBe(before.a + 1);
    expect(b.result.current).toBe(0);
    expect(rendersB).toBe(before.b);
  });

  it("keys by workspace, as file ids repeat across workspaces", () => {
    const { result } = renderHook(() => useThumbVersionOf("other", 1));
    act(() => {
      bumpThumbVersions(new Map([["w:1", 1]]));
    });
    expect(result.current).toBe(0);
  });
});
