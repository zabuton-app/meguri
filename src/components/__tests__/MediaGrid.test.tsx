import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@/test/mockVirtualizer";
import { MediaGrid } from "@/components/MediaGrid";
import { defaultWorkspacesList, sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

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

  it("renders file cards with detail links including workspace id", async () => {
    renderWithProviders(
      <MediaGrid
        items={[sampleFileRow]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
        thumbVersion={{}}
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
        thumbVersion={{}}
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
        thumbVersion={{}}
        watchLater
      />,
    );
    expect(screen.getByText("Watch Later is empty.")).toBeTruthy();
    expect(screen.queryByText(/No media to display/i)).toBeNull();
  });

  describe("Watch Later button", () => {
    // The toggle stays disabled until workspaces_list resolves (it needs the
    // collection id), so wait for that rather than clicking a dead button.
    const button = async () => {
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
          thumbVersion={{}}
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
          thumbVersion={{}}
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
          thumbVersion={{}}
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
          thumbVersion={{}}
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
          thumbVersion={{}}
          navActive
        />,
      );

    // The toggle is disabled until workspaces_list resolves (it needs the
    // collection id), so let that settle before pressing anything.
    const ready = async () => {
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
          thumbVersion={{}}
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
      await screen.findByRole("button", { name: /Watch Later/ });
      fireEvent.keyDown(window, { code: "ArrowDown" });

      // fireEvent returns false when a handler called preventDefault.
      const notSwallowed = fireEvent.keyDown(window, { code: "KeyW" });

      expect(notSwallowed).toBe(true);
      await expectNoToggle();
    });

    it("ignores auto-repeat from a held key", async () => {
      renderGrid();
      await ready();
      fireEvent.keyDown(window, { code: "ArrowDown" });

      fireEvent.keyDown(window, { code: "KeyW", repeat: true });

      await expectNoToggle();
    });
  });
});
