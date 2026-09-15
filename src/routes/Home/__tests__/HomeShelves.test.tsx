// The Home view: shown for the virtual "Home" workspace in place of the list,
// with its shelves, its keyboard navigation and its way out to the "All" list.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
  sampleTags,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PICKS_LIMIT, RECENT_LIMIT } from "@/routes/Home/shelves";
import { HOME_ID } from "@shared/workspaceIds";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<unknown>>(),
  workspacesList: vi.fn<() => Promise<unknown>>(),
  filesSearch: vi.fn<(query: unknown) => Promise<unknown>>(),
  filesRandom: vi.fn<(query: unknown) => Promise<unknown>>(),
  workspaceSwitch: vi.fn<(id: string) => Promise<unknown>>(),
  workspaceStats: vi.fn<() => Promise<unknown>>(),
  historyList: vi.fn<(query: unknown) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    filesRandom: (query: unknown) => mocks.filesRandom(query),
    workspaceSwitch: (id: string) => mocks.workspaceSwitch(id),
    workspaceStats: () => mocks.workspaceStats(),
    historyList: (query: unknown) => mocks.historyList(query),
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    scanStart: vi.fn().mockResolvedValue(null),
    tagsList: vi.fn().mockResolvedValue([]),
    collectionAddFile: vi.fn().mockResolvedValue(undefined),
    collectionRemoveFile: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onThumbDone: vi.fn().mockResolvedValue(() => {}),
    onScanDone: vi.fn().mockResolvedValue(() => {}),
    onScanProgress: vi.fn().mockResolvedValue(() => {}),
    onWorkspaceChanged: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

const recentRow = (id: number) => ({
  ...sampleFileRow,
  id,
  relPath: `videos/recent-${id}.mp4`,
});
const pickRow = (id: number) => ({
  ...sampleFileRow,
  id,
  relPath: `videos/pick-${id}.mp4`,
});

const homeStatus = { ...defaultAppStatus, root: "Home", workspaceId: HOME_ID };
const homeWorkspaces = {
  ...defaultWorkspacesList,
  workspaces: defaultWorkspacesList.workspaces.map((w) => ({
    ...w,
    active: w.id === HOME_ID,
  })),
  activeId: HOME_ID,
};

