import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import {
  SMART_COLLECTIONS_KEY,
  type SmartCollection,
} from "@/lib/smartCollections";

describe("useSmartCollections", () => {
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
});
