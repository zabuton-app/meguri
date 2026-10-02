import { describe, expect, it } from "vitest";
import { parseViewMode } from "@/routes/Home/utils";

describe("parseViewMode", () => {
  it("keeps the view modes that exist", () => {
    expect(parseViewMode("grid")).toBe("grid");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("graph")).toBe("graph");
  });

  it("moves a stored table view to the list", () => {
    expect(parseViewMode("table")).toBe("list");
  });

  it("falls back to the grid for nothing stored or an unknown value", () => {
    expect(parseViewMode(null)).toBe("grid");
    expect(parseViewMode("mosaic")).toBe("grid");
  });
});
