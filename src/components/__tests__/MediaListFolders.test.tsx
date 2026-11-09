// The list shown by folder: folder rows ahead of the files, the same contract
// as MediaGrid's folder cards.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import "@/test/mockVirtualizer";
import { MediaList } from "@/components/MediaList";
import { defaultWorkspacesList, sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  workspacesList: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: { workspacesList: () => mocks.workspacesList() },
  ALL_ID: "__all__",
}));

const folder = (name: string, subfolders = 0) => ({
  name,
  path: name,
  count: 3,
  subfolders,
  previews: [sampleFileRow],
});

function renderList(props: Partial<Parameters<typeof MediaList>[0]> = {}) {
  return renderWithProviders(
    <MediaList
      items={[sampleFileRow]}
      mediaBase="http://127.0.0.1:17345"
      workspaceId={WS_ID}
      loading={false}
      {...props}
    />,
  );
}

describe("MediaList by folder", () => {
  beforeEach(() => {
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  });

  it("draws folder rows ahead of the files and opens them", async () => {
    const onOpenFolder = vi.fn();
    renderList({
      folders: [folder("Movie", 2), folder("Photos")],
      onOpenFolder,
    });
    const rows = await screen.findAllByTestId("folder-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Subfolders: 2")).toBeTruthy();
    // Folder rows come before the file's name in the document.
    const file = screen.getByText("sample.mp4");
    expect(
      rows[1].compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    expect(onOpenFolder).toHaveBeenCalledWith("Movie");
  });

  it("opens the focused folder row with Enter", async () => {
    const onOpenFolder = vi.fn();
    renderList({ folders: [folder("Movie")], onOpenFolder, navActive: true });
    await screen.findByTestId("folder-row");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    });
    expect(onOpenFolder).toHaveBeenCalledWith("Movie");
  });

  it("drops the folder rows from a window that starts past the top", async () => {
    renderList({ folders: [folder("Movie")], listOffset: 100 });
    await screen.findByText("sample.mp4");
    expect(screen.queryByTestId("folder-row")).toBeNull();
  });

  it("says a folder search found nothing", () => {
    renderList({ items: [], inFolder: true });
    expect(screen.getByText("Nothing in this folder matches")).toBeTruthy();
  });
});
