import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HeatmapView } from "@/heatmap/HeatmapView";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { ActivityMetric } from "@shared/ipc/activity";

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

function renderGraph(props: Partial<Parameters<typeof HeatmapView>[0]> = {}) {
  const onDayChange = vi.fn();
  const onMetricChange = vi.fn();
  renderWithProviders(
    <HeatmapView
      scope="ws"
      query={{}}
      ready
      metric="played"
      onMetricChange={onMetricChange}
      day={null}
      onDayChange={onDayChange}
      {...props}
    />,
  );
  return { onDayChange, onMetricChange };
}

describe("HeatmapView", () => {
  beforeEach(() => {
    // Only the clock: the queries still settle on real timers' microtasks.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    mocks.activityDays.mockReset();
    mocks.activityDays.mockResolvedValue({
      days: [
        { date: "2026-10-01", count: 1 },
        { date: "2026-10-03", count: 16 },
      ],
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
    const { onDayChange } = renderGraph();
    await waitFor(() => expect(mocks.activityDays).toHaveBeenCalled());

    fireEvent.click(cell("2026-10-03"));
    expect(onDayChange).toHaveBeenLastCalledWith("2026-10-03");
  });

  it("marks the picked day, and lets it go on a second click", async () => {
    const { onDayChange } = renderGraph({ day: "2026-10-03" });
    await waitFor(() => expect(cell("2026-10-03").dataset.level).toBe("4"));
    expect(cell("2026-10-03").getAttribute("aria-pressed")).toBe("true");
    expect(cell("2026-10-01").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(cell("2026-10-03"));
    expect(onDayChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Show all days" }));
    expect(onDayChange).toHaveBeenCalledTimes(2);
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

  it("opens on the page of a day picked earlier", async () => {
    // Home keeps the day across view modes; the page must follow it back.
    renderGraph({ day: "2024-05-01" });
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        from: "2024-01-01",
        to: "2024-12-31",
      }),
    );
    expect(cell("2024-05-01").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("2024")).toBeTruthy();
  });

  it("pages back through whole years and forward to today again", async () => {
    const { onDayChange } = renderGraph({ day: "2026-10-03" });
    const next = screen.getByRole("button", { name: "Next year" });
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        from: "2025-01-01",
        to: "2025-12-31",
      }),
    );
    // The day picked belonged to the page left behind.
    expect(onDayChange).toHaveBeenLastCalledWith(null);
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
