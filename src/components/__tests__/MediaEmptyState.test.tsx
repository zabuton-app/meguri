import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MediaEmptyState } from "@/components/MediaEmptyState";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("MediaEmptyState", () => {
  it("explains empty filter results without suggesting a scan", () => {
    renderWithProviders(<MediaEmptyState filtered />);

    expect(screen.getByRole("status").textContent).toContain(
      "No files match these filter criteria.",
    );
    expect(
      screen.getByText(/active bin rules and filters above/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Run.*Scan/i)).toBeNull();
  });

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

  it("says a folder search found nothing, without prompting a scan", () => {
    renderWithProviders(<MediaEmptyState inFolder />);

    expect(screen.getByText("Nothing in this folder matches")).toBeTruthy();
    expect(screen.getByText(/folder further up/i)).toBeTruthy();
    expect(screen.queryByText(/Scan/i)).toBeNull();
  });
});
