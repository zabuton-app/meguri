import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import Tags from "@/routes/Tags";
import { defaultAppStatus, defaultWorkspacesList } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { onApplyTagFilter } from "@/lib/ui-events";
import type {
  AppStatus,
  TagList,
  TagSummary,
  WorkspacesList,
} from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  workspacesList: vi.fn<() => Promise<WorkspacesList>>(),
  tagsListAll: vi.fn<() => Promise<TagList>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    tagsListAll: () => mocks.tagsListAll(),
  },
}));

function tag(namespace: string, name: string, fileCount: number): TagSummary {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [
      { source: namespace ? "auto-meta" : "manual", count: fileCount },
    ],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws"],
  };
}

const CATALOG: TagList = {
  tags: [
    tag("", "beach", 12),
    tag("", "summer trip", 5),
    tag("", "sunset", 1),
    tag("res", "4k", 40),
  ],
  truncated: false,
};

function render() {
  // The view is persisted, so the screen opens straight on the cloud.
  localStorage.setItem("meguri.tags.view", "cloud");
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div data-testid="home" />} />
      <Route path="/tags" element={<Tags />} />
    </Routes>,
    { route: "/tags" },
  );
}

const fontSizeOf = (name: string) =>
  parseFloat(screen.getByText(name, { selector: "button" }).style.fontSize);

describe("Tags screen, cloud view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // jsdom has no 2D context; the screen falls back to estimating text width.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.tagsListAll.mockResolvedValue(CATALOG);
  });

  it("sizes each tag by how many files carry it", async () => {
    render();
    await screen.findByText("beach");
    expect(fontSizeOf("beach")).toBeGreaterThan(fontSizeOf("summer trip"));
    expect(fontSizeOf("summer trip")).toBeGreaterThan(fontSizeOf("sunset"));
    // Three words leave the area (1200x800 in this setup) mostly empty, so the
    // cloud is blown up as far as it goes: the largest font times 1.6.
    expect(fontSizeOf("beach")).toBeCloseTo(46 * 1.6, 3);
    expect(screen.getByLabelText("beach (12 files)")).toBeTruthy();
  });

  it("measures the labels in the font they are drawn in", async () => {
    const fonts: string[] = [];
    const ctx = {
      set font(value: string) {
        fonts.push(value);
      },
      measureText: (text: string) => ({ width: text.length * 10 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    render();
    const beach = await screen.findByText("beach");
    expect(fonts[0]).toMatch(/^500 \d+px \S/);
    // The cloud is at least as wide as its widest label by that measure
    // ("summer trip": 11 glyphs), at whatever scale it was fitted to.
    const scale = parseFloat(beach.style.fontSize) / 46;
    const list = beach.closest("ul")!;
    expect(parseFloat(list.style.width)).toBeGreaterThanOrEqual(110 * scale);
  });

  it("leaves generated tags out until asked for them", async () => {
    render();
    await screen.findByText("beach");
    expect(screen.queryByText("res:4k")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Automatic tags" }));
    expect(await screen.findByText("res:4k")).toBeTruthy();
    expect(localStorage.getItem("meguri.tags.cloudIncludeAuto")).toBe("true");
  });

  it("filters the library by the clicked tag and closes", async () => {
    const applied = vi.fn();
    const off = onApplyTagFilter(applied);
    render();
    fireEvent.click(await screen.findByText("summer trip"));
    off();

    // A name with a space travels as one quoted directive.
    expect(applied).toHaveBeenCalledWith(['tag:"summer trip"']);
    await waitFor(() => expect(screen.getByTestId("home")).toBeTruthy());
  });

  it("points at the toggle when only generated tags exist", async () => {
    mocks.tagsListAll.mockResolvedValue({
      tags: [tag("res", "4k", 40)],
      truncated: false,
    });
    render();
    expect(await screen.findByText(/Only automatic tags/)).toBeTruthy();
  });

  it("shows the empty state when there are no tags at all", async () => {
    mocks.tagsListAll.mockResolvedValue({ tags: [], truncated: false });
    render();
    expect(await screen.findByText("No tags yet.")).toBeTruthy();
  });

  it("narrows the cloud with the filter box", async () => {
    render();
    await screen.findByText("beach");
    fireEvent.change(screen.getByLabelText("Filter tags"), {
      target: { value: "sun" },
    });
    await waitFor(() => expect(screen.queryByText("beach")).toBeNull());
    expect(screen.getByText("sunset")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter tags"), {
      target: { value: "zzz" },
    });
    expect(await screen.findByText("No matching tags.")).toBeTruthy();
  });

  it("switches between the list and the cloud and remembers the choice", async () => {
    render();
    await screen.findByText("beach");
    // The list's controls are gone while the cloud is up.
    expect(screen.queryByText("By name")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(await screen.findByText("Manual tags")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Automatic tags" })).toBeNull();
    expect(localStorage.getItem("meguri.tags.view")).toBe("list");
  });

  it("keeps a selection made in the list while the cloud is up", async () => {
    render();
    await screen.findByText("beach");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getByRole("checkbox", { name: "beach" }));
    expect(screen.getByText("1 selected")).toBeTruthy();

    // No checkboxes in the cloud, so no bar acting on tags that are not shown.
    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());

    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(await screen.findByText("1 selected")).toBeTruthy();
  });

  it("says so when the catalog itself was cut short", async () => {
    mocks.tagsListAll.mockResolvedValue({ ...CATALOG, truncated: true });
    render();
    await screen.findByText("beach");
    expect(screen.getByText(/Too many tags/)).toBeTruthy();
  });
});
