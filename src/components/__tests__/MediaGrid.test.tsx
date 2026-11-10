// @vitest-environment jsdom
// The width test narrows clientWidth on Element.prototype, which happy-dom
// hides behind its own HTMLElement.prototype property.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@/test/mockVirtualizer";
import { MediaGrid } from "@/components/MediaGrid";
import { HOVER_RELEASE_MS } from "@/hooks/useHoverActivation";
import {
  defaultWorkspacesList,
  sampleFileRow,
  sampleTags,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

/** A card mounts its hover-only controls once pointed at (useHoverActivation). */
function hoverCards() {
  for (const card of screen.queryAllByTestId("media-card")) {
    fireEvent.mouseEnter(card);
  }
}

const mocks = vi.hoisted(() => ({
  fileSetFavorite: vi.fn(),
  fileSetRating: vi.fn(),
  workspacesList: vi.fn(),
  collectionAddFile: vi.fn(),
  collectionRemoveFile: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
    workspacesList: () => mocks.workspacesList(),
    collectionAddFile: (...args: unknown[]) => mocks.collectionAddFile(...args),
    collectionRemoveFile: (...args: unknown[]) =>
      mocks.collectionRemoveFile(...args),
  },
  ALL_ID: "__all__",
}));

const watchLaterCollection = (
  items: { workspaceId: string; fileId: number; addedAt: number }[] = [],
) => ({
  id: "watch-later",
  name: "Watch Later",
  emoji: "🕒",
  active: false,
  items,
  createdAt: 0,
  updatedAt: 0,
  locked: true,
});

