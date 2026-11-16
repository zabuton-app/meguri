// Settings: each workspace's excluded folders at a glance (#529).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ExcludedFolders } from "@shared/ipc/channels";
import { FolderExclusionsSection } from "@/routes/Settings/FolderExclusionsSection";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  scanExclusionsFolders: vi.fn<(id: string) => Promise<ExcludedFolders>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    workspacesList: () =>
      Promise.resolve({
        workspaces: [
          { id: "__all__", path: "", label: "All", active: false },
          { id: "ws-1", path: "/media", label: "media", active: true },
          { id: "ws-2", path: "/nas", label: "nas", active: false },
        ],
        active: "ws-1",
        collections: [],
      }),
    scanExclusionsFolders: (id: string) => mocks.scanExclusionsFolders(id),
  },
}));

beforeEach(() => {
  mocks.scanExclusionsFolders.mockImplementation((id) =>
    Promise.resolve({
      folders:
        id === "ws-1"
          ? [
              { path: "cache", absPath: "/media/cache", found: true },
              { path: "old", absPath: "/media/old", found: false },
            ]
          : [],
    }),
  );
});

describe("FolderExclusionsSection", () => {
  it("counts each workspace's folders, and the ones not found", async () => {
    renderWithProviders(<FolderExclusionsSection />);
    const media = await screen.findByText("media");
    const [first, second] = screen.getAllByRole("listitem");
    await waitFor(() => expect(first.textContent).toContain("2 folders"));
    expect(first.textContent).toContain("1 not found");
    expect(media).toBeTruthy();
    await waitFor(() => expect(second.textContent).toContain("None"));
    // Not "All", which has no folders of its own.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(mocks.scanExclusionsFolders).not.toHaveBeenCalledWith("__all__");
  });

  it("opens the workspace's edit dialog to manage them", async () => {
    renderWithProviders(<FolderExclusionsSection />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Manage the excluded folders of media",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getAllByRole("listitem")).toHaveLength(2),
    );
  });
});
