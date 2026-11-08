import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LAST_LIBRARY_LOCATION_KEY,
  readLibraryLocation,
  rememberLibraryLocation,
  useLibraryLocation,
} from "@/hooks/useLibraryLocation";

describe("last local browsing location", () => {
  it("remembers a folder while Global or collections are visited, including restart", () => {
    const { result, unmount } = renderHook(useLibraryLocation);
    void act(() => rememberLibraryLocation("root-a", "downloads/new"));
    expect(result.current).toEqual({
      workspaceId: "root-a",
      path: "downloads/new",
    });
    void act(() => rememberLibraryLocation("__all__", ""));
    void act(() => rememberLibraryLocation("collection:example", ""));
    expect(result.current?.path).toBe("downloads/new");
    unmount();
    const restarted = renderHook(useLibraryLocation);
    expect(restarted.result.current).toEqual({
      workspaceId: "root-a",
      path: "downloads/new",
    });
  });

  it("ignores malformed locations and virtual workspaces", () => {
    localStorage.setItem(LAST_LIBRARY_LOCATION_KEY, "broken");
    expect(readLibraryLocation()).toBeNull();
    localStorage.setItem(
      LAST_LIBRARY_LOCATION_KEY,
      JSON.stringify({ workspaceId: "__all__", path: "" }),
    );
    expect(readLibraryLocation()).toBeNull();
    localStorage.setItem(
      LAST_LIBRARY_LOCATION_KEY,
      JSON.stringify({ workspaceId: "root-a", path: 42 }),
    );
    expect(readLibraryLocation()).toBeNull();
  });
});
