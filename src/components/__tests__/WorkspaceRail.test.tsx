import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { defaultAppStatus, defaultWorkspacesList } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  workspaceSwitch: vi.fn(),
  workspaceAdd: vi.fn(),
  workspaceRemove: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    workspaceSwitch: (id: string) => mocks.workspaceSwitch(id),
    workspaceAdd: () => mocks.workspaceAdd(),
    workspaceRemove: (input: { id: string }) => mocks.workspaceRemove(input.id),
    workspaceReorder: vi.fn().mockResolvedValue(undefined),
    collectionCreate: vi.fn().mockResolvedValue({ id: "c1" }),
    collectionRemove: vi.fn().mockResolvedValue(undefined),
    collectionReorder: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onWorkspaceChanged: vi.fn().mockResolvedValue(() => {}),
    onScanDone: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

describe("WorkspaceRail", () => {
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.workspaceSwitch.mockResolvedValue(undefined);
    mocks.workspaceAdd.mockResolvedValue({ added: false });
    mocks.workspaceRemove.mockResolvedValue(undefined);
    mocks.workspaceSwitch.mockClear();
  });

  it("renders workspace entries from IPC", async () => {
    renderWithProviders(<WorkspaceRail />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Media" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Other" })).toBeTruthy();
    });
  });

  it("switches workspace when an inactive entry is clicked", async () => {
    renderWithProviders(<WorkspaceRail />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Other" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Other" }));

    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-other"),
    );
  });

  it("does not switch when clicking the already-active workspace", async () => {
    renderWithProviders(<WorkspaceRail />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Media" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    expect(mocks.workspaceSwitch).not.toHaveBeenCalled();
  });

  describe("Watch Later", () => {
    const watchLater = {
      id: "watch-later",
      name: "Watch Later",
      emoji: "🕒",
      active: false,
      items: [],
      createdAt: 0,
      updatedAt: 0,
      locked: true,
    };
    const userCollection = {
      id: "c1",
      name: "Favourites",
      active: false,
      items: [],
      createdAt: 0,
      updatedAt: 0,
      locked: false,
    };

    beforeEach(() => {
      mocks.workspacesList.mockResolvedValue({
        ...defaultWorkspacesList,
        collections: [watchLater, userCollection],
      });
    });

    it("renders the locked collection with its translated name", async () => {
      renderWithProviders(<WorkspaceRail />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Watch Later" }),
        ).toBeTruthy();
      });
    });

    it("switches to the collection when clicked", async () => {
      renderWithProviders(<WorkspaceRail />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Watch Later" }),
        ).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Watch Later" }));

      await waitFor(() =>
        expect(mocks.workspaceSwitch).toHaveBeenCalledWith(
          "collection:watch-later",
        ),
      );
    });

    it("renders directly after the All entry and before user collections", async () => {
      const { container } = renderWithProviders(<WorkspaceRail />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Watch Later" }),
        ).toBeTruthy();
      });

      const labels = Array.from(
        container.querySelectorAll("button[aria-label]"),
      ).map((el) => el.getAttribute("aria-label"));
      expect(labels.indexOf("Watch Later")).toBe(labels.indexOf("All") + 1);
      expect(labels.indexOf("Watch Later")).toBeLessThan(
        labels.indexOf("Favourites"),
      );
    });

    it("carries no remove affordance, unlike user collections", async () => {
      renderWithProviders(<WorkspaceRail />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Watch Later" }),
        ).toBeTruthy();
      });

      // User collections render a hover × button titled "Delete collection";
      // the locked one must not, so there is exactly one such button.
      expect(screen.getAllByTitle("Delete collection")).toHaveLength(1);
    });

    it("is not registered as a draggable sortable item", async () => {
      renderWithProviders(<WorkspaceRail />);

      const button = await screen.findByRole("button", {
        name: "Watch Later",
      });
      // dnd-kit's useSortable applies these to every draggable element.
      expect(button.getAttribute("aria-roledescription")).toBeNull();
      expect(button.getAttribute("aria-describedby")).toBeNull();
    });
  });
});
