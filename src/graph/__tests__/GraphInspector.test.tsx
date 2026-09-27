// The inspector's tag view: its files by name, their count, and the actions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { GraphInspector } from "../GraphInspector";
import { visibleSet } from "../model/visibility";
import { fk, graphOf, tk } from "./fixtures";

afterEach(cleanup);

const graph = graphOf([
  { path: "Ep10.mp4", tags: ["cat"] },
  { path: "Ep2.mp4", tags: ["cat"] },
]);
const visibility = visibleSet(graph, {
  edgeSources: {},
  showAutoTags: false,
  showOrphans: false,
});

function render(selected: string | null) {
  const handlers = {
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onFilterTag: vi.fn(),
    onClear: vi.fn(),
  };
  renderWithProviders(
    <GraphInspector
      graph={graph}
      visibility={visibility}
      selected={selected}
      mediaBase="http://127.0.0.1:1"
      {...handlers}
    />,
  );
  return handlers;
}

describe("GraphInspector", () => {
  it("lists a tag's files in natural order and filters by it", () => {
    const h = render(tk("cat"));
    expect(screen.getByText("Files with this tag")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
    const names = [...document.querySelectorAll("li button")].map(
      (b) => b.textContent,
    );
    expect(names).toEqual(["Ep2.mp4", "Ep10.mp4"]);
    fireEvent.click(screen.getByRole("button", { name: /Filter by this tag/ }));
    expect(h.onFilterTag).toHaveBeenCalledWith(tk("cat"));
    fireEvent.click(screen.getByRole("button", { name: "Ep2.mp4" }));
    expect(h.onSelect).toHaveBeenCalledWith(fk("Ep2.mp4"));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(h.onClear).toHaveBeenCalled();
  });

  it("shows a placeholder for a file without a thumbnail", () => {
    render(fk("Ep2.mp4"));
    expect(screen.getByText("No thumbnail")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open/ })).toBeTruthy();
  });

  it("shows the overview when nothing is selected", () => {
    render(null);
    expect(screen.getByText("Most connected")).toBeTruthy();
  });
});
