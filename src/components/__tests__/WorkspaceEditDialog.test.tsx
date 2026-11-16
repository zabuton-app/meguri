// The workspace edit dialog's excluded folders (#282): listed with the ones
// not on disk marked, taken off the list only when the dialog is saved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ExcludedFolders } from "@shared/ipc/channels";
import { WorkspaceEditDialog } from "@/components/WorkspaceEditDialog";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  scanExclusionsFolders: vi.fn<(id: string) => Promise<ExcludedFolders>>(),
  scanExclusionsRemoveFolders:
    vi.fn<(id: string, paths: string[]) => Promise<ExcludedFolders>>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    scanExclusionsFolders: (id: string) => mocks.scanExclusionsFolders(id),
    scanExclusionsRemoveFolders: (id: string, paths: string[]) =>
      mocks.scanExclusionsRemoveFolders(id, paths),
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
const includeButton = (path: string) =>
  screen.getByRole("button", { name: `Include ${path} in scans again` });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scanExclusionsFolders.mockResolvedValue({
    folders: [
      { path: "cache", found: true },
      { path: "old/renders", found: false },
    ],
  });
  mocks.scanExclusionsRemoveFolders.mockResolvedValue({
    folders: [{ path: "old/renders", found: false }],
  });
});

describe("WorkspaceEditDialog excluded folders", () => {
  it("lists them, marking the ones not found", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    const [cache, renders] = within(list()).getAllByRole("listitem");
    expect(cache.textContent).not.toContain("Not found");
    expect(renders.textContent).toContain("Not found");
    expect(mocks.scanExclusionsFolders).toHaveBeenCalledWith("ws-1");
  });

  it("takes a folder off the list when the dialog is saved", async () => {
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("cache"));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(mocks.scanExclusionsRemoveFolders).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Folders taken off the list are scanned again from the next scan.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.scanExclusionsRemoveFolders).toHaveBeenCalledWith("ws-1", [
        "cache",
      ]),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps every folder when the dialog is canceled", async () => {
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("cache"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.scanExclusionsRemoveFolders).not.toHaveBeenCalled();
  });

  it("says when there are none", async () => {
    mocks.scanExclusionsFolders.mockResolvedValueOnce({ folders: [] });
    renderDialog();
    expect(
      await screen.findByText(
        "No folders. Right-click a folder in the folder view to exclude it.",
      ),
    ).toBeTruthy();
  });

  it("says when they cannot be read", async () => {
    mocks.scanExclusionsFolders.mockRejectedValueOnce(new Error("down"));
    renderDialog();
    expect(
      await screen.findByText("Couldn't read the excluded folders."),
    ).toBeTruthy();
  });

  it("tells the user when taking them off fails", async () => {
    mocks.scanExclusionsRemoveFolders.mockRejectedValueOnce(new Error("down"));
    renderDialog();
    await waitFor(() => expect(list().children).toHaveLength(2));

    fireEvent.click(includeButton("cache"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't update the excluded folders",
      ),
    );
  });
});
