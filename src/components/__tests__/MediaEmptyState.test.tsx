import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("MediaEmptyState", () => {
  it("tells the user to scan for a regular empty workspace", () => {
    renderWithProviders(<MediaEmptyState />);

    expect(screen.getByText("No media to display.")).toBeTruthy();
    expect(screen.getByText(/Scan/i)).toBeTruthy();
  });

  it("explains Watch Later instead of prompting a scan", () => {
    renderWithProviders(<MediaEmptyState watchLater />);

    expect(screen.getByText("Watch Later is empty.")).toBeTruthy();
    // A scan would never populate Watch Later, so that hint must not appear.
    expect(screen.queryByText(/Scan/i)).toBeNull();
    expect(screen.getByText(/clock icon/i)).toBeTruthy();
  });
});
