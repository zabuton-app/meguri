import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

  describe("Watch Later context menu", () => {
    const openMenu = async () => {
      const card = await screen.findByTestId("media-card");
      fireEvent.contextMenu(card);
      return card;
    };

    it("offers to add a file that is not in Watch Later yet", async () => {
      renderWithProviders(
        <MediaGrid
          items={[sampleFileRow]}
          mediaBase="http://127.0.0.1:17345"
          workspaceId={WS_ID}
          loading={false}
          thumbVersion={{}}
        />,
      );
      await openMenu();

      const item = await screen.findByText("Add to Watch Later");
      fireEvent.click(item);

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          sampleFileRow.workspaceId,
        ),
      );
      expect(mocks.collectionRemoveFile).not.toHaveBeenCalled();
    });

    it("offers to remove a file already in Watch Later", async () => {
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
      await openMenu();

      const item = await screen.findByText("Remove from Watch Later");
      fireEvent.click(item);

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
      // workspaces; the menu must reference the file's own workspace id.
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
      await openMenu();

      fireEvent.click(await screen.findByText("Add to Watch Later"));

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          42,
          "ws-other",
        ),
      );
    });
  });
});
