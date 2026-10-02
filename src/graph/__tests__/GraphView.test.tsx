// The graph view around its canvas: data in, toggles, the
// settings panel, empty and truncated states, keyboard, and the
// WebGL-unavailable fallback. sigma needs WebGL, which jsdom lacks, so
// GraphCanvas is replaced by a stub that lists the visible nodes as buttons
// and records what it was given. jsdom has no Worker either, so the
// simulation keeps the placed positions and reports idle at once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { GraphPayload } from "@shared/ipc/graph";
import { renderWithProviders } from "@/test/renderWithProviders";
import { GRAPH_OPTIONS_KEY } from "../graphOptions";
import { GRAPH_SETTINGS_KEY } from "../graphSettings";
import type { MediaGraph } from "../model/types";
import type { Visibility } from "../model/visibility";
import { fk, payloadOf, tk } from "./fixtures";

const api = vi.hoisted(() => ({
  graphBuild: vi.fn(),
  graphLayoutGet: vi.fn(),
  graphLayoutSet: vi.fn(),
}));
vi.mock("@/ipc/client", () => ({ api }));

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => nav.navigate,
}));

const canvas = vi.hoisted(() => ({
  fail: false,
  renders: 0,
  props: null as null | {
    graph: MediaGraph;
    visibility: Visibility;
    focus: string | null;
  },
  fit: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("../GraphCanvas", async () => {
  const React = await import("react");
  return {
    GraphCanvas: (props: {
      graph: MediaGraph;
      visibility: Visibility;
      focus: string | null;
      onClickNode: (key: string) => void;
      onClickStage: () => void;
      onDragStart: (key: string) => boolean;
      onDrag: (key: string, x: number, y: number) => void;
      onDragEnd: (key: string) => void;
      ref?: React.Ref<unknown>;
    }) => {
      if (canvas.fail) throw new Error("no WebGL");
      canvas.renders += 1;
      canvas.props = props;
      React.useImperativeHandle(props.ref, () => ({
        fit: canvas.fit,
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        focus: canvas.focus,
      }));
      return (
        <div data-testid="canvas">
          {[...props.visibility.nodes].map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`node ${key}`}
              onClick={() => props.onClickNode(key)}
              onMouseDown={() => {
                if (props.onDragStart(key)) props.onDrag(key, 123, 45);
              }}
              onMouseUp={() => props.onDragEnd(key)}
            />
          ))}
          <button
            type="button"
            data-testid="stage"
            onClick={props.onClickStage}
          />
        </div>
      );
    },
  };
});

// Imported after the mocks.
const { GraphView } = await import("../GraphView");
const { SimClient } = await import("../sim/simClient");

const FILES = [
  { path: "a.mp4", tags: ["sea", "summer"] },
  { path: "b.jpg", kind: "image", tags: ["sea", "summer"] },
  { path: "c.mp4", tags: ["sea", "res:4k"] },
  { path: "lone.mp4" },
];

function render(onFilterToken = vi.fn(), route = "/") {
  return renderWithProviders(
    <GraphView
      scope="w"
      query={{}}
      ready
      keysActive
      onFilterToken={onFilterToken}
    />,
    { route },
  );
}

