// The command menu's context-dependent groups: file actions for the focused
// file or the selection, recent searches, and the quick search row.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { CommandMenu } from "@/components/CommandMenu";
import { useSelection } from "@/components/SelectionContext";
import { useAudioActions, useAudioPlayer } from "@/audio/useAudioPlayer";
import { setFocusedFile } from "@/hooks/useFocusedFile";
import { resetRecentSearchesForTest } from "@/hooks/useRecentSearches";
import { RECENT_SEARCHES_KEY } from "@/lib/recentSearches";
import { sampleFileRow } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow } from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  filesBulkMeta: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  collectionSetMembership: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  copyFilePath: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fileDeleteFromIndex: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
        // Collection names need not be unique.
        {
          id: "trips-2",
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
    openFolder: vi.fn().mockResolvedValue(undefined),
    fileDeleteFromIndex: (...args: unknown[]) =>
      mocks.fileDeleteFromIndex(...args),
  },
  ALL_ID: "__all__",
}));

beforeAll(() => {
  // cmdk scrolls the highlighted row into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filesBulkMeta.mockResolvedValue({ files: 1, skipped: 0 });
  mocks.collectionSetMembership.mockResolvedValue({ changed: 1 });
  mocks.copyFilePath.mockResolvedValue(undefined);
  mocks.fileDeleteFromIndex.mockResolvedValue({
    id: 3,
    relPath: "videos/clip-3.mp4",
  });
});

afterEach(() => {
  act(() => setFocusedFile(null));
  resetRecentSearchesForTest();
});

const file = (id: number): FileRow => ({
  ...sampleFileRow,
  id,
  relPath: `videos/clip-${id}.mp4`,
});

function renderMenu(
  overrides: Partial<Parameters<typeof CommandMenu>[0]> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    ready: true,
    scanning: false,
    devToolsEnabled: false,
    onFocusSearch: vi.fn(),
    onScan: vi.fn(),
    onRebuild: vi.fn(),
    onSetView: vi.fn(),
    onToggleByFolder: vi.fn(),
    onDiscover: vi.fn(),
    onTags: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onOpenDevTools: vi.fn(),
    onApplySearch: vi.fn(),
    onApplySaved: vi.fn(),
    onQuickSearch: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<CommandMenu {...props} />) };
}

function baseProps(): Parameters<typeof CommandMenu>[0] {
  return {
    open: true,
    onOpenChange: vi.fn(),
    ready: true,
    scanning: false,
    devToolsEnabled: false,
    onFocusSearch: vi.fn(),
    onScan: vi.fn(),
    onRebuild: vi.fn(),
    onSetView: vi.fn(),
    onToggleByFolder: vi.fn(),
    onDiscover: vi.fn(),
    onTags: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onOpenDevTools: vi.fn(),
    onApplySearch: vi.fn(),
    onApplySaved: vi.fn(),
    onQuickSearch: vi.fn(),
  };
}

/** The menu with its open state held for real, so choosing a row closes it. */
function ClosingMenu() {
  const [open, setOpen] = useState(true);
  return <CommandMenu {...baseProps()} open={open} onOpenChange={setOpen} />;
}

function SelectionCount() {
  return <span data-testid="selection-count">{useSelection().count}</span>;
}

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

const input = () => screen.getByRole("combobox");

