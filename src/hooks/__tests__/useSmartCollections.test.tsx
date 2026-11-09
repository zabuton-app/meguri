import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import {
  DEFAULT_SMART_COLLECTION_KEY,
  SMART_COLLECTIONS_KEY,
  type SmartCollection,
} from "@/lib/smartCollections";

describe("useSmartCollections", () => {
  it("shares create, edit and delete immediately between sidebar and menu readers", () => {
    const first = renderHook(() => useSmartCollections());
    const second = renderHook(() => useSmartCollections());
    act(() => {
      first.result.current.addCollection("4K", { kind: "video" }, null, "all");
    });
    const bin = second.result.current.collections[0];
    expect(bin.name).toBe("4K");
    act(() => {
      second.result.current.updateCollection({
        ...bin,
        name: "4K picks",
        query: { ratingMin: 4 },
      });
    });
    expect(first.result.current.collections[0].query).toEqual({ ratingMin: 4 });
    act(() => first.result.current.removeCollection(bin.id));
    expect(second.result.current.collections).toEqual([]);
  });
  it("loads persisted collections on mount", () => {
    const stored: SmartCollection[] = [
      {
        id: "c1",
        name: "Saved",
        query: { favorite: true },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    localStorage.setItem(SMART_COLLECTIONS_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useSmartCollections());
    expect(result.current.collections).toEqual(stored);
  });

  it("addCollection prepends and persists", () => {
    const { result } = renderHook(() => useSmartCollections());

    act(() => {
      result.current.addCollection("Unplayed", { played: false });
    });

    expect(result.current.collections).toHaveLength(1);
    expect(result.current.collections[0].name).toBe("Unplayed");
    expect(result.current.collections[0].query).toEqual({ played: false });
    expect(
      JSON.parse(localStorage.getItem(SMART_COLLECTIONS_KEY) ?? "[]"),
    ).toHaveLength(1);
  });

  it("removeCollection drops by id and persists", () => {
    const { result } = renderHook(() => useSmartCollections());
    let id = "";
    act(() => {
      const created = result.current.addCollection("Temp", { q: "x" });
      id = created.id;
    });

    act(() => {
      result.current.removeCollection(id);
    });

    expect(result.current.collections).toHaveLength(0);
    expect(
      JSON.parse(localStorage.getItem(SMART_COLLECTIONS_KEY) ?? "[]"),
    ).toEqual([]);
  });

  it("persists the default and exposes its query", () => {
    const { result } = renderHook(() => useSmartCollections());
    let id = "";
    act(() => {
      id = result.current.addCollection("Videos", { kind: "video" }).id;
    });
    act(() => result.current.setDefaultId(id));

    expect(result.current.defaultId).toBe(id);
    expect(result.current.defaultQuery).toEqual({ kind: "video" });
    expect(localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY)).toBe(id);

    act(() => result.current.setDefaultId(null));
    expect(result.current.defaultQuery).toBeNull();
    expect(localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY)).toBeNull();
  });

  it("drops the default along with its collection", () => {
    const { result } = renderHook(() => useSmartCollections());
    let id = "";
    act(() => {
      id = result.current.addCollection("Videos", { kind: "video" }).id;
    });
    act(() => result.current.setDefaultId(id));
    act(() => result.current.removeCollection(id));

    expect(result.current.defaultId).toBeNull();
    expect(localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY)).toBeNull();
  });
});
