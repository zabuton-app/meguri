import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ExperimentalBadge, ExperimentalCorner } from "../ExperimentalBadge";

describe("ExperimentalBadge", () => {
  it("says what experimental means, to a screen reader and on hover", () => {
    renderWithProviders(<ExperimentalBadge />);
    const badge = screen.getByRole("img", { name: /^Experimental:/ });
    expect(badge.querySelector("title")?.textContent).toBe(
      "Experimental: it may change or be removed in a later version",
    );
  });
});

describe("ExperimentalCorner", () => {
  it("sets the badge beside the control, out of its name", () => {
    renderWithProviders(
      <ExperimentalCorner>
        <button type="button" disabled>
          Compare
        </button>
      </ExperimentalCorner>,
    );
    const button = screen.getByRole("button", { name: "Compare" });
    expect(button.querySelector('[data-slot="experimental-badge"]')).toBeNull();
    expect(
      button.parentElement?.querySelector('[data-slot="experimental-badge"]'),
    ).not.toBeNull();
  });
});