describe("file actions group", () => {
  it("is absent with nothing focused or selected", () => {
    renderMenu();
    expect(screen.queryByTestId("command-file-name")).toBeNull();
    expect(screen.queryByText("Copy File Path")).toBeNull();
  });

  it("names the focused file and acts on it", async () => {
    act(() => setFocusedFile(file(7)));
    const { props } = renderMenu();
    expect(screen.getByTestId("command-file-name").textContent).toContain(
      "clip-7.mp4",
    );

    fireEvent.click(screen.getByText("Copy File Path"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(mocks.copyFilePath).toHaveBeenCalledWith(
        7,
        sampleFileRow.workspaceId,
      ),
    );
  });

  it("keeps the file focused when it opened, whatever the list does", () => {
    act(() => setFocusedFile(file(6)));
    const { rerender } = renderWithProviders(
      <CommandMenu {...baseProps()} open={false} />,
    );
    // Focus moves while the menu is closed: the menu opens on the new one.
    act(() => setFocusedFile(file(7)));
    rerender(<CommandMenu {...baseProps()} open />);
    // The list changes under the open menu: it stays on the file it opened on.
    act(() => setFocusedFile(file(8)));
    expect(screen.getByTestId("command-file-name").textContent).toContain(
      "clip-7.mp4",
    );
  });

  it("offers no file actions over another screen", () => {
    act(() => setFocusedFile(file(7)));
    renderMenu({ fileActionsAvailable: false });
    expect(screen.queryByTestId("command-file-name")).toBeNull();
  });

  it("names the file when asking to delete it, and unselects it after", async () => {
    renderWithProviders(
      <>
        <Select rows={[file(3)]} />
        <SelectionCount />
        <ClosingMenu />
      </>,
    );
    expect(screen.getByTestId("selection-count").textContent).toBe("1");
    fireEvent.click(screen.getByText("Delete From Index"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("clip-3.mp4");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete From Index" }),
    );
    await waitFor(() =>
      expect(mocks.fileDeleteFromIndex).toHaveBeenCalledWith(
        3,
        sampleFileRow.workspaceId,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("selection-count").textContent).toBe("0"),
    );
  });

  it("closes the audio bar when the track it plays is deleted", async () => {
    // jsdom defines neither on the prototype.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    function Playing() {
      const { play } = useAudioActions();
      const { current } = useAudioPlayer();
      useEffect(() => {
        play(file(3), sampleFileRow.workspaceId);
      }, [play]);
      return <span data-testid="track">{current?.file.id ?? "none"}</span>;
    }
    act(() => setFocusedFile(file(3)));
    renderWithProviders(
      <>
        <Playing />
        <ClosingMenu />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("track").textContent).toBe("3"),
    );
    fireEvent.click(screen.getByText("Delete From Index"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete From Index" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("track").textContent).toBe("none"),
    );
  });

  it("acts on the selection over the focused file", async () => {
    act(() => setFocusedFile(file(7)));
    renderWithProviders(
      <>
        <Select rows={[file(1), file(2)]} />
        <CommandMenu
          open
          onOpenChange={vi.fn()}
          ready
          scanning={false}
          devToolsEnabled={false}
          onFocusSearch={vi.fn()}
          onScan={vi.fn()}
          onRebuild={vi.fn()}
          onSetView={vi.fn()}
          onToggleByFolder={vi.fn()}
          onDiscover={vi.fn()}
          onTags={vi.fn()}
          onSettings={vi.fn()}
          onHelp={vi.fn()}
          onOpenDevTools={vi.fn()}
          onApplySearch={vi.fn()}
          onApplySaved={vi.fn()}
          onQuickSearch={vi.fn()}
        />
      </>,
    );
    expect(screen.getByTestId("command-file-name").textContent).toContain("2");
    // Single-file actions have no meaning for a selection.
    expect(screen.queryByText("Copy File Path")).toBeNull();

    fireEvent.click(screen.getByText("Add to favorites"));
    await waitFor(() => expect(mocks.filesBulkMeta).toHaveBeenCalled());
    const [targets, patch] = mocks.filesBulkMeta.mock.calls[0];
    expect(patch).toEqual({ favorite: true });
    expect(targets).toEqual([
      { workspaceId: sampleFileRow.workspaceId, fileIds: [1, 2] },
    ]);
  });

  it("picks a rating with a digit on the rating page", async () => {
    act(() => setFocusedFile(file(7)));
    renderMenu();
    fireEvent.click(screen.getByText("Set rating…"));
    expect(
      screen.getByText("Rating", {
        selector: "[data-slot=command-input-badge]",
      }),
    ).toBeTruthy();
    fireEvent.keyDown(input(), { key: "4" });
    await waitFor(() =>
      expect(mocks.filesBulkMeta).toHaveBeenCalledWith(expect.anything(), {
        rating: 4,
      }),
    );
  });

  it("steps back from a page with Backspace on an empty field", async () => {
    act(() => setFocusedFile(file(7)));
    renderMenu();
    fireEvent.click(screen.getByText("Add to collection…"));
    expect(await screen.findAllByText("Trips")).toHaveLength(2);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(screen.queryByText("Trips")).toBeNull();
    expect(screen.getByText("Set rating…")).toBeTruthy();
  });
});

describe("recent searches group", () => {
  it("shows each search as chips, applies it, and can be cleared", async () => {
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([{ q: "sunset", favorite: true }]),
    );
    const { props } = renderMenu();
    expect(screen.getByText("Recent searches")).toBeTruthy();
    fireEvent.click(screen.getByText('"sunset"'));
    await waitFor(() =>
      expect(props.onApplySearch).toHaveBeenCalledWith({
        q: "sunset",
        favorite: true,
      }),
    );
  });

  it("clears the list from its last row", () => {
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([{ q: "sunset" }]),
    );
    renderMenu();
    fireEvent.click(screen.getByText("Clear recent searches"));
    expect(screen.queryByText("Recent searches")).toBeNull();
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBe("[]");
  });

  it("shows the first few until the user types", () => {
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ q: `word${i}` }))),
    );
    renderMenu();
    expect(screen.getByText('"word4"')).toBeTruthy();
    expect(screen.queryByText('"word5"')).toBeNull();
    fireEvent.change(input(), { target: { value: "word7" } });
    expect(screen.getByText('"word7"')).toBeTruthy();
  });
});

describe("quick search", () => {
  it("offers the typed text as a search, last", async () => {
    const { props } = renderMenu();
    fireEvent.change(input(), { target: { value: "zzqx" } });
    const row = screen.getByText(/zzqx/);
    fireEvent.click(row);
    await waitFor(() =>
      expect(props.onQuickSearch).toHaveBeenCalledWith("zzqx"),
    );
  });

  it("is not offered before anything is typed", () => {
    renderMenu();
    expect(screen.queryByText(/^Search for/)).toBeNull();
  });
});

describe("pages and rows", () => {
  const selected = () =>
    screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");

  it("steps back from a page with Esc instead of closing", () => {
    act(() => setFocusedFile(file(7)));
    const { props } = renderMenu();
    fireEvent.click(screen.getByText("Set rating…"));
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Set rating…")).toBeTruthy();
  });

  it("moves between rows that share a name", async () => {
    act(() => setFocusedFile(file(7)));
    renderMenu();
    fireEvent.click(screen.getByText("Add to collection…"));
    await screen.findAllByText("Trips");
    expect(selected()).toHaveLength(1);
    const first = selected()[0];
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()).toHaveLength(1);
    expect(selected()[0]).not.toBe(first);
  });

  it("puts the quick search after the rows that match", () => {
    renderMenu();
    fireEvent.change(input(), { target: { value: "sett" } });
    const options = screen.getAllByRole("option");
    expect(options.at(-1)?.textContent).toContain("sett");
    expect(options.some((o) => o.textContent === "Settings")).toBe(true);
    expect(screen.queryByText("No matching commands.")).toBeNull();
  });
});
