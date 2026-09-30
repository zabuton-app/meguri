// Selection behaviour as the user drives it: the checkbox, modified clicks,
// the bar's own buttons and the keys. Rendered through the grid because the
// click rules live in the views, not in the context.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import "@/test/mockVirtualizer";
import { MediaGrid } from "@/components/MediaGrid";
import { SelectionProvider, useSelection } from "@/components/SelectionContext";
import { SelectionLayer } from "@/routes/Home/SelectionLayer";
import { sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow, FolderEntry, FolderFilesResult } from "@/ipc/types";
import { MAX_BULK_FILES } from "@shared/tags";
import { SelectionBar } from "@/components/SelectionBar";

const mocks = vi.hoisted(() => ({
  filesBulkMeta: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  collectionSetMembership: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  workspacesList: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    workspacesList: () => mocks.workspacesList(),
    tagsList: vi.fn().mockResolvedValue([]),
    filesBulkTag: vi.fn().mockResolvedValue({
      files: 0,
      skipped: 0,
      added: 0,
      removed: 0,
    }),
    filesBulkMeta: (...args: unknown[]) => mocks.filesBulkMeta(...args),
    collectionSetMembership: (...args: unknown[]) =>
      mocks.collectionSetMembership(...args),
  },
  ALL_ID: "__all__",
}));

const WATCH_LATER_ID = "watch-later";

