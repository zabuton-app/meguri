// The right-click menu on a list view's files: which actions it offers for
// which file, what it acts on (the clicked file or the selection), and that
// its actions write through the same channels as the command menu's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { FavoriteButton } from "@/components/FavoriteButton";
import { FileContextMenu } from "@/components/FileContextMenu";
import { useSelection } from "@/components/SelectionContext";
import { setFocusedFile } from "@/hooks/useFocusedFile";
import { resetFileFxForTest } from "@/lib/fileFxStore";
import { mediaSortId } from "@/lib/mediaSortId";
import { sampleFileRow } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow } from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  filesBulkMeta: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  collectionSetMembership: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  copyFilePath: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  openExternal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    workspacesList: vi.fn().mockResolvedValue({
      workspaces: [],
      active: null,
      collections: [
        {
          id: "watch-later",
          name: "Watch Later",
          active: false,
          locked: true,
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "trips",
          name: "Trips",
          active: false,
          locked: false,
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    }),
    filesBulkMeta: (...args: unknown[]) => mocks.filesBulkMeta(...args),
    collectionSetMembership: (...args: unknown[]) =>
      mocks.collectionSetMembership(...args),
    copyFilePath: (...args: unknown[]) => mocks.copyFilePath(...args),
    openExternal: (...args: unknown[]) => mocks.openExternal(...args),
    openFolder: vi.fn().mockResolvedValue(undefined),
  },
  ALL_ID: "__all__",
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filesBulkMeta.mockResolvedValue({ files: 1, skipped: 0 });
  mocks.collectionSetMembership.mockResolvedValue({ changed: 1 });
  mocks.copyFilePath.mockResolvedValue(undefined);
  mocks.openExternal.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => setFocusedFile(null));
  resetFileFxForTest();
});

const file = (id: number, over: Partial<FileRow> = {}): FileRow => ({
  ...sampleFileRow,
  id,
  relPath: `videos/clip-${id}.mp4`,
  ...over,
});

/** The bulk channels' targets: file ids grouped by workspace. */
const targets = (...files: FileRow[]) => [
  { workspaceId: files[0].workspaceId, fileIds: files.map((f) => f.id) },
];

/** Builds a selection the way a Ctrl+click on each card would. */
function Select({ rows }: { rows: FileRow[] }) {
  const { click } = useSelection();
  useEffect(() => {
    rows.forEach((row, i) =>
      click(row, i, { ctrlKey: true, shiftKey: false, metaKey: false }),
    );
  }, [rows, click]);
  return null;
}

function renderView(
  items: FileRow[],
  {
    selected = [],
    active = true,
  }: { selected?: FileRow[]; active?: boolean } = {},
) {
  return renderWithProviders(
    <>
      <Select rows={selected} />
      <FileContextMenu items={items} mediaBase="http://media" active={active}>
        <div data-testid="view">
          {items.map((f) => (
            <div
              key={mediaSortId(f)}
              data-file-key={mediaSortId(f)}
              data-testid={`card-${f.id}`}
            >
              {f.relPath}
            </div>
          ))}
          <div data-testid="gap" />
        </div>
      </FileContextMenu>
    </>,
  );
}

const menu = () => screen.getByRole("menu");
const item = (name: string | RegExp) =>
  within(menu()).getByRole("menuitem", { name });