describe("Home view", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout: the focused shelf card's scrollIntoView is a no-op.
    Element.prototype.scrollIntoView = vi.fn();
    mocks.filesSearch.mockReset();
    mocks.filesRandom.mockReset();
    mocks.workspaceSwitch.mockReset();
    mocks.historyList.mockReset();
    mocks.historyList.mockResolvedValue({ items: [], nextCursor: null });
    mocks.appStatus.mockResolvedValue(homeStatus);
    mocks.workspacesList.mockResolvedValue(homeWorkspaces);
    mocks.workspaceStats.mockResolvedValue({ fileCount: 3, lastScanAt: null });
    mocks.filesSearch.mockResolvedValue({
      items: [recentRow(11), recentRow(12)],
      nextCursor: null,
    });
    // The first pick leads as the hero, the rest sit beside it.
    mocks.filesRandom.mockResolvedValue([pickRow(21), pickRow(22)]);
    mocks.workspaceSwitch.mockResolvedValue(undefined);
  });

  async function renderHomeView() {
    renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    await waitFor(() =>
      expect(within(shelves).getAllByTestId("shelf-card")).toHaveLength(3),
    );
    expect(within(shelves).getByTestId("shelf-hero")).toBeTruthy();
    return shelves;
  }

  it("shows the shelves instead of the list while Home is active", async () => {
    const shelves = await renderHomeView();
    expect(within(shelves).getByText("recent-11.mp4")).toBeTruthy();
    // Today's pick is the hero; the other pick is a card beside it.
    expect(
      within(within(shelves).getByTestId("shelf-hero")).getByText(
        "pick-21.mp4",
      ),
    ).toBeTruthy();
    expect(within(shelves).getByText("pick-22.mp4")).toBeTruthy();
    // The reshuffle sits beside "Open in Discovery", not by the stage's title.
    const reshuffle = within(shelves).getByRole("button", {
      name: "Reshuffle",
    });
    expect(
      reshuffle.parentElement?.textContent?.includes("Open in Discovery"),
    ).toBe(true);
    // Only the shelf queries ran: no list page, no filter bar.
    expect(mocks.filesSearch).toHaveBeenCalledTimes(1);
    expect(mocks.filesSearch).toHaveBeenCalledWith({
      sort: "btime",
      sortDir: "desc",
      limit: RECENT_LIMIT,
    });
    expect(mocks.filesRandom).toHaveBeenCalledWith({ limit: PICKS_LIMIT });
    expect(screen.queryByTestId("media-card")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show favorites only" }),
    ).toBeNull();
  });

  it("is not shown for a real workspace", async () => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    renderWithProviders(<Home />);
    await screen.findByText("recent-11.mp4");
    expect(screen.queryByTestId("home-shelves")).toBeNull();
    expect(screen.getAllByTestId("media-card").length).toBeGreaterThan(0);
    expect(mocks.filesRandom).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to show yet", async () => {
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
    mocks.filesRandom.mockResolvedValue([]);
    renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    await waitFor(() =>
      expect(within(shelves).getByText(/Nothing to show yet/)).toBeTruthy(),
    );
    expect(within(shelves).queryByTestId("shelf-card")).toBeNull();
  });

  it("shows only the shelves that have something", async () => {
    mocks.filesRandom.mockResolvedValue([]);
    renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    await waitFor(() =>
      expect(within(shelves).getByText("Recently added")).toBeTruthy(),
    );
    expect(within(shelves).queryByText("Today's pick")).toBeNull();
    expect(within(shelves).queryByTestId("shelf-hero")).toBeNull();
  });

  it("opens the 'All' list sorted by newest on 'See all'", async () => {
    const { queryClient } = renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    fireEvent.click(
      await within(shelves).findByRole("button", { name: "See all" }),
    );
    expect(mocks.workspaceSwitch).toHaveBeenCalledWith("__all__");
    // The rail refreshes app_status on the switch event; stand in for it.
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    await queryClient.invalidateQueries({ queryKey: ["app_status"] });
    // The list that comes up after the switch is already in the shelf's order.
    await waitFor(() =>
      expect(mocks.filesSearch).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "btime", sortDir: "desc", limit: 100 }),
      ),
    );
  });

  it("keeps today's pick on screen when a reshuffle fails, with a way to retry", async () => {
    const shelves = await renderHomeView();
    mocks.filesRandom.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(within(shelves).getByRole("button", { name: "Reshuffle" }));
    await waitFor(() =>
      expect(
        within(shelves).getByText("Could not load this shelf."),
      ).toBeTruthy(),
    );
    // The previous pick stays usable, the button too.
    expect(within(shelves).getByTestId("shelf-hero")).toBeTruthy();
    expect(within(shelves).getByText("pick-21.mp4")).toBeTruthy();
    expect(
      within(shelves)
        .getByRole("button", { name: "Reshuffle" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers a retry when the picks never loaded", async () => {
    mocks.filesRandom.mockRejectedValue(new Error("boom"));
    renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    await waitFor(() =>
      expect(
        within(shelves).getByText("Could not load this shelf."),
      ).toBeTruthy(),
    );
    expect(within(shelves).queryByTestId("shelf-hero")).toBeNull();
    expect(
      within(shelves).getByRole("button", { name: "Reshuffle" }),
    ).toBeTruthy();
    // Recently added is unaffected.
    expect(within(shelves).getByText("recent-11.mp4")).toBeTruthy();
  });

  it("takes a tag on the hero to the 'All' list as the whole filter", async () => {
    mocks.filesRandom.mockResolvedValue([{ ...pickRow(21), tags: sampleTags }]);
    const { queryClient } = renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    const hero = await within(shelves).findByTestId("shelf-hero");
    fireEvent.click(within(hero).getByText("beach"));
    expect(mocks.workspaceSwitch).toHaveBeenCalledWith("__all__");
    // The list that comes up carries only the tag, not any earlier filter.
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    await queryClient.invalidateQueries({ queryKey: ["app_status"] });
    await waitFor(() =>
      expect(mocks.filesSearch).toHaveBeenCalledWith(
        expect.objectContaining({ q: "tag:beach", limit: 100 }),
      ),
    );
  });

  it("shows beside the hero as many picks as fit its height, in whole rows", async () => {
    // jsdom lays nothing out: stand in for a three-column side grid whose
    // cards are 150px tall with a 12px gap, beside a 280px hero. Two rows
    // (312px) overshoot the hero by less than half a card, so they show; a
    // third (474px) would not.
    const originalStyle = window.getComputedStyle;
    const styleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el: Element) => {
        const style = originalStyle(el);
        if ((el as HTMLElement).className.includes("minmax(160px,1fr)")) {
          Object.defineProperty(style, "gridTemplateColumns", {
            value: "160px 160px 160px",
          });
          Object.defineProperty(style, "rowGap", { value: "12px" });
        }
        return style;
      });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const testid = this.dataset.testid;
        const height =
          testid === "shelf-hero" ? 280 : testid === "shelf-card" ? 150 : 0;
        return { height, width: 0 } as DOMRect;
      });
    try {
      // The hero plus nineteen more; six of those fit beside it.
      mocks.filesRandom.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => pickRow(30 + i)),
      );
      renderWithProviders(<Home />);
      const shelves = await screen.findByTestId("home-shelves");
      await within(shelves).findByTestId("shelf-hero");
      await waitFor(() =>
        expect(
          within(shelves)
            .getAllByTestId("shelf-card")
            .filter((c) => c.textContent?.includes("pick-")),
        ).toHaveLength(6),
      );
      expect(within(shelves).queryByText("pick-37.mp4")).toBeNull();
    } finally {
      rectSpy.mockRestore();
      styleSpy.mockRestore();
    }
  });

  it("scrubs today's pick on hover like any card, with nothing laid over it", async () => {
    // jsdom's Image never loads; record the frame requests instead.
    const requested: string[] = [];
    class RecordingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        requested.push(value);
      }
    }
    vi.stubGlobal("Image", RecordingImage);
    try {
      const shelves = await renderHomeView();
      const hero = within(shelves).getByTestId("shelf-hero");
      const [thumbLink, nameLink] = within(hero).getAllByRole("link");
      // The caption sits below the picture, not inside it or laid over it:
      // nothing but the picture itself is positioned on the stage (an overlay
      // would take the pointer and hide the seek line along the bottom edge).
      expect(thumbLink.contains(nameLink)).toBe(false);
      for (const child of Array.from(hero.children))
        expect(child.className).not.toMatch(/\babsolute\b/);
      const scrubTarget = thumbLink.firstElementChild as HTMLElement;
      // No layout in jsdom: give the picture a width to scrub across.
      scrubTarget.getBoundingClientRect = () =>
        ({ left: 0, width: 400, top: 0, height: 225 }) as DOMRect;
      fireEvent.mouseEnter(scrubTarget, { clientX: 100 });
      await waitFor(() =>
        expect(requested.some((src) => src.includes("/frame/21?t="))).toBe(
          true,
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows each card's rating over its picture and its tags beside the meta", async () => {
    mocks.filesSearch.mockResolvedValue({
      items: [
        { ...recentRow(11), rating: 4, tags: sampleTags },
        { ...recentRow(12), rating: 0, tags: [] },
      ],
      nextCursor: null,
    });
    const shelves = await renderHomeView();
    const [rated, unrated] = within(shelves)
      .getAllByTestId("shelf-card")
      .filter((c) => c.textContent?.includes("recent-"));

    // Rated: the stars stay on the picture; unrated: they wait for a hover.
    expect(within(rated).getByTestId("shelf-card-rating").className).toContain(
      "opacity-100",
    );
    expect(
      within(unrated).getByTestId("shelf-card-rating").className,
    ).toContain("opacity-0");

    // Manual tags show; the metadata classifier's do not, and a card with no
    // tags shows no chip row (nor a "No tags" label).
    expect(within(rated).getByText("beach")).toBeTruthy();
    expect(within(rated).queryByText("4k")).toBeNull();
    expect(within(unrated).queryByText("No tags")).toBeNull();

    // A tag on a card takes the library to the "All" list, like the stage's.
    fireEvent.click(within(rated).getByText("beach"));
    expect(mocks.workspaceSwitch).toHaveBeenCalledWith("__all__");
  });

  it("lists the most recently played files once each, with the play history behind See all", async () => {
    const played = (id: number, playedAt: number) => ({
      ...sampleFileRow,
      id,
      relPath: `videos/played-${id}.mp4`,
      historyId: playedAt,
      playedAt,
      via: "browser" as const,
      position: null,
      playCount: 1,
    });
    // The history repeats a file played again later: 41 shows once.
    mocks.historyList.mockResolvedValue({
      items: [played(41, 30), played(42, 20), played(41, 10)],
      nextCursor: null,
    });
    renderWithProviders(<Home />);
    const shelves = await screen.findByTestId("home-shelves");
    await within(shelves).findByText("Recently played");
    expect(within(shelves).getAllByText("played-41.mp4")).toHaveLength(1);
    expect(within(shelves).getByText("played-42.mp4")).toBeTruthy();
    // The shelf reads more history than it keeps (repeats are dropped).
    expect(mocks.historyList).toHaveBeenCalledWith({ limit: 60 });

    const header = within(shelves).getByText("Recently played").parentElement!;
    fireEvent.click(within(header).getByRole("button", { name: /See all/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/history"));
  });

  it("hides Recently played while nothing has been played", async () => {
    const shelves = await renderHomeView();
    // Wait for the (empty) history to have answered, so the row is judged on
    // its data rather than on a query still in flight (a row in flight shows
    // a skeleton header instead of its title).
    await waitFor(() => expect(mocks.historyList).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        shelves.querySelectorAll('[data-slot="skeleton"].h-4.w-32'),
      ).toHaveLength(0),
    );
    expect(within(shelves).queryByText("Recently played")).toBeNull();
  });

  it("keeps Recently added and Recently played to a single row each, as many as the grid has columns", async () => {
    // jsdom lays nothing out: stand in for a three-column grid.
    const originalStyle = window.getComputedStyle;
    const styleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el: Element) => {
        const style = originalStyle(el);
        if ((el as HTMLElement).className.includes("minmax(160px,1fr)")) {
          Object.defineProperty(style, "gridTemplateColumns", {
            value: "160px 160px 160px",
          });
        }
        return style;
      });
    try {
      mocks.filesSearch.mockResolvedValue({
        items: [11, 12, 13, 14, 15].map(recentRow),
        nextCursor: null,
      });
      mocks.historyList.mockResolvedValue({
        items: [51, 52, 53, 54, 55].map((id, i) => ({
          ...sampleFileRow,
          id,
          relPath: `videos/played-${id}.mp4`,
          historyId: id,
          playedAt: 100 - i,
          via: "browser" as const,
          position: null,
          playCount: 1,
        })),
        nextCursor: null,
      });
      renderWithProviders(<Home />);
      const shelves = await screen.findByTestId("home-shelves");
      await within(shelves).findByText("recent-11.mp4");
      await waitFor(() =>
        expect(
          within(shelves)
            .getAllByTestId("shelf-card")
            .filter((c) => c.textContent?.includes("recent-")),
        ).toHaveLength(3),
      );
      expect(within(shelves).queryByText("recent-14.mp4")).toBeNull();
      await within(shelves).findByText("played-51.mp4");
      expect(
        within(shelves)
          .getAllByTestId("shelf-card")
          .filter((c) => c.textContent?.includes("played-")),
      ).toHaveLength(3);
    } finally {
      styleSpy.mockRestore();
    }
  });

  it("lets the bar between the hero and the picks set the split", async () => {
    const shelves = await renderHomeView();
    const bar = within(shelves).getByRole("separator", {
      name: "Adjust the split between today's pick and more picks",
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    // Arrow keys on the bar nudge it (and do not move the card focus).
    bar.focus();
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(bar.getAttribute("aria-valuenow")).toBe("52");
    expect(shelves.querySelector('[data-shelf-focused="true"]')).toBeNull();
    expect(Number(localStorage.getItem("meguri.home.splitRatio"))).toBeCloseTo(
      0.52,
    );
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(bar.getAttribute("aria-valuenow")).toBe("48");
    // Double-click restores the even split.
    fireEvent.doubleClick(bar);
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("moves keyboard focus along and across the shelves", async () => {
    const shelves = await renderHomeView();
    const focusedName = () => {
      const card = shelves.querySelector<HTMLElement>(
        '[data-shelf-focused="true"]',
      );
      // The name element carries the file's relPath as its title.
      return card ? within(card).getByTitle(/^videos\//).textContent : null;
    };

    // Down lands on the hero, then the other picks, then the newest.
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(focusedName()).toBe("pick-21.mp4");
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(focusedName()).toBe("pick-22.mp4");
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(focusedName()).toBe("recent-11.mp4");
    fireEvent.keyDown(window, { code: "ArrowRight", key: "ArrowRight" });
    expect(focusedName()).toBe("recent-12.mp4");
    // The last row is the bottom: down stays put.
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(focusedName()).toBe("recent-12.mp4");
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });
    expect(focusedName()).toBe("pick-22.mp4");
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });
    expect(focusedName()).toBe("pick-21.mp4");
  });

  it("uses the vim preset's keys for the same moves", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ keybindingPreset: "vim" }),
    );
    const shelves = await renderHomeView();
    const focusedName = () => {
      const card = shelves.querySelector<HTMLElement>(
        '[data-shelf-focused="true"]',
      );
      // The name element carries the file's relPath as its title.
      return card ? within(card).getByTitle(/^videos\//).textContent : null;
    };
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    expect(focusedName()).toBe("pick-21.mp4");
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    fireEvent.keyDown(window, { code: "KeyL", key: "l" });
    expect(focusedName()).toBe("recent-12.mp4");
    fireEvent.keyDown(window, { code: "KeyK", key: "k" });
    expect(focusedName()).toBe("pick-22.mp4");
  });
});
