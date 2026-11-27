import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TitleBarPortal } from "@/components/titleBarSlot";
import { TitleBarSlot } from "@/components/titleBarSlotContext";

describe("TitleBarPortal", () => {
  it("renders in place without a title bar", () => {
    render(
      <div data-testid="screen">
        <TitleBarPortal>
          <span>header</span>
        </TitleBarPortal>
      </div>,
    );
    expect(screen.getByTestId("screen").textContent).toBe("header");
  });

  it("renders into the title bar's slot", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    render(
      <TitleBarSlot.Provider value={slot}>
        <div data-testid="screen">
          <TitleBarPortal>
            <span>header</span>
          </TitleBarPortal>
        </div>
      </TitleBarSlot.Provider>,
    );
    expect(screen.getByTestId("screen").textContent).toBe("");
    expect(slot.textContent).toBe("header");
    slot.remove();
  });

  it("waits for the slot while the title bar has not mounted it", () => {
    render(
      <TitleBarSlot.Provider value={null}>
        <TitleBarPortal>
          <span>header</span>
        </TitleBarPortal>
      </TitleBarSlot.Provider>,
    );
    expect(screen.queryByText("header")).toBeNull();
  });
});
