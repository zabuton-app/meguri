import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { mockVirtualizerScrollToOffset } from "@/test/mockVirtualizer";
import { TimelineView } from "@/timeline/TimelineView";
import { defaultWorkspacesList, sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow } from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  timelineCounts: vi.fn<(input: unknown) => Promise<unknown>>(),
  workspacesList: vi.fn<() => Promise<unknown>>(),
  fileSetFavorite: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fileSetRating: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    timelineCounts: (input: unknown) => mocks.timelineCounts(input),
    workspacesList: () => mocks.workspacesList(),
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
  },
  ALL_ID: "__all__",
}));

/** Local noon of a day, so the month holds in any zone. */
const at = (y: number, m: number, d: number) =>
  Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);

const dated = (id: number, capturedAt: number | null): FileRow => ({
  ...sampleFileRow,
  id,
  relPath: `f${id}.mp4`,
  capturedAt,
});

const noop = () => {};

function view(
  items: FileRow[],
  extra: Partial<React.ComponentProps<typeof TimelineView>> = {},
) {
  return (
    <TimelineView
      scope={WS_ID}
      query={{}}
      axis="captured"
      onAxisChange={noop}
      ready
      items={items}
      listOffset={0}
      loading={false}
      mediaBase="http://127.0.0.1:17345"
      thumbVersion={{}}
      onAnchor={noop}
      {...extra}
    />
  );
}