describe("FileContextMenu", () => {
  it("offers the single-file actions for a right-clicked video", () => {
    renderView([file(1)]);
    fireEvent.contextMenu(screen.getByTestId("card-1"));

    const labels = within(menu())
      .getAllByRole("menuitem")
      .map((el) => el.textContent ?? "");
    for (const name of [
      "Open",
      "Open details without playing",
      "Open externally",
      "Add to favorites",
      "Copy File Path",
      "Delete From Index",
    ]) {
      expect(labels.some((l) => l.startsWith(name))).toBe(true);
    }
    expect(
      within(menu()).queryByRole("menuitem", { name: /copy image/i }),
    ).toBeNull();
  });

  it("offers copying the image only for an image", () => {
    renderView([file(2, { kind: "image", relPath: "photos/a.png" })]);
    fireEvent.contextMenu(screen.getByTestId("card-2"));
    expect(item(/copy image/i)).toBeTruthy();
  });

  it("opens no menu away from a file", () => {
    renderView([file(1)]);
    fireEvent.contextMenu(screen.getByTestId("gap"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("writes through the same channels as the command menu", async () => {
    const f = file(3);
    renderView([f]);

    fireEvent.contextMenu(screen.getByTestId("card-3"));
    fireEvent.click(item(/^add to favorites/i));
    await waitFor(() =>
      expect(mocks.filesBulkMeta).toHaveBeenCalledWith(targets(f), {
        favorite: true,
      }),
    );

    fireEvent.contextMenu(screen.getByTestId("card-3"));
    fireEvent.click(item(/copy file path/i));
    await waitFor(() =>
      expect(mocks.copyFilePath).toHaveBeenCalledWith(3, f.workspaceId),
    );

    fireEvent.contextMenu(screen.getByTestId("card-3"));
    fireEvent.click(item(/open externally/i));
    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledWith(3, f.workspaceId),
    );
  });

  it("sets the rating from its submenu", async () => {
    const f = file(4);
    renderView([f]);
    fireEvent.contextMenu(screen.getByTestId("card-4"));
    fireEvent.click(item(/^rating/i));
    const sub = await screen.findAllByRole("menu");
    fireEvent.click(
      within(sub[sub.length - 1]).getByRole("menuitem", { name: /3 stars/i }),
    );
    await waitFor(() =>
      expect(mocks.filesBulkMeta).toHaveBeenCalledWith(targets(f), {
        rating: 3,
      }),
    );
  });

  it("plays the card's own favorite effect for a change made from it", () => {
    const f = file(21);
    renderWithProviders(
      <FileContextMenu items={[f]} mediaBase="http://media" active>
        <div data-file-key={mediaSortId(f)} data-testid="card-21">
          <FavoriteButton
            fileId={f.id}
            workspaceId={f.workspaceId}
            favorite={f.favorite}
          />
        </div>
      </FileContextMenu>,
    );
    const card = screen.getByTestId("card-21");
    expect(card.querySelector(".fx-pop")).toBeNull();

    fireEvent.contextMenu(card);
    fireEvent.click(item(/^add to favorites/i));
    expect(card.querySelector(".fx-pop")).not.toBeNull();
  });

  it("plays no effect for a bulk edit", () => {
    const a = file(22);
    const b = file(23);
    renderWithProviders(
      <>
        <Select rows={[a, b]} />
        <FileContextMenu items={[a, b]} mediaBase="http://media" active>
          {[a, b].map((f) => (
            <div
              key={f.id}
              data-file-key={mediaSortId(f)}
              data-testid={`card-${f.id}`}
            >
              <FavoriteButton
                fileId={f.id}
                workspaceId={f.workspaceId}
                favorite={f.favorite}
              />
            </div>
          ))}
        </FileContextMenu>
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("card-22"));
    fireEvent.click(item(/^add to favorites/i));
    expect(document.querySelector(".fx-pop")).toBeNull();
  });

  it("acts on the whole selection when the clicked file is in it", async () => {
    const a = file(5);
    const b = file(6);
    renderView([a, b], { selected: [a, b] });

    fireEvent.contextMenu(screen.getByTestId("card-6"));
    expect(screen.getByTestId("file-menu-count").textContent).toContain(
      "2 selected",
    );
    // One-file actions are not offered for a selection.
    expect(
      within(menu()).queryByRole("menuitem", { name: /copy file path/i }),
    ).toBeNull();
    expect(item(/exit selection/i)).toBeTruthy();

    fireEvent.click(item(/^add to favorites/i));
    await waitFor(() =>
      expect(mocks.filesBulkMeta).toHaveBeenCalledWith(targets(a, b), {
        favorite: true,
      }),
    );
  });

  it("acts on the clicked file alone when it is outside the selection", () => {
    const a = file(7);
    const b = file(8);
    renderView([a, b], { selected: [a] });

    fireEvent.contextMenu(screen.getByTestId("card-8"));
    expect(screen.queryByTestId("file-menu-count")).toBeNull();
    expect(item(/copy file path/i)).toBeTruthy();
  });

  it("opens on the focused file from the menu key", async () => {
    const f = file(9);
    renderView([file(1), f]);
    act(() => setFocusedFile(f));

    fireEvent.keyDown(window, { key: "F10", shiftKey: true });
    fireEvent.click(item(/copy file path/i));
    await waitFor(() =>
      expect(mocks.copyFilePath).toHaveBeenCalledWith(9, f.workspaceId),
    );
  });

  it("leaves the menu key alone while the view is in the background", () => {
    const f = file(9);
    renderView([f], { active: false });
    act(() => setFocusedFile(f));

    fireEvent.keyDown(window, { key: "ContextMenu" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
