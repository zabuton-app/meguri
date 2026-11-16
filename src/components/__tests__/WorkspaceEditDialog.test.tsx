// The workspace edit dialog's excluded folders (#282): listed with the ones
// not on disk marked, taken off the list only when the dialog is saved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ExcludedFolders, PickedFolder } from "@shared/ipc/channels";
import { WorkspaceEditDialog } from "@/components/WorkspaceEditDialog";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  scanExclusionsFolders: vi.fn<(id: string) => Promise<ExcludedFolders>>(),
  scanExclusionsUpdateFolders:
    vi.fn<
      (
        id: string,
        change: { add: string[]; remove: string[] },
      ) => Promise<ExcludedFolders>
    >(),
  scanExclusionsPickFolder: vi.fn<(id: string) => Promise<PickedFolder>>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    scanExclusionsFolders: (id: string) => mocks.scanExclusionsFolders(id),
    scanExclusionsUpdateFolders: (
      id: string,
      change: { add: string[]; remove: string[] },
    ) => mocks.scanExclusionsUpdateFolders(id, change),
    scanExclusionsPickFolder: (id: string) =>
      mocks.scanExclusionsPickFolder(id),
    workspaceSetEmoji: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: (m: string) => mocks.toastError(m), success: vi.fn() },
}));

const workspace = {
  id: "ws-1",
  path: "/media",
  label: "media",
  active: true,
};

function renderDialog(onOpenChange = vi.fn()) {
  renderWithProviders(
    <WorkspaceEditDialog
      open
      onOpenChange={onOpenChange}
      workspace={workspace}
    />,
  );
  return { onOpenChange };
}

const list = () => screen.getByRole("list");
const includeButton = (absPath: string) =>
  screen.getByRole("button", { name: `Include ${absPath} in scans again` });
const undoButton = (absPath: string) =>
  screen.getByRole("button", { name: `Undo the change to ${absPath}` });
const items = () => within(list()).getAllByRole("listitem");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scanExclusionsFolders.mockResolvedValue({
    folders: [
      { path: "cache", absPath: "/media/cache", found: true },
      { path: "old/renders", absPath: "/media/old/renders", found: false },
    ],
  });
  mocks.scanExclusionsPickFolder.mockResolvedValue({ status: "canceled" });
  mocks.scanExclusionsUpdateFolders.mockResolvedValue({
    folders: [
      { path: "old/renders", absPath: "/media/old/renders", found: false },
    ],
  });
});

describe("WorkspaceEditDialog excluded folders", () => {
  it("lists them where they are on disk, marking the ones not found", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    const [cache, renders] = within(list()).getAllByRole("listitem");
    // Where, not only the name: no other folder of that name is excluded.
    expect(cache.textContent).toContain("/media/cache");
    expect(renders.textContent).toContain("/media/old/renders");
    expect(cache.textContent).not.toContain("Not found");
    expect(renders.textContent).toContain("Not found");
    expect(mocks.scanExclusionsFolders).toHaveBeenCalledWith("ws-1");
  });

  it("takes a folder off the list when the dialog is saved", async () => {
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("/media/cache"));
    // Still listed, marked, until the dialog is saved.
    expect(items()).toHaveLength(2);
    expect(items()[0].textContent).toContain("Included on save");
    expect(screen.getByTestId("excluded-folder-count").textContent).toBe("1");
    expect(mocks.scanExclusionsUpdateFolders).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Folders taken off the list are scanned again from the next scan.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.scanExclusionsUpdateFolders).toHaveBeenCalledWith("ws-1", {
        add: [],
        remove: ["cache"],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("undoes taking a folder off before the dialog is saved", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("/media/cache"));
    fireEvent.click(undoButton("/media/cache"));
    expect(items()[0].textContent).not.toContain("Included on save");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.scanExclusionsUpdateFolders).not.toHaveBeenCalled();
  });

  it("offers taking a folder not on disk off the list", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));
    expect(
      screen.getByRole("button", {
        name: "Remove /media/old/renders from the list",
      }).textContent,
    ).toBe("Remove");
  });

  it("adds a picked folder when the dialog is saved", async () => {
    mocks.scanExclusionsPickFolder.mockResolvedValueOnce({
      status: "picked",
      path: "work/proxy",
      absPath: "/media/work/proxy",
    });
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(items()).toHaveLength(3));
    expect(items()[2].textContent).toContain("Excluded on save");
    expect(mocks.scanExclusionsPickFolder).toHaveBeenCalledWith("ws-1");
    expect(mocks.scanExclusionsUpdateFolders).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.scanExclusionsUpdateFolders).toHaveBeenCalledWith("ws-1", {
        add: ["work/proxy"],
        remove: [],
      }),
    );
  });

  it("refuses a picked folder outside the workspace", async () => {
    mocks.scanExclusionsPickFolder.mockResolvedValueOnce({
      status: "outside",
    });
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Pick a folder inside the workspace",
      ),
    );
    expect(items()).toHaveLength(2);
  });

  it("keeps every folder when the dialog is canceled", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("/media/cache"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.scanExclusionsUpdateFolders).not.toHaveBeenCalled();
  });

  it("says when there are none", async () => {
    mocks.scanExclusionsFolders.mockResolvedValueOnce({ folders: [] });
    renderDialog();
    expect(
      await screen.findByText(
        "No folders. Right-click a folder in the folder view, or use “Add folder”.",
      ),
    ).toBeTruthy();
  });

  it("says when they cannot be read", async () => {
    mocks.scanExclusionsFolders.mockRejectedValueOnce(new Error("down"));
    renderDialog();
    expect(
      await screen.findByText("Couldn't read the excluded folders."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(list().children).toHaveLength(2));
  });

  it("tells the user when taking them off fails", async () => {
    mocks.scanExclusionsUpdateFolders.mockRejectedValueOnce(new Error("down"));
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("/media/cache"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't update the excluded folders",
      ),
    );
  });
});