describe("MediaGrid", () => {
  beforeEach(() => {
    mocks.fileSetFavorite.mockResolvedValue(undefined);
    mocks.fileSetRating.mockResolvedValue(undefined);
    mocks.collectionAddFile.mockResolvedValue(undefined);
    mocks.collectionRemoveFile.mockResolvedValue(undefined);
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [watchLaterCollection()],
    });
    mocks.collectionAddFile.mockClear();
    mocks.collectionRemoveFile.mockClear();
  });

  it("derives the row height from the width once the width is known", async () => {
    // A list narrow enough for one column (e.g. beside a wide side peek).
    // The setup stubs every element at 1200px; narrow it for this test.
    const proto = Element.prototype;
    const wide = Object.getOwnPropertyDescriptor(proto, "clientWidth")!;
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get: () => 380,
    });
    // A 300px row whose thumbnail (aspect-video over a 348px column, inside
    // the card's 1px borders) takes 194.625px of it: the rest is what the
    // grid keeps from the measurement.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return {
          height: this.hasAttribute("data-thumb") ? 194.625 : 300,
        } as DOMRect;
      });
    try {
      const items = [
        sampleFileRow,
        { ...sampleFileRow, id: 2, relPath: "b.mp4" },
      ];
      const { container } = renderWithProviders(
        <MediaGrid
          items={items}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );
      await waitFor(() => {
        expect(screen.getByText("b.mp4")).toBeTruthy();
      });
      // Rows mount before the width is measured; the height must come from
      // a measurement taken after it (300px per row), not from one that
      // filed the whole row as "beyond the thumbnail" while the width was 0.
      await waitFor(() => {
        const rows = container.querySelectorAll<HTMLElement>(
          "[style*='translateY']",
        );
        expect(rows.length).toBe(2);
        expect(rows[1].style.transform).toBe("translateY(300px)");
      });
    } finally {
      rect.mockRestore();
      Object.defineProperty(proto, "clientWidth", wide);
    }
  });

  it("renders file cards with detail links including workspace id", async () => {
    renderWithProviders(
      <MediaGrid
        items={[sampleFileRow]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("sample.mp4")).toBeTruthy();
    });

    const links = screen.getAllByRole("link");
    const detailLink = links.find((link) =>
      link.getAttribute("href")?.includes(`/file/1?ws=${WS_ID}`),
    );
    expect(detailLink).toBeTruthy();
  });

  it("shows the empty state when there are no items", () => {
    renderWithProviders(
      <MediaGrid
        items={[]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
      />,
    );
    expect(screen.getByText(/No media to display/i)).toBeTruthy();
  });

  it("shows the Watch Later empty state when that collection is active", () => {
    renderWithProviders(
      <MediaGrid
        items={[]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
        watchLater
      />,
    );
    expect(screen.getByText("Watch Later is empty.")).toBeTruthy();
    expect(screen.queryByText(/No media to display/i)).toBeNull();
  });

  describe("hover-only controls", () => {
    const renderOne = (file = sampleFileRow) =>
      renderWithProviders(
        <MediaGrid
          items={[file]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );
    const controls = () => ({
      check: screen.queryByRole("button", { name: "Select" }),
      favorite: screen.queryByRole("button", { name: "Add to favorites" }),
      watchLater: screen.queryByRole("button", { name: /Watch Later/ }),
      stars: screen.queryAllByRole("button", { name: /stars$/ }),
    });

    it("draws only what is visible until the card is hovered", () => {
      renderOne();
      const before = controls();
      expect(before.check).toBeNull();
      expect(before.favorite).toBeNull();
      expect(before.watchLater).toBeNull();
      expect(before.stars).toHaveLength(0);
      // The rating is still shown, just not editable yet.
      expect(screen.getByRole("img", { name: /^Rated/ })).toBeTruthy();

      fireEvent.mouseEnter(screen.getByTestId("media-card"));
      const after = controls();
      expect(after.check).not.toBeNull();
      expect(after.favorite).not.toBeNull();
      expect(after.watchLater).not.toBeNull();
      expect(after.stars).toHaveLength(5);
    });

    it("keeps every control outside the card's links", () => {
      renderOne({ ...sampleFileRow, tags: sampleTags });
      const card = screen.getByTestId("media-card");
      fireEvent.mouseEnter(card);
      expect(controls().favorite).not.toBeNull();
      expect(screen.getByRole("button", { name: "beach" })).toBeTruthy();
      expect(
        card.querySelectorAll("a button, a [role='button'], a input"),
      ).toHaveLength(0);
      // Both regions still link to the detail: the thumbnail auto-plays,
      // the metadata opens it paused.
      const hrefs = screen
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"));
      expect(hrefs).toHaveLength(2);
      expect(hrefs[0]).not.toContain("autoplay=0");
      expect(hrefs[1]).toContain("autoplay=0");
    });

    it("names the thumbnail link after the file and keeps the path tooltip on the name", () => {
      renderOne({ ...sampleFileRow, duration: 0 });
      // Both links read as the file: the thumbnail (auto-play) first.
      const [thumbLink, nameLink] = screen.getAllByRole("link", {
        name: "sample.mp4",
      });
      expect(thumbLink.getAttribute("href")).not.toContain("autoplay=0");
      expect(nameLink.getAttribute("href")).toContain("autoplay=0");
      // A zero duration draws no badge (not a stray "0").
      expect(thumbLink.textContent).toBe("");
      const tooltip = screen.getByTitle(sampleFileRow.relPath);
      expect(tooltip.tagName).toBe("SPAN");
      expect(
        screen.getByTestId("media-card").querySelector("a[title]"),
      ).toBeNull();
    });

    it("mounts them when focus moves into the card", () => {
      renderOne();
      fireEvent.focus(screen.getAllByRole("link")[0]);
      expect(controls().check).not.toBeNull();
    });

    it("keeps a favorite's toggle on screen without a hover", () => {
      renderOne({ ...sampleFileRow, favorite: 1 });
      expect(
        screen.getByRole("button", { name: "Remove from favorites" }),
      ).toBeTruthy();
    });

    it("lets them fade out before taking them down", () => {
      vi.useFakeTimers();
      try {
        renderOne();
        const card = screen.getByTestId("media-card");
        fireEvent.mouseEnter(card);
        fireEvent.mouseLeave(card);
        expect(controls().check).not.toBeNull();
        act(() => {
          vi.advanceTimersByTime(HOVER_RELEASE_MS);
        });
        expect(controls().check).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Watch Later button", () => {
    // The toggle stays disabled until workspaces_list resolves (it needs the
    // collection id), so wait for that rather than clicking a dead button.
    const button = async () => {
      hoverCards();
      const btn = await screen.findByRole("button", { name: /Watch Later/ });
      await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));
      return btn;
    };

    it("adds a file that is not in Watch Later yet", async () => {
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );

      const btn = await button();
      expect(btn.getAttribute("aria-label")).toBe("Add to Watch Later");
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(btn);

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          sampleFileRow.workspaceId,
        ),
      );
      expect(mocks.collectionRemoveFile).not.toHaveBeenCalled();
    });

    it("removes a file already in Watch Later", async () => {
      mocks.workspacesList.mockResolvedValue({
        ...defaultWorkspacesList,
        collections: [
          watchLaterCollection([
            {
              workspaceId: sampleFileRow.workspaceId,
              fileId: sampleFileRow.id,
              addedAt: 0,
            },
          ]),
        ],
      });
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );

      const btn = await button();
      expect(btn.getAttribute("aria-label")).toBe("Remove from Watch Later");
      expect(btn.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(btn);

      await waitFor(() =>
        expect(mocks.collectionRemoveFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          sampleFileRow.workspaceId,
        ),
      );
      expect(mocks.collectionAddFile).not.toHaveBeenCalled();
    });

    it("targets each file's own workspace, not the active one", async () => {
      // A cross-workspace view (All / a collection) lists files from several
      // workspaces; the button must reference the file's own workspace id.
      const foreign = {
        ...sampleFileRow,
        id: 42,
        workspaceId: "ws-other",
        relPath: "other.mp4",
      };
      renderWithProviders(
        <MediaGrid
          items={[foreign]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );

      fireEvent.click(await button());

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          42,
          "ws-other",
        ),
      );
    });

    it("does not navigate to the detail view when clicked", async () => {
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
        />,
      );

      const before = window.location.hash;
      fireEvent.click(await button());

      await waitFor(() => expect(mocks.collectionAddFile).toHaveBeenCalled());
      expect(window.location.hash).toBe(before);
    });
  });

  describe('"W" shortcut', () => {
    const renderGrid = () =>
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          navActive
        />,
      );

    // The toggle is disabled until workspaces_list resolves (it needs the
    // collection id), so let that settle before pressing anything.
    const ready = async () => {
      hoverCards();
      const btn = await screen.findByRole("button", { name: /Watch Later/ });
      await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));
    };

    /**
     * Asserts that the key press just made was a no-op. Checking
     * `not.toHaveBeenCalled()` straight after a fireEvent would pass either
     * way — react-query only reaches the mutationFn a microtask later — so let
     * that settle first.
     */
    const expectNoToggle = async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.collectionAddFile).not.toHaveBeenCalled();
      expect(mocks.collectionRemoveFile).not.toHaveBeenCalled();
    };

    it("toggles the focused card without it being hovered", async () => {
      // Keyboard focus alone keeps the card's toggle mounted for the shortcut.
      renderGrid();
      fireEvent.keyDown(window, { code: "ArrowDown" });
      const btn = await screen.findByRole("button", { name: /Watch Later/ });
      await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));

      fireEvent.keyDown(window, { code: "KeyW" });
      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          sampleFileRow.workspaceId,
        ),
      );
    });

    it("toggles the focused card", async () => {
      renderGrid();
      await ready();

      // Nothing is focused until the user moves into the grid.
      fireEvent.keyDown(window, { code: "KeyW" });
      expect(mocks.collectionAddFile).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { code: "ArrowDown" });
      fireEvent.keyDown(window, { code: "KeyW" });

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          sampleFileRow.workspaceId,
        ),
      );
    });

    it("stays out of the way while typing in a text field", async () => {
      renderGrid();
      await ready();
      fireEvent.keyDown(window, { code: "ArrowDown" });

      const input = document.createElement("input");
      document.body.appendChild(input);
      try {
        input.focus();
        fireEvent.keyDown(window, { code: "KeyW" });
      } finally {
        // Leaving a focused input behind would suppress the key in later tests.
        input.remove();
      }

      await expectNoToggle();
    });

    it("ignores the key once the list stops being foreground", async () => {
      // Focus a card while the grid is foreground, *then* put a modal over it:
      // asserting on a never-focused grid would pass even without the `active`
      // guard, since no card would be holding the ref.
      const view = renderGrid();
      await ready();
      fireEvent.keyDown(window, { code: "ArrowDown" });

      view.rerender(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          navActive={false}
        />,
      );
      fireEvent.keyDown(window, { code: "KeyW" });

      await expectNoToggle();
    });

    it("lets the key through while the toggle is still disabled", async () => {
      // workspaces_list never resolves here, so the toggle stays disabled for
      // want of the collection id. Clicking a disabled button is a no-op, so
      // claiming the key would eat it while nothing can act on it.
      mocks.workspacesList.mockReturnValue(new Promise(() => {}));
      renderGrid();
      fireEvent.keyDown(window, { code: "ArrowDown" });
      // The focused card keeps its toggle mounted for the shortcut.
      await screen.findByRole("button", { name: /Watch Later/ });

      // fireEvent returns false when a handler called preventDefault.
      const notSwallowed = fireEvent.keyDown(window, { code: "KeyW" });

      expect(notSwallowed).toBe(true);
      await expectNoToggle();
    });

    it("opens the focused card on Enter, and its details without autoplay on Shift+Enter", async () => {
      renderGrid();
      await ready();
      fireEvent.keyDown(window, { code: "ArrowDown" });

      fireEvent.keyDown(window, { code: "Enter", shiftKey: true });
      await waitFor(() =>
        expect(window.location.hash).toBe(
          `#/file/${sampleFileRow.id}?ws=${WS_ID}&autoplay=0`,
        ),
      );

      window.location.hash = "#/";
      fireEvent.keyDown(window, { code: "Enter" });
      await waitFor(() =>
        expect(window.location.hash).toBe(
          `#/file/${sampleFileRow.id}?ws=${WS_ID}`,
        ),
      );
    });

    it("ignores auto-repeat from a held key", async () => {
      renderGrid();
      await ready();
      fireEvent.keyDown(window, { code: "ArrowDown" });

      fireEvent.keyDown(window, { code: "KeyW", repeat: true });

      await expectNoToggle();
    });
  });

  describe("folder cards", () => {
    const folder = (name: string, count = 2) => ({
      name,
      path: name,
      count,
      subfolders: 0,
      previews: [sampleFileRow],
    });

    it("draws folder cards ahead of the files and opens them on click", async () => {
      const onOpenFolder = vi.fn();
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          folders={[folder("Movie"), folder("Photos", 7)]}
          onOpenFolder={onOpenFolder}
        />,
      );
      const cards = await screen.findAllByTestId(/^(folder|media)-card$/);
      expect(cards.map((c) => c.dataset.testid)).toEqual([
        "folder-card",
        "folder-card",
        "media-card",
      ]);
      expect(screen.getAllByText("7 items").length).toBeGreaterThan(0);
      // The subfolder line appears only for folders that have some.
      expect(screen.queryByText(/Subfolders/)).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: 'Open folder "Movie"' }),
      );
      expect(onOpenFolder).toHaveBeenCalledWith("Movie");
      // Opening a folder is not opening a file.
      expect(window.location.hash).not.toContain("/file/");
    });

    it("opens the focused folder with Enter", async () => {
      const onOpenFolder = vi.fn();
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          navActive
          folders={[folder("Movie")]}
          onOpenFolder={onOpenFolder}
        />,
      );
      await screen.findByTestId("folder-card");
      act(() => {
        fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
      });
      act(() => {
        fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      });
      expect(onOpenFolder).toHaveBeenCalledWith("Movie");
    });

    it("drops the folder cards from a window that starts past the top", async () => {
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          listOffset={100}
          folders={[folder("Movie")]}
        />,
      );
      await screen.findByTestId("media-card");
      expect(screen.queryByTestId("folder-card")).toBeNull();
    });

    it("builds the mosaic from the previews it is given", async () => {
      renderWithProviders(
        <MediaGrid
          items={[]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          folders={[
            {
              ...folder("Many", 9),
              subfolders: 2,
              previews: [1, 2, 3].map((id) => ({
                ...sampleFileRow,
                id,
                relPath: `Many/${id}.mp4`,
              })),
            },
          ]}
        />,
      );
      const mosaic = await screen.findByTestId("folder-mosaic");
      expect(mosaic.querySelectorAll("img")).toHaveLength(3);
      expect(screen.getByText("Subfolders: 2")).toBeTruthy();
    });

    it("says a folder search found nothing", () => {
      renderWithProviders(
        <MediaGrid
          items={[]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          inFolder
        />,
      );
      expect(screen.getByText("Nothing in this folder matches")).toBeTruthy();
    });
  });

  it("keeps a window that starts mid-row in its columns", async () => {
    // 1200px stub → 6 columns. A window starting at item 100 begins at
    // column 4 of its row (100 % 6), so that row opens with 4 empty cells.
    const items = [1, 2, 3].map((id) => ({
      ...sampleFileRow,
      id,
      relPath: `clip-${id}.mp4`,
    }));
    const { container } = renderWithProviders(
      <MediaGrid
        items={items}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
        listOffset={100}
      />,
    );
    await screen.findByText("clip-1.mp4");
    const rows = container.querySelectorAll<HTMLElement>(
      "[style*='translateY'] > div",
    );
    const first = Array.from(rows[0].children);
    expect(first.slice(0, 4).every((c) => c.getAttribute("aria-hidden"))).toBe(
      true,
    );
    expect(first.slice(4).map((c) => c.getAttribute("data-testid"))).toEqual([
      "media-card",
      "media-card",
    ]);
    expect(rows[1].children).toHaveLength(1);
  });
});
