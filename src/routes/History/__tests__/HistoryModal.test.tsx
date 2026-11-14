// The History frame (also Tags and Duplicates) holds focus while open and is
// named by the title its caller renders (#287).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryModal } from "@/routes/History/HistoryModal";

describe("HistoryModal", () => {
  it("takes focus, is named by its title and hands focus back on close", () => {
    render(<button type="button">opener</button>);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    const { unmount } = render(
      <HistoryModal onClose={vi.fn()} titleId="history-title">
        <span id="history-title">History</span>
      </HistoryModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "History" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
  });
});
