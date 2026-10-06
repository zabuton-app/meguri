import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TimelineScrubber } from "@/timeline/TimelineScrubber";
import { renderWithProviders } from "@/test/renderWithProviders";

// A list 10,000px tall under an 800px view (the setup stubs clientHeight).
const sections = [
  { key: "2026-10", count: 300, top: 0 },
  { key: "2026-08", count: 2, top: 4000 },
  { key: "2021-03", count: 30, top: 6000 },
  { key: "undated", count: 4, top: 9000 },
];
const days = [
  { key: "2026-10-20", count: 200, top: 0 },
  { key: "2026-10-03", count: 100, top: 2000 },
  { key: "2026-08-09", count: 2, top: 4000 },
  // Two days on the same pixel row of the track (800px tall in the test
  // setup, 12.5px of list per row): only the fuller is drawn.
  { key: "2021-03-11", count: 20, top: 6200 },
  { key: "2021-03-10", count: 10, top: 6203 },
];
const totalSize = 10_000;
const viewHeight = 800;

function rail(
  extra: Partial<React.ComponentProps<typeof TimelineScrubber>> = {},
) {
  return (
    <TimelineScrubber
      sections={sections}
      days={days}
      totalSize={totalSize}
      viewHeight={viewHeight}
      scrollTop={0}
      current="2026-10"
      onScrollTo={() => {}}
      onJump={() => {}}
      {...extra}
    />
  );
}

/** The track, given a box so pointer positions mean something. */
function track(): HTMLElement {
  const el = screen.getByRole("slider");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 400,
    left: 0,
    width: 56,
    bottom: 500,
    right: 56,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  });
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  let captured = false;
  el.setPointerCapture = () => {
    captured = true;
  };
  el.releasePointerCapture = () => {
    captured = false;
  };
  el.hasPointerCapture = () => captured;
  return el;
}

describe("TimelineScrubber", () => {
  it("writes the years along the track where their months start, the tail named too", () => {
    renderWithProviders(rail());
    const years = [...document.querySelectorAll("[data-year]")].map((e) => [
      e.textContent,
      (e as HTMLElement).style.top,
    ]);
    const pct = (top: number) => `${(top / 9200) * 100}%`;
    expect(years).toEqual([
      ["2026", "0%"],
      ["2021", pct(6000)],
      ["No date", pct(9000)],
    ]);
    expect(document.querySelectorAll("[data-month]")).toHaveLength(4);
  });

  it("draws a dot per day, one per pixel row, where no month dot is", () => {
    renderWithProviders(rail());
    expect(
      [...document.querySelectorAll("[data-day]")].map((e) =>
        e.getAttribute("data-day"),
      ),
    ).toEqual(["2026-10-03", "2021-03-11"]);
  });

  it("is a slider over the months, naming the one shown", () => {
    renderWithProviders(rail({ current: "2021-03" }));
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("2");
    expect(slider.getAttribute("aria-valuemax")).toBe("3");
    expect(slider.getAttribute("aria-valuetext")).toBe("March 2021: 30 files");
  });

  it("puts the grip where the list is", () => {
    renderWithProviders(rail({ scrollTop: 4600 }));
    const grip = document.querySelector(
      '[data-slot="timeline-handle"]',
    ) as HTMLElement;
    expect(grip.style.top).toBe("50%");
  });

  it("walks the months from the keyboard", () => {
    const onJump = vi.fn();
    renderWithProviders(rail({ current: "2026-08", onJump }));
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onJump).toHaveBeenLastCalledWith("2021-03");
    // Back from where the last step went (the list has not moved yet).
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onJump).toHaveBeenLastCalledWith("2026-08");
    fireEvent.keyDown(slider, { key: "End" });
    expect(onJump).toHaveBeenLastCalledWith("undated");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onJump).toHaveBeenLastCalledWith("2026-10");
  });

  it("scrolls the list to where the track is pressed and dragged, naming the month", () => {
    const onScrollTo = vi.fn();
    renderWithProviders(rail({ onScrollTo }));
    const el = track();
    // Halfway down a 400px track from y=100: the list scrolled halfway.
    fireEvent.pointerDown(el, { button: 0, clientY: 300, pointerId: 1 });
    expect(onScrollTo).toHaveBeenLastCalledWith(4600);
    // Named by the day at the grip (the list itself has not moved here).
    expect(screen.getByText("October 20, 2026: 200 files")).toBeTruthy();
    fireEvent.pointerMove(el, { clientY: 400, pointerId: 1 });
    expect(onScrollTo).toHaveBeenLastCalledWith(6900);
    fireEvent.pointerUp(el, { pointerId: 1 });
    // Moving without the button down only names the month.
    fireEvent.pointerMove(el, { clientY: 496, pointerId: 1 });
    expect(onScrollTo).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No date: 4 files")).toBeTruthy();
    fireEvent.pointerMove(el, { clientY: 400, pointerId: 1 });
    expect(screen.getByText("March 10, 2021: 10 files")).toBeTruthy();
    fireEvent.pointerLeave(el);
    expect(screen.queryByText("No date: 4 files")).toBeNull();
  });

  it("keeps stepping where the list cannot scroll any further", () => {
    // The last sections fit the view together: a step leaves "2026-08" at
    // the top of the list, and the next step must still go on.
    const onJump = vi.fn();
    renderWithProviders(rail({ current: "2026-08", onJump }));
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onJump).toHaveBeenLastCalledWith("2021-03");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onJump).toHaveBeenLastCalledWith("undated");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onJump).toHaveBeenLastCalledWith("2021-03");
  });

  it("has nothing to walk when the list is empty", () => {
    const onJump = vi.fn();
    renderWithProviders(
      rail({ sections: [], days: [], totalSize: 0, current: null, onJump }),
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(onJump).not.toHaveBeenCalled();
  });
});