describe("TimelineView", () => {
  beforeEach(() => {
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.timelineCounts.mockReset();
  });

  it("cuts the list into days under headers, with the undated files last", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [
        { day: "2026-10-15", count: 2 },
        { day: "2026-08-15", count: 1 },
      ],
      undated: 1,
    });
    renderWithProviders(
      view([
        dated(1, at(2026, 10, 20)),
        dated(2, at(2026, 10, 3)),
        dated(3, at(2026, 8, 9)),
        dated(4, null),
      ]),
    );
    await screen.findByText("f1.mp4");
    const headers = [
      ...document.querySelectorAll('[data-slot="timeline-header"]'),
    ].map((h) => h.textContent);
    expect(headers).toEqual([
      "October 15, 20262 files",
      "August 15, 20261 files",
      "No date1 files",
    ]);
    // Every file is drawn, and in the list's order.
    const names = screen
      .getAllByTestId("media-card")
      .map((c) => c.textContent?.match(/f\d+\.mp4/)?.[0]);
    expect(names).toEqual(["f1.mp4", "f2.mp4", "f3.mp4", "f4.mp4"]);
    // The header at the top is pinned over the list.
    expect(
      document.querySelector('[data-slot="timeline-pinned-header"]')
        ?.textContent,
    ).toContain("October 15, 2026");
    expect(screen.queryByTestId("timeline-pending")).toBeNull();
  });

  it("gathers the days of a month under one mark on the rail", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [
        { day: "2026-10-20", count: 1 },
        { day: "2026-10-03", count: 1 },
        { day: "2026-08-09", count: 1 },
      ],
      undated: 0,
    });
    renderWithProviders(
      view([
        dated(1, at(2026, 10, 20)),
        dated(2, at(2026, 10, 3)),
        dated(3, at(2026, 8, 9)),
      ]),
    );
    await screen.findByText("f1.mp4");
    const headers = [
      ...document.querySelectorAll('[data-slot="timeline-header"]'),
    ].map((h) => h.textContent);
    expect(headers).toEqual([
      "October 20, 20261 files",
      "October 3, 20261 files",
      "August 9, 20261 files",
    ]);
    // The rail gathers the days of a month.
    expect(
      [...document.querySelectorAll("[data-month]")].map((e) =>
        e.getAttribute("data-month"),
      ),
    ).toEqual(["2026-10", "2026-08"]);
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
      "October 2026: 2 files",
    );
  });

  it("draws placeholders for the rows the window has not reached", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [{ day: "2026-10-15", count: 5 }],
      undated: 0,
    });
    renderWithProviders(view([dated(1, at(2026, 10, 1))]));
    await screen.findByText("f1.mp4");
    expect(screen.getAllByTestId("timeline-pending")).toHaveLength(4);
  });

  it("shows the empty state when nothing matches", async () => {
    mocks.timelineCounts.mockResolvedValue({ days: [], undated: 0 });
    renderWithProviders(view([]));
    await screen.findByText("No media to display.");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("switches the axis from the pinned header", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [{ day: "2026-10-15", count: 1 }],
      undated: 0,
    });
    const onAxisChange = vi.fn();
    renderWithProviders(view([dated(1, at(2026, 10, 1))], { onAxisChange }));
    await screen.findByText("f1.mp4");
    fireEvent.click(screen.getByRole("radio", { name: "Created" }));
    expect(onAxisChange).toHaveBeenCalledWith("btime");
  });

  it("asks for the list from where the view is when the window is elsewhere", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [
        { day: "2026-10-15", count: 300 },
        { day: "2026-08-15", count: 10 },
      ],
      undated: 0,
    });
    const onAnchor = vi.fn();
    // The window holds rows 1000 on; the view (every row, under the mocked
    // virtualizer) starts at the top.
    renderWithProviders(
      view(
        Array.from({ length: 100 }, (_, i) => dated(1001 + i, at(2026, 10, 1))),
        { onAnchor, listOffset: 1000 },
      ),
    );
    await waitFor(() => expect(onAnchor).toHaveBeenCalledWith(undefined));
  });

  it("scrolls to the header of the month stepped to on the rail", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [
        { day: "2026-10-15", count: 3 },
        { day: "2026-08-15", count: 1 },
      ],
      undated: 0,
    });
    renderWithProviders(
      view([
        dated(1, at(2026, 10, 3)),
        dated(2, at(2026, 10, 2)),
        dated(3, at(2026, 10, 1)),
        dated(4, at(2026, 8, 1)),
      ]),
    );
    await screen.findByText("f1.mp4");
    // jsdom lays nothing out: give the viewport room to scroll.
    const viewport = document.querySelector(
      '[data-slot="timeline"] [data-slot="scroll-area-viewport"]',
    ) as HTMLElement;
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      get: () => 10_000,
    });
    mockVirtualizerScrollToOffset().mockClear();
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toBe("October 2026: 3 files");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    // Rows 0..1 are October (its header and one row of three cards):
    // August's header is row 2, at twice the (mocked, uniform) row height.
    const rowHeight = 220;
    expect(mockVirtualizerScrollToOffset()).toHaveBeenCalledWith(2 * rowHeight);
  });

  it("keeps the rail's keys from moving the list's focus", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [
        { day: "2026-10-15", count: 1 },
        { day: "2026-08-15", count: 1 },
      ],
      undated: 0,
    });
    renderWithProviders(
      view([dated(1, at(2026, 10, 1)), dated(2, at(2026, 8, 1))], {
        navActive: true,
      }),
    );
    await screen.findByText("f1.mp4");
    const slider = screen.getByRole("slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(slider, { key: "Enter", code: "Enter" });
    // The list's own key handling took neither press.
    expect(
      document.querySelector('[data-testid="media-card"][aria-current]'),
    ).toBeNull();
  });

  it("reads the counts again when a loaded file sits under another day, then realigns the list", async () => {
    mocks.timelineCounts.mockResolvedValue({
      days: [{ day: "2026-10-15", count: 1 }],
      undated: 0,
    });
    const onAnchor = vi.fn();
    renderWithProviders(view([dated(1, at(2026, 8, 1))], { onAnchor }));
    await screen.findByText("f1.mp4");
    // One recount for this window, and no more however often it answers.
    await waitFor(() => expect(mocks.timelineCounts.mock.calls.length).toBe(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(mocks.timelineCounts.mock.calls.length).toBe(2);
    // Still disagreeing with fresh counts: the list is read again from the
    // top of the view instead.
    expect(onAnchor).toHaveBeenCalled();
  });
});