beforeEach(() => {
  canvas.fail = false;
  canvas.props = null;
  api.graphBuild.mockResolvedValue(payloadOf(FILES));
  api.graphLayoutGet.mockResolvedValue(null);
  api.graphLayoutSet.mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function ready() {
  await screen.findByTestId(`node ${fk("a.mp4")}`);
}

describe("GraphView", () => {
  it("draws the files and tags, hiding generated tags and orphans by default", async () => {
    render();
    await ready();
    expect(screen.getByTestId(`node ${tk("sea")}`)).toBeTruthy();
    expect(screen.queryByTestId(`node ${tk("res:4k")}`)).toBeNull();
    expect(screen.queryByTestId(`node ${fk("lone.mp4")}`)).toBeNull();
    // Every shown node has a real position, framed once (both done in an
    // effect, which may land after the first paint).
    await waitFor(() => expect(canvas.fit).toHaveBeenCalledWith(false));
    const g = canvas.props?.graph;
    for (const key of canvas.props?.visibility.nodes ?? []) {
      const { x, y } = g?.getNodeAttributes(key) ?? { x: NaN, y: NaN };
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it("draws without a cache when the cache cannot be read, and settles", async () => {
    api.graphLayoutGet.mockRejectedValue(new Error("boom"));
    render();
    await screen.findByTestId(`node ${fk("a.mp4")}`, {}, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 50));
    // A cache stand-in that changed identity every render would rebuild the
    // graph, and so re-render, without end.
    const renders = canvas.renders;
    await new Promise((r) => setTimeout(r, 100));
    expect(canvas.renders).toBe(renders);
    expect(canvas.props?.visibility.nodes.size).toBeGreaterThan(0);
  });

  it("says when the graph could not be loaded", async () => {
    api.graphBuild.mockRejectedValue(new Error("boom"));
    render();
    expect(
      await screen.findByText(
        "Could not load the graph",
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
  });

  it("shows the empty state when nothing connects", async () => {
    api.graphBuild.mockResolvedValue(payloadOf([{ path: "lone.mp4" }]));
    render();
    expect(await screen.findByText("No connections to show")).toBeTruthy();
  });

  it("says when the cap cut the list", async () => {
    const p: GraphPayload = {
      ...payloadOf(FILES),
      totalFiles: 9000,
      truncated: true,
    };
    api.graphBuild.mockResolvedValue(p);
    render();
    expect(await screen.findByText(/Showing 4 of 9,000 files/)).toBeTruthy();
  });

  it("falls back to a notice when the canvas cannot start", async () => {
    canvas.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    render();
    expect(await screen.findByText(/not available here/)).toBeTruthy();
    expect(screen.getByRole("toolbar")).toBeTruthy();
  });

  it("opens a file on click and filters by a tag on click", async () => {
    const onFilter = vi.fn();
    render(onFilter);
    await ready();
    fireEvent.click(screen.getByTestId(`node ${fk("b.jpg")}`));
    expect(nav.navigate).toHaveBeenCalledWith("/file/2?ws=w");
    fireEvent.click(screen.getByTestId(`node ${tk("sea")}`));
    expect(onFilter).toHaveBeenCalledWith("tag:sea");
  });

  it("opens from the search with Shift+Enter, or the picked node with Enter", async () => {
    const onFilter = vi.fn();
    render(onFilter);
    await ready();
    nav.navigate.mockClear();
    const box = screen.getByRole("combobox", { name: "Search the graph" });
    fireEvent.change(box, { target: { value: "B.J" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(nav.navigate).toHaveBeenCalledWith("/file/2?ws=w");
    fireEvent.change(box, { target: { value: "sea" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onFilter).not.toHaveBeenCalled();
    await waitFor(() => expect(canvas.props?.focus).toBe(tk("sea")));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onFilter).toHaveBeenCalledWith("tag:sea");
  });

  it("highlights a node found by name until Escape or the stage, and fits with F", async () => {
    render();
    await ready();
    const box = screen.getByRole("combobox", { name: "Search the graph" });
    fireEvent.change(box, { target: { value: "B.J" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(canvas.props?.focus).toBe(fk("b.jpg")));
    expect(canvas.focus).toHaveBeenCalledWith(fk("b.jpg"));
    (document.activeElement as HTMLElement | null)?.blur();
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    act(() => void window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    await waitFor(() => expect(canvas.props?.focus).toBeNull());
    fireEvent.change(box, { target: { value: "B.J" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(canvas.props?.focus).toBe(fk("b.jpg")));
    fireEvent.click(screen.getByTestId("stage"));
    await waitFor(() => expect(canvas.props?.focus).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "f" });
    expect(canvas.fit).toHaveBeenCalledWith();
  });

  it("drops a highlight the new data no longer has", async () => {
    const { queryClient } = render();
    await ready();
    const box = screen.getByRole("combobox", { name: "Search the graph" });
    fireEvent.change(box, { target: { value: "c.mp4" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(canvas.props?.focus).toBe(fk("c.mp4")));
    api.graphBuild.mockResolvedValue(payloadOf(FILES.slice(0, 2)));
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["graph_build"] }),
    );
    await waitFor(() => expect(canvas.props?.focus).toBeNull());
  });

  it("remembers the toggles", async () => {
    render();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Auto tags" }));
    fireEvent.click(screen.getByRole("button", { name: "Orphans" }));
    await screen.findByTestId(`node ${tk("res:4k")}`);
    expect(screen.getByTestId(`node ${fk("lone.mp4")}`)).toBeTruthy();
    expect(
      JSON.parse(localStorage.getItem(GRAPH_OPTIONS_KEY) ?? "{}"),
    ).toMatchObject({
      showAutoTags: true,
      showOrphans: true,
    });
    cleanup();
    render();
    await screen.findByTestId(`node ${tk("res:4k")}`);
  });

  it("drags a node: held where the pointer is, let go on release", async () => {
    const drag = vi.spyOn(SimClient.prototype, "drag");
    const release = vi.spyOn(SimClient.prototype, "release");
    render();
    await ready();
    fireEvent.mouseDown(screen.getByTestId(`node ${fk("a.mp4")}`));
    // Pinned where it was, then moved with the pointer.
    expect(drag).toHaveBeenCalledTimes(2);
    const [index] = drag.mock.calls[0];
    expect(drag.mock.calls[1]).toEqual([index, 123, 45]);
    await waitFor(() => expect(canvas.props?.focus).toBe(fk("a.mp4")));
    fireEvent.mouseUp(screen.getByTestId(`node ${fk("a.mp4")}`));
    expect(release).toHaveBeenCalledWith(index);
    await waitFor(() => expect(canvas.props?.focus).toBeNull());
  });

  it("cools the graph down when the dragged node left with the data", async () => {
    const release = vi.spyOn(SimClient.prototype, "release");
    const { queryClient } = render();
    await ready();
    fireEvent.mouseDown(screen.getByTestId(`node ${fk("c.mp4")}`));
    api.graphBuild.mockResolvedValue(payloadOf(FILES.slice(0, 2)));
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["graph_build"] }),
    );
    await waitFor(() =>
      expect(canvas.props?.visibility.nodes.has(fk("c.mp4"))).toBe(false),
    );
    // The canvas ends the drag of a node that is gone.
    const props = canvas.props as unknown as { onDragEnd: (k: string) => void };
    act(() => props.onDragEnd(fk("c.mp4")));
    expect(release).toHaveBeenCalledWith(null);
  });

  it("applies and remembers the forces from the settings panel", async () => {
    const setPhysics = vi.spyOn(SimClient.prototype, "setPhysics");
    render();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Graph settings" }));
    const repel = screen.getByRole("slider", { name: "Repel force" });
    fireEvent.change(repel, { target: { value: "2" } });
    await waitFor(() =>
      expect(setPhysics).toHaveBeenLastCalledWith(
        expect.objectContaining({ repelStrength: 8 }),
      ),
    );
    expect(
      JSON.parse(localStorage.getItem(GRAPH_SETTINGS_KEY) ?? "{}"),
    ).toMatchObject({ forces: { repel: 2 } });
    fireEvent.click(screen.getByRole("radio", { name: "Plays" }));
    expect(
      JSON.parse(localStorage.getItem(GRAPH_SETTINGS_KEY) ?? "{}"),
    ).toMatchObject({ display: { sizeBy: "plays" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    await waitFor(() =>
      expect(setPhysics).toHaveBeenLastCalledWith(
        expect.objectContaining({ repelStrength: 1000 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("slider", { name: "Repel force" })).toBeNull();
  });

  it("saves positions once the simulation cools down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render();
      await ready();
      await act(() => vi.advanceTimersByTimeAsync(3_000));
      expect(api.graphLayoutSet).toHaveBeenCalled();
      const [scope, keys, xy] = api.graphLayoutSet.mock.calls[0] as [
        string,
        string[],
        number[],
      ];
      expect(scope).toBe("w");
      expect(xy).toHaveLength(keys.length * 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
