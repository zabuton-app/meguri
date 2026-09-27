// The graph view around its canvas: data in, inspector, toggles, empty and
// truncated states, keyboard, and the WebGL-unavailable fallback. sigma needs
// WebGL, which jsdom lacks, so GraphCanvas is replaced by a stub that lists
// the visible nodes as buttons and records what it was given.
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
    selected: string | null;
  },
  fit: vi.fn(),
}));
vi.mock("../GraphCanvas", async () => {
  const React = await import("react");
  return {
    GraphCanvas: (props: {
      graph: MediaGraph;
      visibility: Visibility;
      focus: string | null;
      selected: string | null;
      onClickNode: (key: string) => void;
      onDoubleClickNode: (key: string) => void;
      onClickStage: () => void;
      ref?: React.Ref<unknown>;
    }) => {
      if (canvas.fail) throw new Error("no WebGL");
      canvas.renders += 1;
      canvas.props = props;
      React.useImperativeHandle(props.ref, () => ({
        fit: canvas.fit,
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        focus: vi.fn(),
        refresh: vi.fn(),
      }));
      return (
        <div data-testid="canvas">
          {[...props.visibility.nodes].map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`node ${key}`}
              onClick={() => props.onClickNode(key)}
              onDoubleClick={() => props.onDoubleClickNode(key)}
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

const FILES = [
  { path: "a.mp4", tags: ["sea", "summer"] },
  { path: "b.jpg", kind: "image", tags: ["sea", "summer"] },
  { path: "c.mp4", tags: ["sea", "res:4k"] },
  { path: "lone.mp4" },
];

function render(onFilterToken = vi.fn()) {
  return renderWithProviders(
    <GraphView
      scope="w"
      query={{}}
      mediaBase="http://127.0.0.1:1"
      ready
      keysActive
      onFilterToken={onFilterToken}
    />,
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
    // Overview: 3 files, 2 tags, 6 links.
    const inspector = screen.getByRole("complementary", { name: "Details" });
    expect(inspector.textContent).toContain("Most connected");
    expect(inspector.textContent).toMatch(/3\s*Files/);
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
    expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
  });

  it("selects a file, ranks related files and opens it", async () => {
    render();
    await ready();
    fireEvent.click(screen.getByTestId(`node ${fk("a.mp4")}`));
    const inspector = screen.getByRole("complementary", { name: "Details" });
    await waitFor(() =>
      expect(inspector.textContent).toContain("Related files"),
    );
    const rows = [...inspector.querySelectorAll("li button")].map(
      (b) => b.textContent,
    );
    // Tag chips first, then b (2 shared) before c (1 shared).
    const related = rows.filter(
      (r) => r?.includes(".mp4") || r?.includes(".jpg"),
    );
    expect(related[0]).toContain("b.jpg");
    expect(related[1]).toContain("c.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(nav.navigate).toHaveBeenCalledWith("/file/1?ws=w");
  });

  it("opens a file on double click and filters by a tag on double click", async () => {
    const onFilter = vi.fn();
    render(onFilter);
    await ready();
    fireEvent.doubleClick(screen.getByTestId(`node ${fk("b.jpg")}`));
    expect(nav.navigate).toHaveBeenCalledWith("/file/2?ws=w");
    fireEvent.doubleClick(screen.getByTestId(`node ${tk("sea")}`));
    expect(onFilter).toHaveBeenCalledWith("tag:sea");
  });

  it("clears the selection with Escape and the stage, and fits with F", async () => {
    render();
    await ready();
    fireEvent.click(screen.getByTestId(`node ${fk("a.mp4")}`));
    await waitFor(() => expect(canvas.props?.selected).toBe(fk("a.mp4")));
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    act(() => void window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    await waitFor(() => expect(canvas.props?.selected).toBeNull());
    fireEvent.click(screen.getByTestId(`node ${fk("a.mp4")}`));
    fireEvent.click(screen.getByTestId("stage"));
    await waitFor(() => expect(canvas.props?.selected).toBeNull());
    fireEvent.keyDown(window, { key: "f" });
    expect(canvas.fit).toHaveBeenCalled();
  });

  it("drops a selection the new data no longer has", async () => {
    const { queryClient } = render();
    await ready();
    fireEvent.click(screen.getByTestId(`node ${fk("c.mp4")}`));
    await waitFor(() => expect(canvas.props?.selected).toBe(fk("c.mp4")));
    api.graphBuild.mockResolvedValue(payloadOf(FILES.slice(0, 2)));
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["graph_build"] }),
    );
    await waitFor(() => expect(canvas.props?.selected).toBeNull());
  });

  it("limits the graph to the selection's neighbourhood in local mode", async () => {
    render();
    await ready();
    const local = screen.getByRole("button", { name: "Local" });
    expect((local as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`node ${fk("c.mp4")}`));
    await waitFor(() =>
      expect((local as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(local);
    await waitFor(() =>
      expect([...(canvas.props?.visibility.nodes ?? [])].sort()).toEqual(
        [fk("c.mp4"), tk("sea")].sort(),
      ),
    );
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await waitFor(() =>
      expect(canvas.props?.visibility.nodes.has(fk("a.mp4"))).toBe(true),
    );
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

  it("finds a node by name and selects it", async () => {
    render();
    await ready();
    const box = screen.getByRole("combobox", { name: "Search the graph" });
    fireEvent.change(box, { target: { value: "B.J" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(canvas.props?.selected).toBe(fk("b.jpg")));
  });

  it("saves positions once the layout ends", async () => {
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