/** Workspace list carrying the built-in Watch Later collection. */
const workspacesList = (
  queued: { workspaceId: string; fileId: number }[] = [],
) => ({
  workspaces: [],
  active: null,
  collections: [
    {
      id: WATCH_LATER_ID,
      name: "Watch Later",
      active: false,
      locked: true,
      items: queued.map((q) => ({ ...q, addedAt: 0 })),
      createdAt: 0,
      updatedAt: 0,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspacesList.mockResolvedValue(workspacesList());
  mocks.filesBulkMeta.mockResolvedValue({ files: 1, skipped: 0 });
  mocks.collectionSetMembership.mockResolvedValue({ changed: 1 });
});

const items: FileRow[] = [1, 2, 3, 4].map((id) => ({
  ...sampleFileRow,
  id,
  relPath: `videos/clip-${id}.mp4`,
}));

/** The list with a control that swaps in another one, the way a filter does. */
function Harness({
  first,
  second,
  scopes = false,
}: {
  first: FileRow[];
  second?: FileRow[];
  /** Whether swapping also changes the selection's scope key. */
  scopes?: boolean;
}) {
  const [swapped, setSwapped] = useState(false);
  const shown = swapped && second ? second : first;
  return (
    <>
      <button type="button" onClick={() => setSwapped(true)}>
        swap
      </button>
      <SelectionProvider
        items={shown}
        scope={scopes && swapped ? "other" : "one"}
      >
        <MediaGrid
          items={shown}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          thumbVersion={{}}
        />
        <SelectionLayer active />
      </SelectionProvider>
    </>
  );
}

function renderGrid(props?: Partial<React.ComponentProps<typeof Harness>>) {
  return renderWithProviders(<Harness first={items} {...props} />);
}

/** The selection bar, or null while selection mode is off. */
const bar = () => screen.queryByRole("region", { name: "Selection actions" });

/** Accessible names read "Select" until picked and "Deselect" afterwards. */
const checkboxes = () =>
  screen.getAllByRole("button", { name: /^(Select|Deselect)$/ });

const selectedCount = () => {
  const region = bar();
  if (!region) throw new Error("selection bar is not shown");
  return Number(within(region).getByText(/^\d+$/).textContent);
};

describe("selection", () => {
  it("stays off until something is picked", () => {
    renderGrid();
    expect(bar()).toBeNull();
  });

  it("picks one file through its checkbox and opens the bar", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    expect(selectedCount()).toBe(1);
    expect(checkboxes()[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles the same file back off", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(checkboxes()[0]);
    // The bar stays: it is the only way out of selection mode.
    expect(selectedCount()).toBe(0);
  });

  it("extends a range with Shift from the last plain click", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(checkboxes()[2], { shiftKey: true });
    expect(selectedCount()).toBe(3);
  });

  it("adds a range rather than replacing what is already picked", () => {
    renderGrid();
    fireEvent.click(checkboxes()[3]);
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(checkboxes()[1], { shiftKey: true });
    expect(selectedCount()).toBe(3);
  });

  it("starts a selection from a Ctrl-click on the card itself", () => {
    renderGrid();
    const link = screen.getAllByRole("link")[0];
    fireEvent.click(link, { ctrlKey: true });
    expect(selectedCount()).toBe(1);
  });

  it("takes plain card clicks once selection mode is on", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    // Two links per card (thumbnail and metadata); the second card's first.
    fireEvent.click(screen.getAllByRole("link")[2]);
    expect(selectedCount()).toBe(2);
  });

  it("selects every loaded row from the bar", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(selectedCount()).toBe(items.length);
  });

  it("clears the selection but stays in selection mode", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(selectedCount()).toBe(0);
  });

  it("leaves selection mode from the bar's exit", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Exit selection" }));
    expect(bar()).toBeNull();
  });

  it("selects everything loaded on Ctrl+A and leaves on Escape", () => {
    renderGrid();
    // The event carries the produced character, as a real browser sends it.
    fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true });
    expect(selectedCount()).toBe(items.length);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(bar()).toBeNull();
  });

  it("does not claim Ctrl+Q, whose physical key is KeyA on AZERTY", () => {
    renderGrid();
    fireEvent.keyDown(window, { key: "q", code: "KeyA", ctrlKey: true });
    expect(bar()).toBeNull();
  });

  it("claims the Escape it handles so the window does not also close", () => {
    renderGrid();
    fireEvent.click(checkboxes()[0]);
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("opens the bulk tag dialog with T once something is picked", () => {
    renderGrid();
    fireEvent.keyDown(window, { key: "t", code: "KeyT" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(checkboxes()[0]);
    fireEvent.keyDown(window, { key: "t", code: "KeyT" });
    expect(
      within(screen.getByRole("dialog")).getByText("Edit tags in bulk"),
    ).toBeTruthy();
  });

  describe("when the list underneath changes", () => {
    // Same scope, different rows: what paging does.
    const later: FileRow[] = [7, 8, 9, 10].map((id) => ({
      ...sampleFileRow,
      id,
      relPath: `videos/later-${id}.mp4`,
    }));

    it("keeps rows that are no longer loaded in the selection", () => {
      renderGrid({ second: later });
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(screen.getByRole("button", { name: "swap" }));
      expect(selectedCount()).toBe(1);
    });

    it("does not draw a Shift range from an anchor that is gone", () => {
      renderGrid({ second: later });
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(screen.getByRole("button", { name: "swap" }));
      // The anchor row is not in this list, so the Shift-click picks one row
      // rather than sweeping from whatever now sits at the old index.
      fireEvent.click(checkboxes()[2], { shiftKey: true });
      expect(selectedCount()).toBe(2);
    });

    it("drops the selection when the scope changes", () => {
      renderGrid({ second: later, scopes: true });
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(screen.getByRole("button", { name: "swap" }));
      expect(bar()).toBeNull();
    });
  });
  describe("the bar's bulk controls", () => {
    /** Rows where one is already a favorite: the mixed case. */
    const mixedFavorites: FileRow[] = items.map((item, i) => ({
      ...item,
      favorite: i === 0 ? 1 : 0,
    }));

    /** Scoped to the bar: the cards carry per-file controls with the same names. */
    const inBar = () => {
      const region = bar();
      if (!region) throw new Error("selection bar is not shown");
      return within(region);
    };

    const selectAll = () => {
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    };

    it("favorites the whole selection when only some are favorited", async () => {
      renderGrid({ first: mixedFavorites });
      selectAll();
      const button = inBar().getByTitle("Favorite");
      // The mixed count is on the button, so the state is readable before acting.
      expect(within(button).getByText("1/4")).toBeTruthy();
      fireEvent.click(button);
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][1]).toEqual({ favorite: true });
    });

    it("unfavorites a selection that is already all favorites", async () => {
      renderGrid({ first: items.map((item) => ({ ...item, favorite: 1 })) });
      selectAll();
      fireEvent.click(inBar().getByTitle("Remove from favorites"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][1]).toEqual({ favorite: false });
    });

    it("sends the selection grouped by workspace", async () => {
      renderGrid({ first: mixedFavorites });
      selectAll();
      fireEvent.click(inBar().getByTitle("Favorite"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][0]).toEqual([
        { workspaceId: WS_ID, fileIds: [1, 2, 3, 4] },
      ]);
    });

    it("rates the whole selection", async () => {
      renderGrid({ first: items.map((item) => ({ ...item, rating: 0 })) });
      selectAll();
      fireEvent.click(inBar().getByLabelText("3 stars"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][1]).toEqual({ rating: 3 });
    });

    it("clears the rating when the shared value is clicked again", async () => {
      // Same gesture as the per-file stars: clicking the value it already shows
      // means "no rating".
      renderGrid({ first: items.map((item) => ({ ...item, rating: 4 })) });
      selectAll();
      fireEvent.click(inBar().getByLabelText("4 stars"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][1]).toEqual({ rating: 0 });
    });

    it("keeps writing to the selection the click was made on", async () => {
      // react-query hands an in-flight mutation the newest render's options, so
      // a selection that grows mid-flight must not drag the cache patch (and the
      // next click's direction) along with it.
      let resolve: ((v: unknown) => void) | undefined;
      mocks.filesBulkMeta.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      renderGrid({ first: mixedFavorites });
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(inBar().getByTitle("Remove from favorites"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      // One file was sent; now the selection grows before the write lands.
      expect(mocks.filesBulkMeta.mock.calls[0][0]).toEqual([
        { workspaceId: WS_ID, fileIds: [1] },
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      resolve?.({ files: 1, skipped: 0 });
      // The three files that were never written stay as they were, so the
      // control still offers to favorite them rather than flipping to "remove".
      await waitFor(() => expect(inBar().getByTitle("Favorite")).toBeTruthy());
    });

    it("says so rather than showing one file's stars when they disagree", () => {
      renderGrid({ first: items.map((item, i) => ({ ...item, rating: i })) });
      selectAll();
      expect(
        inBar().getByTitle("The selection has mixed ratings"),
      ).toBeTruthy();
    });

    it("queues the selection for later", async () => {
      renderGrid();
      selectAll();
      // The button stays disabled until the workspace list resolves: Watch Later
      // is a collection, and there is no id to write to before then.
      await waitFor(() =>
        expect(inBar().getByTitle("Watch Later").hasAttribute("disabled")).toBe(
          false,
        ),
      );
      fireEvent.click(inBar().getByTitle("Watch Later"));
      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalled(),
      );
      const [collectionId, targets, op] = mocks.collectionSetMembership.mock
        .calls[0] as [string, unknown, string];
      expect(collectionId).toBe(WATCH_LATER_ID);
      expect(targets).toEqual([{ workspaceId: WS_ID, fileIds: [1, 2, 3, 4] }]);
      expect(op).toBe("add");
    });

    it("offers a way to clear a mixed rating", async () => {
      // Mixed shows no lit star, so there is nothing to click twice — the
      // gesture the per-file control uses to clear.
      renderGrid({ first: items.map((item, i) => ({ ...item, rating: i })) });
      selectAll();
      fireEvent.click(inBar().getByTitle("Clear the rating"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      expect(mocks.filesBulkMeta.mock.calls[0][1]).toEqual({ rating: 0 });
    });

    it("has no clear button when the selection agrees on a rating", () => {
      renderGrid({ first: items.map((item) => ({ ...item, rating: 3 })) });
      selectAll();
      expect(inBar().queryByTitle("Clear the rating")).toBeNull();
    });

    describe("past the file cap", () => {
      // The bar alone, over a selection larger than one call may write. The grid
      // is left out on purpose: the point is the cap, not rendering 5,001 rows.
      const many: FileRow[] = Array.from(
        { length: MAX_BULK_FILES + 1 },
        (_, i) => ({ ...sampleFileRow, id: i + 1 }),
      );

      // The bar is hidden until selection mode is on, and its own "Select all"
      // is therefore not there to start it: this turns it on from outside.
      function Starter() {
        const selection = useSelection();
        return (
          <button type="button" onClick={selection.selectAll}>
            start
          </button>
        );
      }

      function renderOverCap() {
        renderWithProviders(
          <SelectionProvider items={many} scope="one">
            <Starter />
            <SelectionBar onEditTags={() => {}} onExit={() => {}} />
          </SelectionProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "start" }));
      }

      it("stops every edit, tags included", () => {
        renderOverCap();
        // The tag button too: opening a dialog whose Apply can never enable is a
        // dead end rather than a refusal.
        for (const name of [/^Edit tags/, /^Favorite/, /^Watch Later/]) {
          expect(
            screen.getByRole("button", { name }).hasAttribute("disabled"),
          ).toBe(true);
        }
      });

      it("says why, on each of them", () => {
        renderOverCap();
        const limit = `Up to ${MAX_BULK_FILES} files per edit. Narrow the selection.`;
        expect(screen.getAllByTitle(limit).length).toBeGreaterThanOrEqual(3);
      });
    });

    describe("activation effects", () => {
      /** Bursts and icon animations, scoped to the bar. */
      const burst = () => {
        const region = bar();
        if (!region) throw new Error("selection bar is not shown");
        return region.querySelectorAll('[data-testid="fx-burst"]');
      };
      const popping = () => {
        const region = bar();
        if (!region) throw new Error("selection bar is not shown");
        return region.querySelectorAll(".fx-pop");
      };
      const settling = () => {
        const region = bar();
        if (!region) throw new Error("selection bar is not shown");
        return region.querySelectorAll(".fx-settle");
      };

      it("plays nothing until a toggle is pressed", () => {
        // Selecting is not activating: the effect belongs to the click.
        renderGrid({ first: mixedFavorites });
        selectAll();
        expect(burst().length).toBe(0);
        expect(popping().length).toBe(0);
        expect(settling().length).toBe(0);
      });

      it("bursts when the selection is turned on", () => {
        renderGrid({ first: mixedFavorites });
        selectAll();
        fireEvent.click(inBar().getByTitle("Favorite"));
        expect(burst().length).toBe(1);
        expect(popping().length).toBe(1);
        expect(settling().length).toBe(0);
      });

      it("settles instead of bursting when it is turned off", () => {
        renderGrid({ first: items.map((item) => ({ ...item, favorite: 1 })) });
        selectAll();
        fireEvent.click(inBar().getByTitle("Remove from favorites"));
        expect(burst().length).toBe(0);
        expect(settling().length).toBe(1);
      });

      it("plays on the toggle that was pressed, not the other one", async () => {
        renderGrid();
        selectAll();
        await waitFor(() =>
          expect(
            inBar().getByTitle("Watch Later").hasAttribute("disabled"),
          ).toBe(false),
        );
        const queueButton = inBar().getByTitle("Watch Later");
        fireEvent.click(queueButton);
        // Exactly one burst, and it is inside the button that was pressed.
        expect(burst().length).toBe(1);
        expect(
          queueButton.querySelectorAll('[data-testid="fx-burst"]').length,
        ).toBe(1);
        expect(
          inBar()
            .getByTitle("Favorite")
            .querySelectorAll('[data-testid="fx-burst"]').length,
        ).toBe(0);
      });

      it("suppresses the effects under prefers-reduced-motion, still writing", async () => {
        const orig = window.matchMedia;
        window.matchMedia = (query: string) =>
          ({
            matches: query.includes("prefers-reduced-motion"),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList;
        try {
          renderGrid({ first: mixedFavorites });
          selectAll();
          fireEvent.click(inBar().getByTitle("Favorite"));
          expect(burst().length).toBe(0);
          expect(popping().length).toBe(0);
          expect(settling().length).toBe(0);
          await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
        } finally {
          window.matchMedia = orig;
        }
      });
    });

    it("reconciles the file caches after a metadata write", async () => {
      // The patch cannot know everything the write touched: main writes by
      // meta_key, so a duplicate outside the selection changed too, and a file
      // whose row had gone comes back only as a `skipped` count.
      mocks.filesBulkMeta.mockResolvedValue({ files: 3, skipped: 1 });
      const { queryClient } = renderWithProviders(
        <Harness first={mixedFavorites} />,
      );
      selectAll();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      fireEvent.click(inBar().getByTitle("Favorite"));
      await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
      const keys = invalidate.mock.calls.map(
        ([arg]) => arg?.queryKey?.[0] as string | undefined,
      );
      expect(keys).toContain("files_search");
      expect(keys).toContain("file_get");
    });

    it("defers the collection refresh while a file is open", async () => {
      // A docked side peek leaves this bar usable. Refetching a collection-scoped
      // list then drops the open file out of the prev/next order, so the refresh
      // waits for MediaDetail to close — the rule WatchLaterButton already keeps.
      const { queryClient } = renderWithProviders(<Harness first={items} />, {
        route: `/file/1?ws=${WS_ID}`,
      });
      fireEvent.click(checkboxes()[0]);
      await waitFor(() =>
        expect(inBar().getByTitle("Watch Later").hasAttribute("disabled")).toBe(
          false,
        ),
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      fireEvent.click(inBar().getByTitle("Watch Later"));
      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalled(),
      );
      const keys = invalidate.mock.calls.map(([arg]) => arg);
      // The workspace list still refreshes; the collection-scoped searches, which
      // invalidateCollectionSearches selects with a predicate, do not.
      expect(keys.some((k) => k?.queryKey?.[0] === "workspaces_list")).toBe(
        true,
      );
      expect(keys.some((k) => typeof k?.predicate === "function")).toBe(false);
    });

    it("refreshes the collection lists when no file is open", async () => {
      const { queryClient } = renderWithProviders(<Harness first={items} />);
      fireEvent.click(checkboxes()[0]);
      await waitFor(() =>
        expect(inBar().getByTitle("Watch Later").hasAttribute("disabled")).toBe(
          false,
        ),
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      fireEvent.click(inBar().getByTitle("Watch Later"));
      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalled(),
      );
      expect(
        invalidate.mock.calls.some(
          ([arg]) => typeof arg?.predicate === "function",
        ),
      ).toBe(true);
    });

    it("takes a fully queued selection back off the list", async () => {
      mocks.workspacesList.mockResolvedValue(
        workspacesList(
          items.map((item) => ({
            workspaceId: item.workspaceId,
            fileId: item.id,
          })),
        ),
      );
      renderGrid();
      selectAll();
      await waitFor(() =>
        expect(inBar().getByTitle("Remove from Watch Later")).toBeTruthy(),
      );
      fireEvent.click(inBar().getByTitle("Remove from Watch Later"));
      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalled(),
      );
      expect(mocks.collectionSetMembership.mock.calls[0][2]).toBe("remove");
    });
  });
});

describe("folder selection", () => {
  const folder = (name: string, count: number): FolderEntry => ({
    name,
    path: name,
    count,
    subfolders: 0,
    previews: [],
  });
  const filesOf = (name: string, n: number, from: number): FileRow[] =>
    Array.from({ length: n }, (_, i) => ({
      ...sampleFileRow,
      id: from + i,
      relPath: `${name}/f${i}.mp4`,
    }));

  /** An expand whose answers the test releases by hand. */
  function deferredExpand() {
    const calls: {
      paths: string[];
      resolve: (r: FolderFilesResult) => void;
      reject: (e: unknown) => void;
    }[] = [];
    const expand = vi.fn(
      (paths: string[]) =>
        new Promise<FolderFilesResult>((resolve, reject) => {
          calls.push({ paths, resolve, reject });
        }),
    );
    return { expand, calls };
  }

  function FolderHarness({
    folders,
    expand,
    extra,
  }: {
    folders: FolderEntry[];
    expand: (paths: string[]) => Promise<FolderFilesResult>;
    /** Rendered inside the provider, to reach the selection directly. */
    extra?: React.ReactNode;
  }) {
    const [scope, setScope] = useState("root");
    return (
      <>
        <button type="button" onClick={() => setScope("elsewhere")}>
          move
        </button>
        <SelectionProvider
          items={items}
          scope={scope}
          folders={folders}
          expandFolders={expand}
        >
          <MediaGrid
            items={items}
            mediaBase="http://127.0.0.1:17345"
            workspaceId={WS_ID}
            loading={false}
            thumbVersion={{}}
            folders={folders}
            onOpenFolder={() => {}}
          />
          <SelectionLayer active />
          {extra}
        </SelectionProvider>
      </>
    );
  }

  const mediaBoxes = () =>
    screen
      .getAllByTestId("media-card")
      .map((card) =>
        within(card).getByRole("button", { name: /^(Select|Deselect)$/ }),
      );
  const folderBoxes = () =>
    screen
      .getAllByTestId("folder-card")
      .map((card) => within(card).getAllByRole("button")[0]);

  it("counts a folder's files once they arrive, waiting meanwhile", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 3)]} expand={expand} />,
    );
    // Named for what it selects: everything in the folder, not one file.
    expect(folderBoxes()[0].getAttribute("aria-label")).toBe(
      "Select everything in this folder",
    );
    fireEvent.click(folderBoxes()[0]);

    expect(expand).toHaveBeenCalledWith(["Movie"]);
    expect(
      within(bar()!).getByRole("button", { name: /Edit tags/ }),
    ).toHaveProperty("disabled", true);
    expect(within(bar()!).getByText("Loading folder contents")).toBeTruthy();

    await act(async () => {
      calls[0].resolve([
        { path: "Movie", total: 3, rows: filesOf("Movie", 3, 100) },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(3);
    expect(within(bar()!).getByText("including 1 folders")).toBeTruthy();
    expect(
      within(bar()!).getByRole("button", { name: /Edit tags/ }),
    ).toHaveProperty("disabled", false);
  });

  it("forgets a deleted file wherever the selection holds it", async () => {
    const { expand, calls } = deferredExpand();
    function Forget({ file }: { file: FileRow }) {
      const { forget } = useSelection();
      return (
        <button type="button" onClick={() => forget(file)}>
          forget
        </button>
      );
    }
    renderWithProviders(
      <FolderHarness
        folders={[folder("Movie", 2)]}
        expand={expand}
        extra={<Forget file={items[0]} />}
      />,
    );
    fireEvent.click(mediaBoxes()[0]);
    fireEvent.click(folderBoxes()[0]);
    const inFolder = filesOf("Movie", 1, 100)[0];
    await act(async () => {
      // One of the folder's files is also the file picked directly.
      calls[0].resolve([
        { path: "Movie", total: 2, rows: [items[0], inFolder] },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "forget" }));
    // Gone from the direct picks and from the folder's files alike.
    expect(selectedCount()).toBe(1);
  });

  it("adds folder files to picked files without counting any twice", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 2)]} expand={expand} />,
    );
    fireEvent.click(mediaBoxes()[0]);
    fireEvent.click(folderBoxes()[0]);
    await act(async () => {
      // One of the folder's files is also the file picked directly.
      calls[0].resolve([
        {
          path: "Movie",
          total: 2,
          rows: [items[0], ...filesOf("Movie", 1, 100)],
        },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(2);
  });

  it("counts a folder cut short at the cap in full, and refuses the edit", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness
        folders={[folder("Huge", MAX_BULK_FILES + 50)]}
        expand={expand}
      />,
    );
    fireEvent.click(folderBoxes()[0]);
    await act(async () => {
      calls[0].resolve([
        {
          path: "Huge",
          total: MAX_BULK_FILES + 50,
          rows: filesOf("Huge", 10, 100),
        },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(MAX_BULK_FILES + 50);
    expect(
      within(bar()!).getByRole("button", { name: /Edit tags/ }),
    ).toHaveProperty("disabled", true);
  });

  it("drops a folder toggled off before its files arrive", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 3)]} expand={expand} />,
    );
    fireEvent.click(folderBoxes()[0]);
    fireEvent.click(folderBoxes()[0]);
    await act(async () => {
      calls[0].resolve([
        { path: "Movie", total: 3, rows: filesOf("Movie", 3, 100) },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(0);
  });

  it("un-picks a folder whose files could not be fetched", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 3)]} expand={expand} />,
    );
    fireEvent.click(folderBoxes()[0]);
    await act(async () => {
      calls[0].reject(new Error("gone"));
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(0);
    expect(folderBoxes()[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("forgets folders when the list moves to another folder", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 3)]} expand={expand} />,
    );
    fireEvent.click(folderBoxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "move" }));
    await act(async () => {
      calls[0].resolve([
        { path: "Movie", total: 3, rows: filesOf("Movie", 3, 100) },
      ]);
      await Promise.resolve();
    });
    expect(bar()).toBeNull();
  });

  it("selects the folders on screen too with Select all, in one fetch", async () => {
    const { expand, calls } = deferredExpand();
    renderWithProviders(
      <FolderHarness
        folders={[folder("A", 1), folder("B", 2)]}
        expand={expand}
      />,
    );
    fireEvent.click(mediaBoxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(expand).toHaveBeenLastCalledWith(["A", "B"]);
    await act(async () => {
      calls[calls.length - 1].resolve([
        { path: "A", total: 1, rows: filesOf("A", 1, 100) },
        { path: "B", total: 2, rows: filesOf("B", 2, 200) },
      ]);
      await Promise.resolve();
    });
    expect(selectedCount()).toBe(items.length + 3);
  });

  it("toggles a folder from a Ctrl-click on the card instead of opening it", () => {
    const { expand } = deferredExpand();
    renderWithProviders(
      <FolderHarness folders={[folder("Movie", 3)]} expand={expand} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
      {
        ctrlKey: true,
      },
    );
    expect(expand).toHaveBeenCalledWith(["Movie"]);
    expect(folderBoxes()[0].getAttribute("aria-pressed")).toBe("true");
  });
});
