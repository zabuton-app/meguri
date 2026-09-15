// The landing shelves above the list: when they show, and how keyboard focus
// moves between them and the grid.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { LANDING_COLLAPSED_KEY, RECENT_LIMIT } from "@/routes/Home/landing";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<unknown>>(),
  workspacesList: vi.fn<() => Promise<unknown>>(),
  filesSearch: vi.fn<(query: unknown) => Promise<unknown>>(),
  filesRandom: vi.fn<(query: unknown) => Promise<unknown>>(),
  workspaceStats: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    filesRandom: (query: unknown) => mocks.filesRandom(query),
    workspaceStats: () => mocks.workspaceStats(),
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

const gridRow = (id: number) => ({
  ...sampleFileRow,
  id,
  relPath: `videos/grid-${id}.mp4`,
});
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

/** The shelf asks for the newest few; the list pages by 100 in whatever sort. */
function isShelfQuery(query: unknown): boolean {
  const q = query as { sort?: string; limit?: number };
  return q.sort === "btime" && q.limit === RECENT_LIMIT;
}

describe("Home landing shelves", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout: the focused shelf card's scrollIntoView is a no-op.
    Element.prototype.scrollIntoView = vi.fn();
    mocks.filesSearch.mockReset();
    mocks.filesRandom.mockReset();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.workspaceStats.mockResolvedValue({ fileCount: 3, lastScanAt: null });
    mocks.filesSearch.mockImplementation((query: unknown) =>
      Promise.resolve(
        isShelfQuery(query)
          ? { items: [recentRow(11), recentRow(12)], nextCursor: null }
          : { items: [gridRow(1), gridRow(2), gridRow(3)], nextCursor: null },
      ),
    );
    mocks.filesRandom.mockResolvedValue([pickRow(21)]);
  });

  it("shows both shelves above the list once the list has loaded", async () => {
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    expect(within(landing).getByText("recent-11.mp4")).toBeTruthy();
    expect(within(landing).getByText("pick-21.mp4")).toBeTruthy();
    expect(within(landing).getAllByTestId("landing-card")).toHaveLength(3);
    // The list is still there beneath.
    expect(screen.getByText("grid-1.mp4")).toBeTruthy();
    expect(mocks.filesRandom).toHaveBeenCalledWith({ limit: 8 });
  });

  it("hides while a filter is active and comes back when it is cleared", async () => {
    renderWithProviders(<Home />);
    await screen.findByTestId("home-landing");
    const favoriteFilter = screen.getByRole("button", {
      name: "Show favorites only",
    });
    fireEvent.click(favoriteFilter);
    await waitFor(() =>
      expect(screen.queryByTestId("home-landing")).toBeNull(),
    );
    fireEvent.click(favoriteFilter);
    await screen.findByTestId("home-landing");
  });

  it("hides when every shelf is empty", async () => {
    mocks.filesSearch.mockImplementation((query: unknown) =>
      Promise.resolve(
        isShelfQuery(query)
          ? { items: [], nextCursor: null }
          : { items: [gridRow(1)], nextCursor: null },
      ),
    );
    mocks.filesRandom.mockResolvedValue([]);
    renderWithProviders(<Home />);
    await screen.findByText("grid-1.mp4");
    await waitFor(() => expect(mocks.filesRandom).toHaveBeenCalled());
    expect(screen.queryByTestId("home-landing")).toBeNull();
  });

  it("shows only the shelves that have something", async () => {
    mocks.filesRandom.mockResolvedValue([]);
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    await waitFor(() => expect(mocks.filesRandom).toHaveBeenCalled());
    expect(within(landing).getByText("Recently added")).toBeTruthy();
    expect(within(landing).queryByText("Picks for today")).toBeNull();
  });

  it("stays hidden when the preference is off", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ homeLanding: false }),
    );
    renderWithProviders(<Home />);
    await screen.findByText("grid-1.mp4");
    expect(screen.queryByTestId("home-landing")).toBeNull();
    expect(mocks.filesRandom).not.toHaveBeenCalled();
  });

  it("remembers the collapsed state", async () => {
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    fireEvent.click(within(landing).getByRole("button", { name: "Collapse" }));
    expect(within(landing).queryByTestId("landing-card")).toBeNull();
    expect(localStorage.getItem(LANDING_COLLAPSED_KEY)).toBe("true");
    // The header line stays as the way back in.
    fireEvent.click(within(landing).getByRole("button", { name: /Home/ }));
    expect(within(landing).getAllByTestId("landing-card")).toHaveLength(3);
    expect(localStorage.getItem(LANDING_COLLAPSED_KEY)).toBe("false");
  });

  it("sorts the list by newest on 'See all'", async () => {
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    fireEvent.click(within(landing).getByRole("button", { name: "See all" }));
    await waitFor(() =>
      expect(mocks.filesSearch).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "btime", sortDir: "desc", limit: 100 }),
      ),
    );
    // A sort is not a filter: the shelves stay.
    expect(screen.getByTestId("home-landing")).toBeTruthy();
  });

  it("moves keyboard focus from the grid up into the shelves and back", async () => {
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    const gridCards = () => screen.getAllByTestId("media-card");
    const focusedCard = () =>
      landing.querySelector('[data-landing-focused="true"]');

    // Down lands on the first grid card, as before.
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(gridCards()[0].getAttribute("aria-current")).toBe("true");

    // Up from the first row hands focus to the last shelf (Picks).
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });
    await waitFor(() => expect(focusedCard()).not.toBeNull());
    expect(within(focusedCard() as HTMLElement).getByText("pick-21.mp4"));
    expect(gridCards()[0].getAttribute("aria-current")).toBeNull();

    // Up again: the Recently added shelf; right walks along it.
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });
    fireEvent.keyDown(window, { code: "ArrowRight", key: "ArrowRight" });
    expect(within(focusedCard() as HTMLElement).getByText("recent-12.mp4"));

    // Down twice: through Picks and out into the grid's first card.
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    await waitFor(() =>
      expect(gridCards()[0].getAttribute("aria-current")).toBe("true"),
    );
    expect(focusedCard()).toBeNull();
  });

  it("hands focus over in the list view as well", async () => {
    localStorage.setItem("meguri.view", "list");
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    const rowFocused = () =>
      screen.getByText("grid-1.mp4").closest('[aria-current="true"]') !== null;
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    expect(rowFocused()).toBe(true);
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });
    await waitFor(() =>
      expect(
        landing.querySelector('[data-landing-focused="true"]'),
      ).not.toBeNull(),
    );
    expect(rowFocused()).toBe(false);
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    await waitFor(() => expect(rowFocused()).toBe(true));
  });

  it("uses the vim preset's keys for the same moves", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ keybindingPreset: "vim" }),
    );
    renderWithProviders(<Home />);
    const landing = await screen.findByTestId("home-landing");
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    expect(
      screen.getAllByTestId("media-card")[0].getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.keyDown(window, { code: "KeyK", key: "k" });
    await waitFor(() =>
      expect(
        landing.querySelector('[data-landing-focused="true"]'),
      ).not.toBeNull(),
    );
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    await waitFor(() =>
      expect(
        screen.getAllByTestId("media-card")[0].getAttribute("aria-current"),
      ).toBe("true"),
    );
  });
});
