// Spec-009 effect animation coverage for the rating stars: staggered pop with a
// burst on the selected star when setting, joint settle when clearing, and no
// effects from prop-only value changes (cache sync) or non-editable renders.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RatingStars } from "@/components/RatingStars";
import { I18nProvider } from "@/i18n/I18nProvider";

function setup(value: number, onChange?: (r: number) => void) {
  const view = render(
    <I18nProvider>
      <RatingStars value={value} onChange={onChange} />
    </I18nProvider>,
  );
  const rerenderWith = (v: number) =>
    view.rerender(
      <I18nProvider>
        <RatingStars value={v} onChange={onChange} />
      </I18nProvider>,
    );
  return { rerenderWith };
}

const stars = () => screen.getAllByRole("button");
const burst = () => document.querySelectorAll('[data-testid="fx-burst"]');
const pops = () => document.querySelectorAll(".fx-pop");
const settles = () => document.querySelectorAll(".fx-settle");

describe("RatingStars", () => {
  it("setting 0→4 pops stars 1–4 with a stagger and bursts on star 4", () => {
    const onChange = vi.fn();
    setup(0, onChange);

    fireEvent.click(stars()[3]);

    expect(onChange).toHaveBeenCalledWith(4);
    const popped = pops();
    expect(popped.length).toBe(4);
    expect([...popped].map((el) => (el as HTMLElement).style.animationDelay)).toEqual(
      ["0ms", "40ms", "80ms", "120ms"],
    );
    expect(burst().length).toBe(1);
    // The burst sits inside the selected (4th) star's button.
    expect(stars()[3].contains(burst()[0])).toBe(true);
    expect(settles().length).toBe(0);
  });

  it("changing an existing rating reflects the newly selected value", () => {
    const onChange = vi.fn();
    setup(4, onChange);

    fireEvent.click(stars()[1]);

    expect(onChange).toHaveBeenCalledWith(2);
    expect(pops().length).toBe(2);
    expect(stars()[1].contains(burst()[0])).toBe(true);
  });

  it("set then clear on the same star fully replaces the effect DOM", () => {
    const onChange = vi.fn();
    const { rerenderWith } = setup(0, onChange);

    fireEvent.click(stars()[3]);
    // The parent would re-render with the new value after the mutation.
    rerenderWith(4);
    fireEvent.click(stars()[3]);

    // Only settle wrappers remain — no stale fx-pop spans or bursts from the
    // first activation (regression: equal sibling keys once corrupted
    // reconciliation and duplicated star icons).
    expect(settles().length).toBe(4);
    expect(pops().length).toBe(0);
    expect(burst().length).toBe(0);
    expect(stars()[3].querySelectorAll("svg").length).toBe(1);
  });

  it("clearing (clicking the current value) settles the lit stars with no burst", () => {
    const onChange = vi.fn();
    setup(3, onChange);

    fireEvent.click(stars()[2]);

    expect(onChange).toHaveBeenCalledWith(0);
    expect(settles().length).toBe(3);
    expect(burst().length).toBe(0);
    expect(pops().length).toBe(0);
  });

  it("never fires effects from prop-only value changes (cache sync)", () => {
    const { rerenderWith } = setup(0, vi.fn());

    rerenderWith(4);

    expect(pops().length).toBe(0);
    expect(settles().length).toBe(0);
    expect(burst().length).toBe(0);
  });

  it("renders no effects when not editable", () => {
    setup(2);

    fireEvent.click(stars()[4]);

    expect(pops().length).toBe(0);
    expect(settles().length).toBe(0);
    expect(burst().length).toBe(0);
  });

  it("suppresses all decorative effects under prefers-reduced-motion while still changing state", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const onChange = vi.fn();
      setup(0, onChange);

      fireEvent.click(stars()[3]);

      expect(onChange).toHaveBeenCalledWith(4);
      expect(pops().length).toBe(0);
      expect(settles().length).toBe(0);
      expect(burst().length).toBe(0);
    } finally {
      window.matchMedia = orig;
    }
  });

  it("uses native buttons, so keyboard activation shares the click path (FR-012)", () => {
    setup(0, vi.fn());
    for (const s of stars()) expect(s.tagName).toBe("BUTTON");

    fireEvent.click(stars()[0]);

    expect(pops().length).toBe(1);
  });
});
