import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { defaultAppStatus, defaultWorkspacesList } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { FILE_DRAG_MIME } from "@/lib/fileDrag";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  workspaceSwitch: vi.fn(),
  workspaceAdd: vi.fn(),
  workspaceRemove: vi.fn(),
  workspaceAddDropped: vi.fn(),
  collectionSetMembership: vi.fn(),
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), toasts),
  Toaster: () => null,
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    aboutInfo: vi.fn().mockResolvedValue({
      version: "0.9.0",
      buildId: "testbuild",
      electron: "",
      chrome: "",
      node: "",
    }),
    workspacesList: () => mocks.workspacesList(),
    workspaceSwitch: (id: string) => mocks.workspaceSwitch(id),
    workspaceAdd: () => mocks.workspaceAdd(),
    workspaceRemove: (input: { id: string }) => mocks.workspaceRemove(input.id),
    workspaceReorder: vi.fn().mockResolvedValue(undefined),
    collectionCreate: vi.fn().mockResolvedValue({ id: "c1" }),
    collectionRemove: vi.fn().mockResolvedValue(undefined),
    collectionReorder: vi.fn().mockResolvedValue(undefined),
    workspaceAddDropped: (file: File) => mocks.workspaceAddDropped(file),
    collectionSetMembership: (...args: unknown[]) =>
      mocks.collectionSetMembership(...args),
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

  describe("drag and drop", () => {
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
    const files = [
      { workspaceId: "ws-a", fileId: 1 },
      { workspaceId: "ws-b", fileId: 2 },
    ];
    const fileDrag = () => ({
      types: [FILE_DRAG_MIME],
      getData: (type: string) =>
        type === FILE_DRAG_MIME ? JSON.stringify(files) : "",
      dropEffect: "none",
    });

    beforeEach(() => {
      mocks.workspacesList.mockResolvedValue({
        ...defaultWorkspacesList,
        collections: [watchLater, userCollection],
      });
      mocks.collectionSetMembership.mockReset();
      mocks.collectionSetMembership.mockResolvedValue({ changed: 2 });
      mocks.workspaceAddDropped.mockReset();
      mocks.workspaceAddDropped.mockResolvedValue({
        added: true,
        id: "ws-new",
        scanJobId: "job-1",
      });
    });

    it("adds dropped files to a user collection", async () => {
      renderWithProviders(<WorkspaceRail />);
      const target = await screen.findByRole("button", { name: "Favourites" });

      fireEvent.dragEnter(target, { dataTransfer: fileDrag() });
      fireEvent.dragOver(target, { dataTransfer: fileDrag() });
      fireEvent.drop(target, { dataTransfer: fileDrag() });

      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalledWith(
          "c1",
          [
            { workspaceId: "ws-a", fileIds: [1] },
            { workspaceId: "ws-b", fileIds: [2] },
          ],
          "add",
        ),
      );
    });

    it("words a single added file in the singular", async () => {
      mocks.collectionSetMembership.mockResolvedValue({ changed: 1 });
      renderWithProviders(<WorkspaceRail />);
      const target = await screen.findByRole("button", { name: "Favourites" });

      fireEvent.drop(target, { dataTransfer: fileDrag() });

      await waitFor(() =>
        expect(toasts.success).toHaveBeenCalledWith(
          'Added 1 file to "Favourites"',
        ),
      );
    });

    it("words a single file already in the collection in the singular", async () => {
      mocks.collectionSetMembership.mockResolvedValue({ changed: 0 });
      renderWithProviders(<WorkspaceRail />);
      const target = await screen.findByRole("button", { name: "Favourites" });
      const single = {
        ...fileDrag(),
        getData: () => JSON.stringify([{ workspaceId: "ws-a", fileId: 1 }]),
      };

      fireEvent.drop(target, { dataTransfer: single });

      await waitFor(() =>
        expect(toasts.info).toHaveBeenCalledWith('Already in "Favourites"'),
      );
    });

    it("adds dropped files to Watch Later", async () => {
      renderWithProviders(<WorkspaceRail />);
      const target = await screen.findByRole("button", {
        name: "Watch Later",
      });

      fireEvent.drop(target, { dataTransfer: fileDrag() });

      await waitFor(() =>
        expect(mocks.collectionSetMembership).toHaveBeenCalledWith(
          "watch-later",
          expect.any(Array),
          "add",
        ),
      );
    });

    it("does not accept files on workspaces or All", async () => {
      renderWithProviders(<WorkspaceRail />);
      const workspace = await screen.findByRole("button", { name: "Media" });
      const all = screen.getByRole("button", { name: "All" });

      for (const target of [workspace, all]) {
        const dataTransfer = { ...fileDrag(), dropEffect: "unset" };
        fireEvent.dragOver(target, { dataTransfer });
        // Shown to the user as a refused drop.
        expect(dataTransfer.dropEffect).toBe("none");
        fireEvent.drop(target, { dataTransfer: fileDrag() });
      }
      expect(mocks.collectionSetMembership).not.toHaveBeenCalled();
    });

    it("confirms and registers a folder dropped from the OS", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });
      const dir = new File([], "Movies");
      const osDrag = () => ({
        types: ["Files"],
        items: [
          {
            kind: "file",
            getAsFile: () => dir,
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
        ],
        dropEffect: "none",
      });

      fireEvent.dragEnter(window, { dataTransfer: osDrag() });
      expect(await screen.findByTestId("folder-drop-overlay")).toBeTruthy();

      fireEvent.drop(window, { dataTransfer: osDrag() });
      await waitFor(() =>
        expect(screen.queryByTestId("folder-drop-overlay")).toBeNull(),
      );

      expect(
        await screen.findByText('Add "Movies" as a workspace and scan it?'),
      ).toBeTruthy();
      expect(mocks.workspaceAddDropped).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() =>
        expect(mocks.workspaceAddDropped).toHaveBeenCalledWith(dir),
      );
    });

    it("does not register dropped files that are not folders", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });

      fireEvent.drop(window, {
        dataTransfer: {
          types: ["Files"],
          items: [
            {
              kind: "file",
              getAsFile: () => new File([], "clip.mp4"),
              webkitGetAsEntry: () => ({ isDirectory: false }),
            },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText(/as a workspace and scan it\?/)).toBeNull();
      expect(mocks.workspaceAddDropped).not.toHaveBeenCalled();
      expect(toasts.info).toHaveBeenCalledWith(
        "Meguri indexes folders, not individual files. Drop a folder instead.",
      );
    });

    const osDrop = (...dirs: File[]) => ({
      dataTransfer: {
        types: ["Files"],
        items: dirs.map((dir) => ({
          kind: "file",
          getAsFile: () => dir,
          webkitGetAsEntry: () => ({ isDirectory: true }),
        })),
      },
    });

    it("queues a folder dropped while a confirm is still open", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });
      const first = new File([], "First");
      const second = new File([], "Second");

      fireEvent.drop(window, osDrop(first));
      await screen.findByText('Add "First" as a workspace and scan it?');
      // A second drop must not replace the open prompt and strand the first.
      fireEvent.drop(window, osDrop(second));
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() =>
        expect(mocks.workspaceAddDropped).toHaveBeenCalledWith(first),
      );

      await screen.findByText('Add "Second" as a workspace and scan it?');
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() =>
        expect(mocks.workspaceAddDropped).toHaveBeenCalledWith(second),
      );
      expect(mocks.workspaceAddDropped).toHaveBeenCalledTimes(2);
    });

    it("reports a dropped path main refused as not a folder", async () => {
      mocks.workspaceAddDropped.mockResolvedValue({
        added: false,
        notDirectory: true,
      });
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });

      fireEvent.drop(window, osDrop(new File([], "Gone")));
      await screen.findByText('Add "Gone" as a workspace and scan it?');
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() =>
        expect(toasts.error).toHaveBeenCalledWith(
          '"Gone" is not a folder, so it was not added',
        ),
      );
    });

    it("ignores an OS drag while an in-app drag is in progress", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });

      fireEvent.dragStart(document.body);
      fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
      expect(screen.queryByTestId("folder-drop-overlay")).toBeNull();
    });

    it("clears a stuck drop zone on the next pointer move", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });

      // An OS drag cancelled outside the window can end without a dragleave.
      fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
      expect(await screen.findByTestId("folder-drop-overlay")).toBeTruthy();
      fireEvent.mouseMove(window);
      await waitFor(() =>
        expect(screen.queryByTestId("folder-drop-overlay")).toBeNull(),
      );
    });

    it("leaves text dropped into an input to the browser", async () => {
      const { container } = renderWithProviders(
        <>
          <WorkspaceRail />
          <input aria-label="field" />
        </>,
      );
      await screen.findByRole("button", { name: "Media" });
      const input = container.querySelector("input")!;

      const handled = fireEvent.drop(input, {
        dataTransfer: { types: ["text/plain"], items: [] },
      });
      // Not cancelled: the browser inserts the text.
      expect(handled).toBe(true);
    });

    it("cancels a drop it does not handle, so the window never navigates", async () => {
      renderWithProviders(<WorkspaceRail />);
      await screen.findByRole("button", { name: "Media" });

      const handled = fireEvent.drop(window, {
        dataTransfer: { types: ["text/uri-list"], items: [] },
      });
      expect(handled).toBe(false);
    });
  });
});
