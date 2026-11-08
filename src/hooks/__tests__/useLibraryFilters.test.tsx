import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  useLibraryFilters,
  LIBRARY_FILTERS_KEY,
} from "@/hooks/useLibraryFilters";
import { makeSmartCollection } from "@/lib/smartCollections";
import { browseLibrary } from "@/lib/ui-events";
import { saveRecentView } from "@/lib/recentFiles";

describe("library filter visits", () => {
  it("keeps the bin and its visit across Global/Local folder changes, but checks a different bin against original filters", () => {
    const video = makeSmartCollection(
      "Video",
      { kind: "video" },
      undefined,
      "all",
    );
    const audio = makeSmartCollection(
      "Audio",
      { kind: "audio" },
      undefined,
      "all",
    );
    const bins = [video, audio];
    const { result, rerender } = renderHook(
      ({
        workspace,
        scope,
      }: {
        workspace: string;
        scope: "global" | "local";
      }) => useLibraryFilters(bins, null, workspace, scope),
      { initialProps: { workspace: "__all__", scope: "global" } },
    );
    void act(() =>
      result.current.setControls({
        kind: "audio",
        audio: { sampleRate: 96000 },
        ratingMin: 4,
      }),
    );
    void act(() => result.current.enter(video));
    rerender({ workspace: "root-a", scope: "local" });
    void act(() => browseLibrary({ workspaceId: "root-a", keepBin: true }));
    expect(result.current.activeBin?.id).toBe(video.id);
    expect(result.current.controls).toEqual({ ratingMin: 4 });
    expect(result.current.query.matchNone).toBe(true);
    rerender({ workspace: "root-b", scope: "local" });
    void act(() => browseLibrary({ workspaceId: "root-b", keepBin: true }));
    expect(result.current.activeBin?.id).toBe(video.id);
    void act(() => result.current.enter(audio));
    expect(result.current.controls.audio?.sampleRate).toBe(96000);
    expect(result.current.controls.ratingMin).toBe(4);
  });

  it("deactivates newly incompatible filters on edit, keeps them off on a compatible edit, and enables only on request", () => {
    const original = makeSmartCollection(
      "Changing bin",
      { kind: "audio" },
      undefined,
      "all",
    );
    const { result, rerender, unmount } = renderHook(
      ({ bins }) => useLibraryFilters(bins, null, "__all__", "global"),
      { initialProps: { bins: [original] } },
    );
    void act(() =>
      result.current.setControls({
        kind: "audio",
        audio: { sampleRate: 96000 },
        ratingMin: 4,
      }),
    );
    void act(() => result.current.enter(original));
    rerender({ bins: [{ ...original, query: { kind: "video" } }] });
    expect(result.current.controls).toEqual({ ratingMin: 4 });
    expect(result.current.query.matchNone).toBe(true);
    expect(result.current.omitted?.audio?.sampleRate).toBe(96000);
    rerender({ bins: [original] });
    expect(result.current.controls.audio).toBeUndefined();
    expect(result.current.omitted?.audio?.sampleRate).toBe(96000);
    unmount();
    const restored = renderHook(() =>
      useLibraryFilters([original], null, "__all__", "global"),
    );
    expect(restored.result.current.controls.audio).toBeUndefined();
    expect(restored.result.current.query.matchNone).toBe(true);
    void act(() =>
      restored.result.current.enableOmitted({
        kind: "audio",
        audio: { sampleRate: 96000 },
      }),
    );
    expect(restored.result.current.controls.audio?.sampleRate).toBe(96000);
    expect(restored.result.current.omitted?.audio?.sampleRate).toBeUndefined();
    expect(restored.result.current.query.matchNone).toBeUndefined();
  });

  it("preserves remembered audio and resolution values together across restart", () => {
    const bin = makeSmartCollection(
      "Changing bin",
      { kind: "audio" },
      undefined,
      "all",
    );
    const { result, rerender, unmount } = renderHook(
      ({ bins }) => useLibraryFilters(bins, null, "__all__", "global"),
      { initialProps: { bins: [bin] } },
    );
    void act(() =>
      result.current.setControls({
        kind: "video",
        resolution: { preset: "uhd", match: "atLeast" },
      }),
    );
    void act(() => result.current.enter(bin));
    void act(() =>
      result.current.setControls({
        kind: "audio",
        audio: { sampleRate: 96000 },
      }),
    );
    const edited = { ...bin, query: { kind: "video" } };
    rerender({ bins: [edited] });
    expect(result.current.omitted?.resolution?.preset).toBe("uhd");
    expect(result.current.omitted?.audio?.sampleRate).toBe(96000);
    unmount();
    const restored = renderHook(() =>
      useLibraryFilters([edited], null, "__all__", "global"),
    );
    expect(restored.result.current.omitted?.resolution?.preset).toBe("uhd");
    expect(restored.result.current.omitted?.audio?.sampleRate).toBe(96000);
  });
  it("migrates a remembered New files choice without turning default-bin rules into visitor filters", () => {
    saveRecentView({ period: "thisWeek", basis: "created" });
    const bin = makeSmartCollection(
      "4K default",
      { kind: "video", resolution: { preset: "uhd", match: "atLeast" } },
      undefined,
      "all",
    );
    const { result } = renderHook(() =>
      useLibraryFilters([bin], bin.id, "__all__"),
    );
    expect(result.current.controls.recent).toEqual({
      period: "thisWeek",
      basis: "created",
    });
    expect(result.current.controls.resolution).toBeUndefined();
    void act(() => result.current.enter(bin));
    expect(result.current.query.allOf?.[0].resolution?.preset).toBe("uhd");
    expect(result.current.controls.resolution).toBeUndefined();
  });
  it("does not apply a changed bin scope to the old workspace while navigation is pending", () => {
    const first = makeSmartCollection(
      "My folder",
      { kind: "video" },
      "first",
      "workspace",
    );
    const { result, rerender } = renderHook(
      ({ bins, workspace }) => useLibraryFilters(bins, null, workspace),
      { initialProps: { bins: [first], workspace: "first" } },
    );
    void act(() => result.current.enter(first));
    expect(result.current.activeBin?.id).toBe(first.id);
    const moved = { ...first, workspaceId: "second" };
    rerender({ bins: [moved], workspace: "first" });
    expect(result.current.activeBin).toBeUndefined();
    expect(result.current.query.allOf).toBeUndefined();
    void act(() =>
      result.current.setControls({ q: "changed outside the bin" }),
    );
    rerender({ bins: [moved], workspace: "second" });
    void act(() => result.current.enter(moved));
    expect(result.current.activeBin?.id).toBe(first.id);
    expect(result.current.controls.q).toBe("changed outside the bin");
  });
  it("keeps bin identity, carries compatible filters, and never revives exclusions on edit or restart", () => {
    const video = makeSmartCollection(
      "Footage",
      { kind: "video" },
      undefined,
      "all",
    );
    const photo = makeSmartCollection(
      "Photos",
      { kind: "image" },
      undefined,
      "all",
    );
    const { result, rerender, unmount } = renderHook(
      ({ bins }) => useLibraryFilters(bins, null, "__all__"),
      { initialProps: { bins: [video, photo] } },
    );
    void act(() =>
      result.current.setControls({
        kind: "audio",
        audio: { sampleRate: 96000 },
        ratingMin: 4,
      }),
    );
    void act(() => result.current.enter(video));
    expect(result.current.activeBin?.id).toBe(video.id);
    expect(result.current.controls).toEqual({ ratingMin: 4 });
    expect(result.current.query.matchNone).toBe(true);
    void act(() =>
      result.current.setControls((q) => ({
        ...q,
        recent: { period: "today", basis: "added" },
      })),
    );
    expect(result.current.activeBin?.id).toBe(video.id);
    const edited = { ...video, query: { kind: "audio" } };
    rerender({ bins: [edited, photo] });
    expect(result.current.controls.audio).toBeUndefined();
    void act(() => result.current.enter(edited)); // Saving/clicking the current bin is not a new visit.
    expect(result.current.controls.audio).toBeUndefined();
    const beforeRestart = result.current.controls;
    unmount();
    const restored = renderHook(() =>
      useLibraryFilters([edited, photo], null, "__all__"),
    );
    expect(restored.result.current.activeBin?.id).toBe(video.id);
    expect(restored.result.current.controls).toEqual(beforeRestart);
    expect(restored.result.current.controls.audio).toBeUndefined();
    void act(() => browseLibrary());
    expect(restored.result.current.controls.audio?.sampleRate).toBe(96000);
    void act(() =>
      restored.result.current.setControls((q) => ({
        ...q,
        q: "new incoming choice",
      })),
    );
    void act(() => restored.result.current.enter(edited));
    expect(restored.result.current.controls.audio?.sampleRate).toBe(96000);
    expect(restored.result.current.controls.recent?.period).toBe("today");
    void act(() => restored.result.current.clear());
    expect(restored.result.current.controls).toEqual({});
    expect(restored.result.current.activeBin?.id).toBe(video.id);
    expect(restored.result.current.query.allOf).toEqual([{ kind: "audio" }]);
  });

  it("restores full filters outside a bin and tolerates removed bins or invalid storage", () => {
    localStorage.setItem(LIBRARY_FILTERS_KEY, "invalid JSON");
    const bin = makeSmartCollection(
      "Videos",
      { kind: "video" },
      undefined,
      "all",
    );
    const { result, rerender } = renderHook(
      ({ bins }) => useLibraryFilters(bins, null, "__all__"),
      { initialProps: { bins: [bin] } },
    );
    void act(() =>
      result.current.setControls({
        q: "interview",
        ratingMin: 4,
        favorite: true,
        sort: "name",
        sortDir: "asc",
      }),
    );
    void act(() => result.current.enter(bin));
    rerender({ bins: [] });
    expect(result.current.activeBin).toBeUndefined();
    expect(result.current.controls.q).toBe("interview");
    expect(localStorage.getItem(LIBRARY_FILTERS_KEY)).toContain(
      '"selection":null',
    );
  });
});
