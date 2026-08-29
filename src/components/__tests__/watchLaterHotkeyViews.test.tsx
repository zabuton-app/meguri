// The "W" shortcut across the list and table views. The grid has its own suite
// (MediaGrid.test.tsx); these two hang the ref off the focused row differently,
// so they get their own coverage of "the key reaches the right file".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@/test/mockVirtualizer";
import { MediaList } from "@/components/MediaList";
import { MediaTable } from "@/components/MediaTable";
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

const second = { ...sampleFileRow, id: 2, relPath: "videos/second.mp4" };

const commonProps = {
  items: [sampleFileRow, second],
  mediaBase: "http://127.0.0.1:17345",
  workspaceId: WS_ID,
  loading: false,
  thumbVersion: {},
  navActive: true,
};

const views = {
  list: () => renderWithProviders(<MediaList {...commonProps} />),
  table: () => renderWithProviders(<MediaTable {...commonProps} />),
};

describe.each(Object.entries(views))(
  '"W" shortcut in the %s view',
  (_name, render) => {
    beforeEach(() => {
      for (const m of Object.values(mocks)) m.mockReset();
      mocks.fileSetFavorite.mockResolvedValue(undefined);
      mocks.fileSetRating.mockResolvedValue(undefined);
      mocks.collectionAddFile.mockResolvedValue(undefined);
      mocks.collectionRemoveFile.mockResolvedValue(undefined);
      mocks.workspacesList.mockResolvedValue({
        ...defaultWorkspacesList,
        collections: [
          {
            id: "watch-later",
            name: "Watch Later",
            emoji: "🕒",
            active: false,
            items: [],
            createdAt: 0,
            updatedAt: 0,
            locked: true,
          },
        ],
      });
    });

    // The toggles stay disabled until workspaces_list resolves (they need the id).
    const ready = async () => {
      const btns = await screen.findAllByRole("button", {
        name: /Watch Later/,
      });
      await waitFor(() => expect(btns[0].hasAttribute("disabled")).toBe(false));
    };

    it("follows the focused row", async () => {
      render();
      await ready();

      // Nothing focused yet: the key must not pick a row on its own.
      fireEvent.keyDown(window, { code: "KeyW" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.collectionAddFile).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { code: "ArrowDown" });
      fireEvent.keyDown(window, { code: "KeyW" });
      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          WS_ID,
        ),
      );

      // Moving on must move the shortcut's target with it.
      fireEvent.keyDown(window, { code: "ArrowDown" });
      fireEvent.keyDown(window, { code: "KeyW" });
      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          second.id,
          WS_ID,
        ),
      );
    });

    it("steps back to the previous row's toggle", async () => {
      // Guards the conditional ref: React detaches every changed ref before
      // attaching any, so moving backwards must not leave the ref nulled out.
      render();
      await ready();

      fireEvent.keyDown(window, { code: "ArrowDown" });
      fireEvent.keyDown(window, { code: "ArrowDown" });
      fireEvent.keyDown(window, { code: "ArrowUp" });
      fireEvent.keyDown(window, { code: "KeyW" });

      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          sampleFileRow.id,
          WS_ID,
        ),
      );
    });
  },
);
