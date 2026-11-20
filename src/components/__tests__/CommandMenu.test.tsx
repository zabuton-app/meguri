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
  workspaceSwitch: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  openExternal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  tagsListAll: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

/** A catalog entry the field's tag completion draws from. */
function tagSummary(
  name: string,
  fileCount: number,
  namespace = "",
  workspaceIds = ["ws-test"],
) {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [],
    pipelineOwned: namespace !== "",
    workspaceIds,
  };
}

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: vi.fn().mockResolvedValue({
      ready: true,
      workspaceId: "ws-test",
      root: "/m",
    }),
    tagsListAll: (...args: unknown[]) => mocks.tagsListAll(...args),
    workspaceSwitch: (...args: unknown[]) => mocks.workspaceSwitch(...args),
    openExternal: (...args: unknown[]) => mocks.openExternal(...args),
    workspacesList: vi.fn().mockResolvedValue({
      workspaces: [
        { id: "__all__", path: "", label: "All", active: false },
        { id: "ws-test", path: "/m", label: "Movies", active: true },
        {
          id: "ws-photos",
          path: "/p",
          label: "Photos",
          active: false,
          emoji: "📷",
        },
      ],
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
  collectionTarget: (id: string) => `collection:${id}`,
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
  mocks.workspaceSwitch.mockResolvedValue(undefined);
  mocks.openExternal.mockResolvedValue(undefined);
  mocks.tagsListAll.mockResolvedValue({
    tags: [
      tagSummary("beach", 4),
      tagSummary("upbeat", 9),
      tagSummary("bear", 2, "", ["ws-other"]),
      tagSummary("4k", 7, "res"),
    ],
    truncated: false,
  });
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
    onScan: vi.fn(),
    onRebuild: vi.fn(),
    onSetView: vi.fn(),
    onToggleByFolder: vi.fn(),
    onToggleHeatmap: vi.fn(),
    onDiscover: vi.fn(),
    onTags: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onOpenDevTools: vi.fn(),
    onApplySearch: vi.fn(),
    onApplySaved: vi.fn(),
    onSearch: vi.fn(),
    onHistory: vi.fn(),
    onDuplicates: vi.fn(),
    onAutoTag: vi.fn(),
    filter: {},
    onFilterChange: vi.fn(),
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
    onScan: vi.fn(),
    onRebuild: vi.fn(),
    onSetView: vi.fn(),
    onToggleByFolder: vi.fn(),
    onToggleHeatmap: vi.fn(),
    onDiscover: vi.fn(),
    onTags: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onOpenDevTools: vi.fn(),
    onApplySearch: vi.fn(),
    onApplySaved: vi.fn(),
    onSearch: vi.fn(),
    onHistory: vi.fn(),
    onDuplicates: vi.fn(),
    onAutoTag: vi.fn(),
    filter: {},
    onFilterChange: vi.fn(),
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
          onScan={vi.fn()}
          onRebuild={vi.fn()}
          onSetView={vi.fn()}
          onToggleByFolder={vi.fn()}
          onToggleHeatmap={vi.fn()}
          onDiscover={vi.fn()}
          onTags={vi.fn()}
          onSettings={vi.fn()}
          onHelp={vi.fn()}
          onOpenDevTools={vi.fn()}
          onApplySearch={vi.fn()}
          onApplySaved={vi.fn()}
          onSearch={vi.fn()}
          onHistory={vi.fn()}
          onDuplicates={vi.fn()}
          onAutoTag={vi.fn()}
          filter={{}}
          onFilterChange={vi.fn()}
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

  it("does not take Enter from the search typed, which keeps the chips", async () => {
    // A recent search would replace the search on screen, dropping a tag
    // just added; Enter adds the words to it instead.
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([{ q: "park" }]));
    const { props } = renderMenu();
    fireEvent.change(input(), { target: { value: "park" } });
    expect(screen.getByText('"park"')).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(props.onSearch).toHaveBeenCalledWith("park"));
    expect(props.onApplySearch).not.toHaveBeenCalled();
  });
});

