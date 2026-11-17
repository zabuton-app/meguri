import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  initialFilter,
  smartCollectionsQuery,
  useSmartCollections,
} from "@/hooks/useSmartCollections";
import {
  DEFAULT_SMART_COLLECTION_KEY,
  SMART_COLLECTIONS_KEY,
  type SmartCollection,
} from "@/lib/smartCollections";
import { createTestQueryClient } from "@/test/renderWithProviders";

// A stand-in for the library: main answers every change with what it stored.
const main = vi.hoisted(() => ({
  collections: [] as SmartCollection[],
  defaultId: null as string | null,
  imported: false,
  failWrites: false,
}));
const state = () => ({
  collections: [...main.collections],
  defaultId: main.defaultId,
});
const write = (fn: () => void) => {
  if (main.failWrites) return Promise.reject(new Error("disk full"));
  fn();
  return Promise.resolve(state());
};

vi.mock("@/ipc/client", () => ({
  api: {
    smartCollectionsList: vi.fn(() =>
      Promise.resolve({ ...state(), needsImport: !main.imported }),
    ),
    smartCollectionsImport: vi.fn(
      (collections: SmartCollection[], defaultId: string | null) => {
        if (!main.imported && main.collections.length === 0) {
          main.collections = collections;
          main.defaultId = defaultId;
        }
        main.imported = true;
        return Promise.resolve(state());
      },
    ),
    smartCollectionAdd: vi.fn((c: SmartCollection) =>
      write(() => (main.collections = [c, ...main.collections])),
    ),
    smartCollectionRemove: vi.fn((id: string) =>
      write(() => {
        main.collections = main.collections.filter((c) => c.id !== id);
        if (main.defaultId === id) main.defaultId = null;
      }),
    ),
    smartCollectionSetDefault: vi.fn((id: string | null) =>
      write(() => (main.defaultId = id)),
    ),
  },
}));

const { api } = await import("@/ipc/client");

const saved: SmartCollection = {
  id: "c1",
  name: "Saved",
  query: { kind: "video", folder: { path: "a", recursive: true } },
  workspaceId: "ws1",
  createdAt: 1,
  updatedAt: 1,
};

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSmartCollections(), { wrapper });
  return { queryClient, ...hook };
}

beforeEach(() => {
  main.collections = [];
  main.defaultId = null;
  main.imported = true;
  main.failWrites = false;
  vi.clearAllMocks();
});

describe("useSmartCollections", () => {
  it("loads the stored collections", async () => {
    main.collections = [saved];
    const { result } = setup();
    await waitFor(() => expect(result.current.collections).toEqual([saved]));
    expect(api.smartCollectionsImport).not.toHaveBeenCalled();
  });

  it("moves what localStorage holds into the library on the first launch", async () => {
    main.imported = false;
    localStorage.setItem(SMART_COLLECTIONS_KEY, JSON.stringify([saved]));
    localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, "c1");
    const { result } = setup();
    await waitFor(() => expect(result.current.collections).toEqual([saved]));
    expect(result.current.defaultId).toBe("c1");
    expect(api.smartCollectionsImport).toHaveBeenCalledWith([saved], "c1");
  });

  it("tries the move again next launch when localStorage cannot be read", async () => {
    main.imported = false;
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    try {
      setup();
      await waitFor(() =>
        expect(api.smartCollectionsList).toHaveBeenCalledTimes(1),
      );
      expect(api.smartCollectionsImport).not.toHaveBeenCalled();
      expect(main.imported).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it("does not read localStorage once they are in the library", async () => {
    localStorage.setItem(SMART_COLLECTIONS_KEY, JSON.stringify([saved]));
    const { result } = setup();
    await waitFor(() =>
      expect(api.smartCollectionsList).toHaveBeenCalledTimes(1),
    );
    expect(result.current.collections).toEqual([]);
    expect(api.smartCollectionsImport).not.toHaveBeenCalled();
  });

  it("addCollection stores a new one first", async () => {
    main.collections = [saved];
    const { result } = setup();
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
    act(() => {
      result.current.addCollection("Unplayed", { played: false });
    });
    await waitFor(() => expect(result.current.collections).toHaveLength(2));
    expect(result.current.collections[0].name).toBe("Unplayed");
    expect(result.current.collections[0].query).toEqual({ played: false });
    expect(main.collections).toEqual(result.current.collections);
  });

  it("removeCollection drops it from the library", async () => {
    main.collections = [saved];
    const { result } = setup();
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
    act(() => result.current.removeCollection("c1"));
    await waitFor(() => expect(result.current.collections).toEqual([]));
    expect(main.collections).toEqual([]);
  });

  it("stores the default and exposes its query", async () => {
    main.collections = [saved];
    const { result } = setup();
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
    act(() => result.current.setDefaultId("c1"));
    await waitFor(() => expect(result.current.defaultId).toBe("c1"));
    expect(result.current.defaultQuery).toEqual({ kind: "video" });
    expect(main.defaultId).toBe("c1");

    act(() => result.current.setDefaultId(null));
    await waitFor(() => expect(result.current.defaultQuery).toBeNull());
    expect(main.defaultId).toBeNull();
  });

  it("drops the default along with its collection", async () => {
    main.collections = [saved];
    main.defaultId = "c1";
    const { result } = setup();
    await waitFor(() => expect(result.current.defaultId).toBe("c1"));
    act(() => result.current.removeCollection("c1"));
    await waitFor(() => expect(result.current.defaultId).toBeNull());
  });

  it("keeps the list as it was when a save fails", async () => {
    main.collections = [saved];
    main.failWrites = true;
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.collections).toHaveLength(1));
    act(() => {
      result.current.addCollection("Unplayed", { played: false });
    });
    // Reported by useMutationErrorNotifier, which watches the mutation cache.
    await waitFor(() =>
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .some((m) => m.state.status === "error"),
      ).toBe(true),
    );
    expect(result.current.collections).toEqual([saved]);
  });
});

describe("initialFilter", () => {
  it("is the default saved search once they are loaded", async () => {
    const queryClient = createTestQueryClient();
    expect(initialFilter(queryClient)).toEqual({});
    main.collections = [saved];
    main.defaultId = "c1";
    await queryClient.prefetchQuery(smartCollectionsQuery);
    // Without the workspace-bound folder (defaultQueryOf).
    expect(initialFilter(queryClient)).toEqual({ kind: "video" });
  });
});
