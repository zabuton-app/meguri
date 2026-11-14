// Esc closes Discover, unless a layer on top already took it (#268); focus
// stays inside while it is open (#287).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiscoverModal } from "@/routes/Discover/DiscoverModal";

const claim = (e: KeyboardEvent) => e.preventDefault();

afterEach(() => window.removeEventListener("keydown", claim, true));

describe("DiscoverModal", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <DiscoverModal onClose={onClose} titleId="t">
        body
      </DiscoverModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a layer on top claimed the Escape", () => {
    const onClose = vi.fn();
    render(
      <DiscoverModal onClose={onClose} titleId="t">
        body
      </DiscoverModal>,
    );
    // What Radix's dismissable layer (the command menu) and ConfirmDialog do:
    // take the key in the capture phase and mark it as theirs.
    window.addEventListener("keydown", claim, true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes focus and is named by its title", () => {
    render(
      <DiscoverModal onClose={vi.fn()} titleId="discover-title">
        <span id="discover-title">Discover</span>
      </DiscoverModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Discover" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
