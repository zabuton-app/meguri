import { describe, expect, it } from "vitest";
import {
  hasFolderForm,
  isFolderView,
  parseHeatmapMetric,
  parseTimelineAxis,
  parseViewMode,
  timelineQuery,
} from "@/routes/Home/utils";

describe("parseViewMode", () => {
  it("keeps the view modes that exist", () => {
    expect(parseViewMode("grid")).toBe("grid");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("graph")).toBe("graph");
    expect(parseViewMode("timeline")).toBe("timeline");
  });

  it("moves a stored table view to the list", () => {
    expect(parseViewMode("table")).toBe("list");
  });

  it("falls back to the grid for nothing stored or an unknown value", () => {
    expect(parseViewMode(null)).toBe("grid");
    expect(parseViewMode("mosaic")).toBe("grid");
    // The heatmap is a panel over the views, not one of them.
    expect(parseViewMode("heatmap")).toBe("grid");
  });
});

describe("hasFolderForm", () => {
  it("is the grid and the list only", () => {
    expect(hasFolderForm("grid")).toBe(true);
    expect(hasFolderForm("list")).toBe(true);
    expect(hasFolderForm("graph")).toBe(false);
    expect(hasFolderForm("timeline")).toBe(false);
  });

  it("keeps the folder view off under the graph, option or not", () => {
    const on = { byFolder: true, folderAvailable: true };
    expect(isFolderView({ ...on, view: "list" })).toBe(true);
    expect(isFolderView({ ...on, view: "graph" })).toBe(false);
    expect(isFolderView({ ...on, view: "timeline" })).toBe(false);
    expect(isFolderView(on)).toBe(true);
  });
});

describe("parseHeatmapMetric", () => {
  it("keeps a stored metric and falls back to plays", () => {
    expect(parseHeatmapMetric("captured")).toBe("captured");
    expect(parseHeatmapMetric("created")).toBe("created");
    expect(parseHeatmapMetric("added")).toBe("added");
    expect(parseHeatmapMetric(null)).toBe("played");
    expect(parseHeatmapMetric("liked")).toBe("played");
  });
});

describe("parseTimelineAxis", () => {
  it("keeps a stored axis and falls back to the capture date", () => {
    expect(parseTimelineAxis("captured")).toBe("captured");
    expect(parseTimelineAxis("btime")).toBe("btime");
    expect(parseTimelineAxis("added")).toBe("added");
    expect(parseTimelineAxis(null)).toBe("captured");
    // The heatmap's other metrics are not axes.
    expect(parseTimelineAxis("played")).toBe("captured");
    expect(parseTimelineAxis("created")).toBe("captured");
  });
});

describe("timelineQuery", () => {
  it("orders the filter by the axis, newest first, leaving the filter alone", () => {
    const filter = {
      kind: "video" as const,
      sort: "name",
      sortDir: "asc" as const,
    };
    expect(timelineQuery(filter, "captured")).toEqual({
      kind: "video",
      sort: "captured",
      sortDir: "desc",
    });
    expect(timelineQuery(filter, "btime").sort).toBe("btime");
    // The index's own date has a sort key of its own ("added" is the id order).
    expect(timelineQuery(filter, "added").sort).toBe("addedAt");
    expect(filter.sort).toBe("name");
  });
});
