// The Watch Later toggle in the detail view: it sits next to the favorite heart,
// the "W" shortcut drives it, and it follows the main process's silent
// auto-removal on play instead of staying stuck in the queued state.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  fileGet: vi.fn(),
  filesSearch: vi.fn(),
  fileRecordPlay: vi.fn(),
  collectionAddFile: vi.fn(),
  collectionRemoveFile: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
    collectionAddFile: (...args: unknown[]) => mocks.collectionAddFile(...args),
    collectionRemoveFile: (...args: unknown[]) =>
      mocks.collectionRemoveFile(...args),
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    tagsList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn().mockResolvedValue(undefined),
    copyFilePath: vi.fn().mockResolvedValue(undefined),
    bookmarkAdd: vi.fn().mockResolvedValue(null),
    bookmarkRemove: vi.fn().mockResolvedValue(undefined),
    thumbSetOffset: vi.fn().mockResolvedValue({ thumbOffsetSec: null }),
    fileAddTag: vi.fn().mockResolvedValue(undefined),
    fileRemoveTag: vi.fn().mockResolvedValue(undefined),
    fileDeleteFromIndex: vi.fn().mockResolvedValue({ id: 1 }),
  },
  events: {
    onThumbDone: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
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

const sampleImageDetail = {
  ...sampleFileDetail,
  kind: "image",
  ext: "jpg",
  relPath: "images/sample.jpg",
  absPath: "/media/images/sample.jpg",
  duration: null,
};

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="file/:id" element={<MediaDetail />} />
    </Routes>,
    { route: `/file/1?ws=${WS_ID}` },
  );
}

/** The toggle stays disabled until workspaces_list resolves (it needs the id). */
async function toggle(): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name: /Watch Later/ });
  await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));
  return btn;
}

describe("Watch Later toggle in the detail view", () => {
  beforeEach(() => {
    // Reset call history too: one test asserts the exact number of
    // workspaces_list fetches.
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [watchLaterCollection()],
    });
    mocks.fileGet.mockResolvedValue(sampleFileDetail);
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fileRecordPlay.mockResolvedValue(undefined);
    mocks.collectionAddFile.mockReset().mockResolvedValue(undefined);
    mocks.collectionRemoveFile.mockReset().mockResolvedValue(undefined);
  });

  it("queues the open file when clicked", async () => {
    renderDetail();

    const btn = await toggle();
    expect(btn.getAttribute("aria-label")).toBe("Add to Watch Later");
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mocks.collectionAddFile).toHaveBeenCalledWith(
        "watch-later",
        1,
        WS_ID,
      ),
    );
  });

  it("unqueues a file that is already listed", async () => {
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [
        watchLaterCollection([{ workspaceId: WS_ID, fileId: 1, addedAt: 0 }]),
      ],
    });
    renderDetail();

    const btn = await toggle();
    expect(btn.getAttribute("aria-label")).toBe("Remove from Watch Later");
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mocks.collectionRemoveFile).toHaveBeenCalledWith(
        "watch-later",
        1,
        WS_ID,
      ),
    );
  });

  it('toggles from the "W" shortcut', async () => {
    renderDetail();
    await toggle();

    fireEvent.keyDown(window, { code: "KeyW" });

    await waitFor(() =>
      expect(mocks.collectionAddFile).toHaveBeenCalledWith(
        "watch-later",
        1,
        WS_ID,
      ),
    );
  });

  it('leaves "w" alone while a text field has focus', async () => {
    renderDetail();
    await toggle();

    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      input.focus();
      fireEvent.keyDown(window, { code: "KeyW" });
    } finally {
      // A focused input left behind would suppress the key in later tests.
      input.remove();
    }

    // react-query only reaches the mutationFn a microtask later, so asserting
    // straight after the fireEvent would pass whether or not the guard exists.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.collectionAddFile).not.toHaveBeenCalled();
  });

  it("follows the silent auto-removal when the file is played", async () => {
    // Viewing an image counts as a play, so the main process consumes the Watch
    // Later entry without broadcasting. The toggle must not stay stuck showing
    // the file as queued for the rest of the visit.
    mocks.fileGet.mockResolvedValue(sampleImageDetail);
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [
        watchLaterCollection([{ workspaceId: WS_ID, fileId: 1, addedAt: 0 }]),
      ],
    });
    renderDetail();

    const btn = await toggle();
    await waitFor(() => expect(mocks.fileRecordPlay).toHaveBeenCalled());
    await waitFor(() =>
      expect(btn.getAttribute("aria-label")).toBe("Add to Watch Later"),
    );
    // Patched in place: no refetch, so the nav order under the open file holds.
    expect(mocks.workspacesList).toHaveBeenCalledTimes(1);
  });
});
