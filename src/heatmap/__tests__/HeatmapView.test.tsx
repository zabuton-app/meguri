import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HeatmapView } from "@/heatmap/HeatmapView";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { ActivityMetric } from "@shared/ipc/activity";
import { daySeconds, parseDay } from "@shared/day";
import type { SearchQuery } from "@/ipc/types";

interface Request {
  query: Record<string, unknown>;
  metric: ActivityMetric;
  from: string;
  to: string;
}

const mocks = vi.hoisted(() => ({
  activityDays: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: { activityDays: (input: unknown) => mocks.activityDays(input) },
}));

function lastRequest(): Request {
  const calls = mocks.activityDays.mock.calls;
  return calls[calls.length - 1][0] as Request;
}

function cell(day: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
  if (!el) throw new Error(`no cell for ${day}`);
  return el;
}

/** A query whose played range is exactly `day`: what picking it sets. */
function playedOn(day: string, lastDay = day): SearchQuery {
  return {
    playedFrom: daySeconds(parseDay(day)!)[0],
    playedTo: daySeconds(parseDay(lastDay)!)[1],
  };
}

function renderGraph(props: Partial<Parameters<typeof HeatmapView>[0]> = {}) {
  const onRangeChange = vi.fn();
  const onMetricChange = vi.fn();
  renderWithProviders(
    <HeatmapView
      scope="ws"
      query={{}}
      ready
      metric="played"
      onMetricChange={onMetricChange}
      onRangeChange={onRangeChange}
      {...props}
    />,
  );
  return { onRangeChange, onMetricChange };
}