describe("quick search", () => {
  it("offers the typed text as a search", async () => {
    const { props } = renderMenu();
    fireEvent.change(input(), { target: { value: "zzqx" } });
    const row = screen.getByText(/zzqx/);
    fireEvent.click(row);
    await waitFor(() => expect(props.onSearch).toHaveBeenCalledWith("zzqx"));
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

  it("puts the quick search first, so Enter searches for what was typed", () => {
    renderMenu();
    fireEvent.change(input(), { target: { value: "sett" } });
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("sett");
    expect(selected()[0]).toBe(options[0]);
    // A command that matches is still there, a pick away.
    expect(options.some((o) => o.textContent === "Settings")).toBe(true);
    expect(screen.queryByText("No matching commands.")).toBeNull();
  });
});

describe("prefix pages", () => {
  const badge = () =>
    document.querySelector("[data-slot=command-input-badge]")?.textContent;

  it("matches a prefix only at the start, and leaves unknown ones alone", () => {
    renderMenu();
    fireEvent.change(input(), { target: { value: "x ws:a" } });
    expect(badge()).toBeUndefined();
    fireEvent.change(input(), { target: { value: "kind:video" } });
    expect(badge()).toBeUndefined();
    expect(screen.getByText(/kind:video/)).toBeTruthy();
  });

  it("opens a workspace picked from ws: with an empty Enter", async () => {
    const { props } = renderMenu();
    fireEvent.change(input(), { target: { value: "ws:pho" } });
    expect(badge()).toBe("ws:");
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "📷Photos",
      ]),
    );
    fireEvent.click(screen.getByText("Photos"));
    // The menu stays open on the workspace picked, ready for a search.
    expect(badge()).toBe("ws:Photos");
    expect((input() as HTMLInputElement).value).toBe("");
    expect(mocks.workspaceSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Open Photos"));
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-photos"),
    );
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("searches in the workspace picked from ws:", async () => {
    const { props } = renderMenu();
    fireEvent.change(input(), { target: { value: "ws:" } });
    fireEvent.click(await screen.findByText("Photos"));
    fireEvent.change(input(), { target: { value: "dog run" } });
    fireEvent.click(screen.getByText("Search for “dog run” in Photos"));
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-photos"),
    );
    expect(props.onSearch).toHaveBeenCalledWith("dog run");
    // Set before the switch, while the filter is still the old view's.
    expect(
      (props.onSearch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.workspaceSwitch.mock.invocationCallOrder[0]);
  });

  it("steps back from the picked workspace to the list", async () => {
    renderMenu();
    fireEvent.change(input(), { target: { value: "ws:" } });
    fireEvent.click(await screen.findByText("Photos"));
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(badge()).toBe("ws:");
    expect(await screen.findByText("Movies")).toBeTruthy();
  });

  it("only searches in the workspace already shown, back on the list", async () => {
    const { props } = renderMenu();
    window.location.hash = "#/history";
    fireEvent.change(input(), { target: { value: "ws:" } });
    fireEvent.click(await screen.findByText("Movies"));
    fireEvent.change(input(), { target: { value: "cat" } });
    fireEvent.click(screen.getByText("Search for “cat” in Movies"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(props.onSearch).toHaveBeenCalledWith("cat"));
    // The search shows on the list, even with no switch to take it there.
    expect(window.location.hash).toBe("#/");
    expect(mocks.workspaceSwitch).not.toHaveBeenCalled();
  });

  it("switches after the menu has closed", async () => {
    renderWithProviders(<ClosingMenu />, { route: "/history" });
    fireEvent.change(input(), { target: { value: "ws:" } });
    fireEvent.click(await screen.findByText("Photos"));
    fireEvent.click(screen.getByText("Open Photos"));
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith("ws-photos"),
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(window.location.hash).toBe("#/");
  });

  it("opens a collection, Watch Later included, from col:", async () => {
    renderMenu();
    fireEvent.change(input(), { target: { value: "col:" } });
    expect(badge()).toBe("col:");
    expect(await screen.findByText("Watch Later")).toBeTruthy();
    expect(screen.getAllByText("Trips")).toHaveLength(2);
    fireEvent.click(screen.getByText("Watch Later"));
    expect(badge()).toBe("col:Watch Later");
    fireEvent.click(screen.getByText("Open Watch Later"));
    await waitFor(() =>
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith(
        "collection:watch-later",
      ),
    );
  });
});

describe("more commands", () => {
  it("navigates to History, Duplicates and Auto tagging", async () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByText("Play history"));
    await waitFor(() => expect(props.onHistory).toHaveBeenCalled());
    expect(screen.getByText("Duplicate Files")).toBeTruthy();
    expect(screen.getByText("Auto tagging")).toBeTruthy();
  });

  it("does not offer to clear filters when there are none", () => {
    renderMenu();
    const row = () =>
      screen.getByText("Clear all filters").closest("[cmdk-item]");
    expect(row()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("clears the filters the way the filter bar does", async () => {
    const { props } = renderMenu({ filter: { q: "sunset", favorite: true } });
    fireEvent.click(screen.getByText("Clear all filters"));
    await waitFor(() => expect(props.onFilterChange).toHaveBeenCalledWith({}));
  });

  it("toggles the theme to its counterpart", async () => {
    renderMenu();
    const before = document.documentElement.dataset.theme;
    const row = screen.getByText(/^Switch to (light|dark) mode$/);
    fireEvent.click(row);
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).not.toBe(before),
    );
  });

  it("offers open, details, external player and tag editing for a file", async () => {
    act(() => setFocusedFile(file(7)));
    renderWithProviders(<ClosingMenu />);
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Open details without playing")).toBeTruthy();
    fireEvent.click(screen.getByText("Open externally"));
    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledWith(
        7,
        sampleFileRow.workspaceId,
      ),
    );
  });

  it("opens the tag dialog for the file", async () => {
    act(() => setFocusedFile(file(7)));
    renderWithProviders(<ClosingMenu />);
    fireEvent.click(screen.getByText("Edit tags"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("1");
  });
});

// The field edits the search (#578): the conditions as chips ahead of the
// text, as the title bar's search box did before it moved here.
describe("search field", () => {
  const field = () => input() as HTMLInputElement;
  const chips = () =>
    [...document.querySelectorAll('[data-slot="search-chip"]')].map(
      (c) => c.textContent,
    );
  const lit = () =>
    [...document.querySelectorAll('[data-slot="search-chip"]')].findIndex(
      (c) => c.getAttribute("data-selected") === "true",
    );
  const texts = () => screen.getAllByRole("option").map((o) => o.textContent);
  const selected = () =>
    screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");
  const type = (value: string) =>
    fireEvent.change(field(), { target: { value } });

  it("starts from the search on screen, chips and words", () => {
    renderMenu({ filter: { q: "tag:beach sunset" } });
    expect(chips()).toEqual(["tag:beach"]);
    expect(field().value).toBe("sunset");
  });

  it("lists every command while the search on screen is only shown again", async () => {
    const { props } = renderMenu({ filter: { q: "tag:beach sunset" } });
    // Enter on the field as opened runs that search, not the first command.
    expect(texts()[0]).toBe("Search for “tag:beach sunset”↵");
    expect(selected()[0]).toBe(screen.getAllByRole("option")[0]);
    // Not filtered by the words, nor completed from them.
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.queryByText("Tag suggestions")).toBeNull();
    // Editing it makes it a search to run, first.
    type("sunset park");
    expect(texts()[0]).toBe("Search for “tag:beach sunset park”↵");
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() =>
      expect(props.onSearch).toHaveBeenCalledWith("tag:beach sunset park"),
    );
  });

  it("chips a directive once a space closes it, and runs the whole field", async () => {
    const { props } = renderMenu({ filter: { q: "tag:beach" } });
    type("tag:sea ");
    expect(chips()).toEqual(["tag:beach", "tag:sea"]);
    type("sunset");
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() =>
      expect(props.onSearch).toHaveBeenCalledWith("tag:beach tag:sea sunset"),
    );
  });

  it("keeps a half-typed directive as text", () => {
    renderMenu();
    type("tag:bea");
    expect(chips()).toEqual([]);
    expect(field().value).toBe("tag:bea");
  });

  it("does not chip a condition twice, pointing at the one it has", () => {
    renderMenu({ filter: { q: "tag:beach tag:sea" } });
    type("TAG:Beach ");
    expect(chips()).toEqual(["tag:beach", "tag:sea"]);
    expect(lit()).toBe(0);
    // That highlight was the menu's, not the user's: Backspace arms it
    // rather than deleting.
    fireEvent.keyDown(field(), { key: "Backspace" });
    expect(chips()).toHaveLength(2);
    fireEvent.keyDown(field(), { key: "Backspace" });
    expect(chips()).toEqual(["tag:sea"]);
  });

  it("highlights the last chip on Backspace, then deletes it", async () => {
    const { props } = renderMenu({ filter: { q: "tag:beach tag:sea" } });
    fireEvent.keyDown(field(), { key: "Backspace" });
    expect(lit()).toBe(1);
    expect(chips()).toHaveLength(2);
    fireEvent.keyDown(field(), { key: "Backspace" });
    expect(chips()).toEqual(["tag:beach"]);
    // The highlight stays on whatever slid into its place.
    expect(lit()).toBe(0);
    // The search changed, so it is offered to run, first.
    expect(texts()[0]).toBe("Search for “tag:beach”↵");
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() =>
      expect(props.onSearch).toHaveBeenCalledWith("tag:beach"),
    );
  });

  it("keeps a chip's cross out of the tab order, focus staying in the field", () => {
    renderMenu({ filter: { q: "tag:beach" } });
    expect(
      screen.getByRole("button", { name: "Remove this filter" }).tabIndex,
    ).toBe(-1);
  });

  it("offers clearing the search once every chip is gone", async () => {
    const { props } = renderMenu({ filter: { q: "tag:beach" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove this filter" }));
    expect(chips()).toEqual([]);
    fireEvent.click(screen.getByText("Clear search"));
    await waitFor(() => expect(props.onSearch).toHaveBeenCalledWith(""));
  });

  it("walks the chips with the arrow keys, back into the text off the end", () => {
    renderMenu({ filter: { q: "tag:beach tag:sea" } });
    fireEvent.keyDown(field(), { key: "ArrowLeft" });
    expect(lit()).toBe(1);
    fireEvent.keyDown(field(), { key: "ArrowLeft" });
    fireEvent.keyDown(field(), { key: "ArrowLeft" });
    expect(lit()).toBe(0);
    fireEvent.keyDown(field(), { key: "ArrowRight" });
    fireEvent.keyDown(field(), { key: "ArrowRight" });
    expect(lit()).toBe(-1);
  });

  it("keeps Home and End for the caret, not the rows", () => {
    renderMenu({ filter: { q: "tag:beach" } });
    type("s");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
    const first = screen.getAllByRole("option")[0];
    fireEvent.keyDown(field(), { key: "End" });
    expect(first.getAttribute("aria-selected")).toBe("true");
  });

  it("leaves the chips alone while the caret is inside the text", () => {
    renderMenu({ filter: { q: "tag:beach sunset" } });
    field().setSelectionRange(3, 3);
    fireEvent.keyDown(field(), { key: "Backspace" });
    fireEvent.keyDown(field(), { key: "ArrowLeft" });
    expect(lit()).toBe(-1);
  });

  it("keeps an Esc that cancels a conversion from closing the menu", () => {
    const { props } = renderMenu();
    type("こうえん");
    fireEvent.keyDown(field(), { key: "Escape", isComposing: true });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(field().value).toBe("こうえん");
  });

  it("drops the highlight on Esc without closing the menu", () => {
    const { props } = renderMenu({ filter: { q: "tag:beach" } });
    fireEvent.click(document.querySelector('[data-slot="search-chip"]')!);
    expect(lit()).toBe(0);
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(lit()).toBe(-1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("completes a tag after tag:, first, and chips the pick in the field", async () => {
    const { props } = renderMenu();
    type("sunset TAG:bea");
    // Prefix hits first, a tag held only elsewhere last, a substring hit in
    // between; the directive as typed after them.
    await waitFor(() =>
      expect(texts().slice(0, 4)).toEqual([
        "tag:beach4",
        "tag:upbeat9",
        "tag:bearother workspaces only2",
        "Search for “sunset TAG:bea”↵",
      ]),
    );
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(chips()).toEqual(["tag:beach"]);
    expect(field().value).toBe("sunset ");
    // The menu stays open, to go on typing.
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(props.onSearch).not.toHaveBeenCalled();
  });

  it("offers an ordinary word's search first, then the tags it names", async () => {
    renderMenu({ filter: { q: "tag:sea" } });
    type("park bea");
    await waitFor(() => expect(texts()).toContain("tag:beach4"));
    expect(texts()[0]).toBe("Search for “tag:sea park bea”↵");
    fireEvent.click(screen.getByText("beach"));
    expect(chips()).toEqual(["tag:sea", "tag:beach"]);
    expect(field().value).toBe("park ");
  });

  it("offers a namespace a word begins, then that namespace's values", async () => {
    renderMenu();
    type("tempo");
    fireEvent.click(await screen.findByText("audio_tempo:"));
    expect(field().value).toBe("tag:audio_tempo:");
    expect(chips()).toEqual([]);
    await waitFor(() => expect(texts().join(" ")).toMatch(/fast/i));
  });

  it("completes nothing while an input method composes, or mid-text", async () => {
    renderMenu();
    type("bea");
    await waitFor(() => expect(texts()).toContain("tag:beach4"));
    fireEvent.compositionStart(field());
    expect(texts()).not.toContain("tag:beach4");
    fireEvent.compositionEnd(field());
    expect(texts()).toContain("tag:beach4");
    field().setSelectionRange(1, 1);
    fireEvent.select(field());
    expect(texts()).not.toContain("tag:beach4");
  });

  it("searches in a workspace picked from ws: with the chips kept", async () => {
    const { props } = renderMenu({ filter: { q: "tag:beach old" } });
    type("ws:");
    fireEvent.click(await screen.findByText("Photos"));
    type("dog");
    fireEvent.click(screen.getByText("Search for “dog” in Photos"));
    await waitFor(() =>
      expect(props.onSearch).toHaveBeenCalledWith("tag:beach dog"),
    );
  });
});

describe("placement", () => {
  it("follows the search when the window's width changes", () => {
    const search = document.createElement("div");
    search.setAttribute("data-command-menu-anchor", "");
    document.body.append(search);
    let left = 400;
    search.getBoundingClientRect = () =>
      ({ top: 10, left, width: 200, height: 30 }) as DOMRect;
    const width = window.innerWidth;
    window.innerWidth = 1600;
    try {
      const { props, rerender } = renderMenu({ open: false });
      rerender(<CommandMenu {...props} open />);
      const menu = () => screen.getByRole("dialog");
      expect(menu().style.left).toBe("500px");

      left = 700;
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(menu().style.left).toBe("800px");
    } finally {
      window.innerWidth = width;
      search.remove();
    }
  });
});