describe("HeatmapView", () => {
  beforeEach(() => {
    // Only the clock: the queries still settle on real timers' microtasks.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    mocks.activityDays.mockReset();
    // Like the main process: only the days of the range asked for.
    mocks.activityDays.mockImplementation((input) => {
      const { from, to } = input as Request;
      return Promise.resolve({
        days: [
          { date: "2026-10-01", count: 1 },
          { date: "2026-10-03", count: 16 },
        ].filter((d) => d.date >= from && d.date <= to),
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the year ending today and shades the days by their count", async () => {
    renderGraph({ query: { favorite: true, sort: "name", limit: 50 } });

    await waitFor(() => expect(cell("2026-10-03").dataset.level).toBe("4"));
    expect(cell("2026-10-01").dataset.level).toBe("1");
    expect(cell("2026-10-02").dataset.level).toBe("0");
    expect(cell("2026-10-03").getAttribute("aria-label")).toContain("16");
    // What the counts do not depend on stays out of the request.
    expect(lastRequest()).toEqual({
      query: { favorite: true },
      metric: "played",
      from: "2025-10-05",
      to: "2026-10-05",
    });
    // Nothing is drawn past today.
    expect(document.querySelector('[data-day="2026-10-06"]')).toBeNull();
  });

  it("picks a day", async () => {
    const { onRangeChange } = renderGraph();
    await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());

    fireEvent.click(cell("2026-10-03"));
    expect(onRangeChange).toHaveBeenLastCalledWith({
      from: "2026-10-03",
      to: "2026-10-03",
    });
  });

  it("marks the picked day, and lets it go on a second click", async () => {
    const { onRangeChange } = renderGraph({ query: playedOn("2026-10-03") });
    await waitFor(() => expect(cell("2026-10-03").dataset.level).toBe("4"));
    // The range is the day picked, not a condition of the counts.
    expect(lastRequest().query).toEqual({});
    expect(cell("2026-10-03").getAttribute("aria-pressed")).toBe("true");
    expect(cell("2026-10-01").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(cell("2026-10-03"));
    expect(onRangeChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the days picked" }),
    );
    expect(onRangeChange).toHaveBeenCalledTimes(2);
  });

  it("offers the metrics as one choice", () => {
    const { onMetricChange } = renderGraph({ metric: "captured" });
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Played",
      "Captured",
      "Created",
      "Added",
    ]);
    expect(
      screen
        .getByRole("radio", { name: "Captured" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Created" }));
    expect(onMetricChange).toHaveBeenCalledWith("created");
  });

  it("marks every day of a longer range, and narrows it to the cell clicked", async () => {
    const { onRangeChange } = renderGraph({
      query: playedOn("2026-10-01", "2026-10-03"),
    });
    await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"])
      expect(cell(day).getAttribute("aria-pressed")).toBe("true");
    expect(cell("2026-09-30").getAttribute("aria-pressed")).toBe("false");
    expect(cell("2026-10-04").getAttribute("aria-pressed")).toBe("false");
    // No one day to count: the range is named by its ends.
    expect(screen.getByText("Oct 1, 2026 – Oct 3, 2026")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the days picked" }),
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(cell("2026-10-02"));
    expect(onRangeChange).toHaveBeenLastCalledWith({
      from: "2026-10-02",
      to: "2026-10-02",
    });
  });

  describe("dragging across days", () => {
    const press = (day: string) =>
      fireEvent.pointerDown(cell(day), { button: 0, pointerId: 1 });
    const over = (day: string) =>
      fireEvent.pointerOver(cell(day), { pointerId: 1 });
    const pressed = () =>
      [...document.querySelectorAll<HTMLElement>('[aria-pressed="true"]')]
        .map((c) => c.dataset.day)
        .filter(Boolean)
        .sort();

    it("picks the days between where it starts and where it ends", async () => {
      const { onRangeChange } = renderGraph();
      await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());

      press("2026-09-29");
      over("2026-09-30");
      over("2026-10-02");
      // Shown as it goes, written only on release.
      expect(pressed()).toEqual([
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ]);
      expect(screen.getByText("Sep 29, 2026 – Oct 2, 2026")).toBeTruthy();
      expect(onRangeChange).not.toHaveBeenCalled();

      fireEvent.pointerUp(window);
      expect(onRangeChange).toHaveBeenCalledTimes(1);
      expect(onRangeChange).toHaveBeenLastCalledWith({
        from: "2026-09-29",
        to: "2026-10-02",
      });
      // Nothing is left of the drag: the filter is what marks the cells now.
      expect(pressed()).toEqual([]);
    });

    it("runs backwards as well, and ends outside the grid", async () => {
      const { onRangeChange } = renderGraph();
      await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
      press("2026-10-03");
      over("2026-09-30");
      // Leaving the cells keeps the last one reached.
      fireEvent.pointerOver(document.body, { pointerId: 1 });
      fireEvent.pointerUp(window);
      expect(onRangeChange).toHaveBeenLastCalledWith({
        from: "2026-09-30",
        to: "2026-10-03",
      });
    });

    it("is a click when it goes nowhere: the one day picked lets go", async () => {
      const { onRangeChange } = renderGraph({ query: playedOn("2026-10-03") });
      await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
      press("2026-10-02");
      fireEvent.pointerUp(window);
      expect(onRangeChange).toHaveBeenLastCalledWith({
        from: "2026-10-02",
        to: "2026-10-02",
      });
      press("2026-10-03");
      fireEvent.pointerUp(window);
      expect(onRangeChange).toHaveBeenLastCalledWith(null);
      // The click that follows a press is the pointer's, already handled.
      fireEvent.click(cell("2026-10-03"), { detail: 1 });
      expect(onRangeChange).toHaveBeenCalledTimes(2);
    });

    it("is given up on Escape or a cancelled pointer, and ignores other buttons", async () => {
      const { onRangeChange } = renderGraph();
      await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
      press("2026-09-29");
      over("2026-10-01");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(pressed()).toEqual([]);
      fireEvent.pointerUp(window);

      press("2026-09-29");
      over("2026-10-01");
      fireEvent.pointerCancel(window);
      expect(pressed()).toEqual([]);

      fireEvent.pointerDown(cell("2026-09-29"), { button: 2, pointerId: 1 });
      over("2026-10-01");
      fireEvent.pointerUp(window);
      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it("extends from the first day picked with Shift", async () => {
      const { onRangeChange } = renderGraph({ query: playedOn("2026-10-01") });
      await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
      // The keyboard's way to a range: Shift+Enter on another day.
      fireEvent.click(cell("2026-10-04"), { shiftKey: true });
      expect(onRangeChange).toHaveBeenLastCalledWith({
        from: "2026-10-01",
        to: "2026-10-04",
      });
      fireEvent.pointerDown(cell("2026-09-28"), { button: 0, pointerId: 1 });
      fireEvent.pointerUp(window, { shiftKey: true });
      expect(onRangeChange).toHaveBeenLastCalledWith({
        from: "2026-09-28",
        to: "2026-10-01",
      });
    });
  });

  it("leaves another metric's range to the counts", async () => {
    const added = { addedFrom: 1, addedTo: 2 };
    renderGraph({ query: added });
    await waitFor(() => expect(lastRequest().query).toEqual(added));
    expect(
      document.querySelector('[data-day][aria-pressed="true"]'),
    ).toBeNull();
  });

  it("opens on the page of a day picked earlier", async () => {
    // The range is part of the filter and outlives the view.
    renderGraph({ query: playedOn("2024-05-01") });
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        from: "2024-01-01",
        to: "2024-12-31",
      }),
    );
    expect(cell("2024-05-01").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("2024")).toBeTruthy();
  });

  it("names a day on another page without a count", async () => {
    renderGraph({ query: playedOn("2026-10-03") });
    await screen.findByText(/: 16 played$/);

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() => expect(lastRequest().from).toBe("2025-01-01"));
    // The list below still shows that day's files: no "0 played" over it.
    await waitFor(() => expect(screen.queryByText(/played$/)).toBeNull());
    expect(
      screen.getByRole("button", { name: "Clear the days picked" }),
    ).toBeTruthy();
  });

  it("turns to the page of a range set from outside the view", async () => {
    const view = (query: SearchQuery) => (
      <HeatmapView
        scope="ws"
        query={query}
        ready
        metric="played"
        onMetricChange={() => {}}
        onRangeChange={() => {}}
      />
    );
    const { rerender } = renderWithProviders(view({}));
    await waitFor(() => expect(lastRequest().from).toBe("2025-10-05"));

    // The panel, or a saved search: a day three years back.
    rerender(view(playedOn("2023-05-01")));
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        from: "2023-01-01",
        to: "2023-12-31",
      }),
    );
    expect(cell("2023-05-01").getAttribute("aria-pressed")).toBe("true");

    // Back to a day of the last twelve months.
    rerender(view(playedOn("2026-10-03")));
    await waitFor(() => expect(lastRequest().from).toBe("2025-10-05"));
  });

  it.each(["2026-12-24", "2027-03-01"])(
    "stays on the year ending today for a day past it (%s)",
    async (day) => {
      // The filter bar's date inputs take any date; no year runs past today.
      renderGraph({ query: playedOn(day) });
      await waitFor(() =>
        expect(lastRequest()).toMatchObject({
          from: "2025-10-05",
          to: "2026-10-05",
        }),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Last 12 months")).toBeTruthy();
    },
  );

  it("pages back through whole years and forward to today again", async () => {
    const { onRangeChange } = renderGraph({ query: playedOn("2026-10-03") });
    const next = screen.getByRole("button", { name: "Next year" });
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        from: "2025-01-01",
        to: "2025-12-31",
      }),
    );
    // Paging only looks elsewhere: the day stays a condition of the list.
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(screen.getByText("2025")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() => expect(lastRequest().from).toBe("2024-01-01"));

    fireEvent.click(next);
    await waitFor(() => expect(lastRequest().from).toBe("2025-01-01"));
    fireEvent.click(next);
    await waitFor(() => expect(lastRequest().from).toBe("2025-10-05"));
    expect(screen.getByText("Last 12 months")).toBeTruthy();
  });

  it("moves between days with the arrow keys, keeping them from the list", async () => {
    renderGraph();
    await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      // The last day shown is the one in the tab order.
      expect(cell("2026-10-05").tabIndex).toBe(0);
      expect(cell("2026-10-04").tabIndex).toBe(-1);
      cell("2026-10-05").focus();

      fireEvent.keyDown(cell("2026-10-05"), { key: "ArrowUp" });
      expect(document.activeElement).toBe(cell("2026-10-04"));
      fireEvent.keyDown(cell("2026-10-04"), { key: "ArrowLeft" });
      expect(document.activeElement).toBe(cell("2026-09-27"));
      fireEvent.keyDown(cell("2026-09-27"), { key: "ArrowRight" });
      // Past the edge of the range there is nowhere to go.
      fireEvent.keyDown(cell("2026-10-04"), { key: "ArrowRight" });
      expect(document.activeElement).toBe(cell("2026-10-04"));
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("says so when the counts cannot be read", async () => {
    mocks.activityDays.mockRejectedValue(new Error("boom"));
    renderGraph();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load the counts",
    );
  });

  it("waits for a workspace before asking", () => {
    renderGraph({ ready: false });
    expect(mocks.activityDays).not.toHaveBeenCalled();
  });
});
