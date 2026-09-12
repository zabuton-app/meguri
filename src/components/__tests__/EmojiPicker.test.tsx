// Regression: Radix's scroll lock listens for `wheel` on `document` and cancels
// it when the (shadow-root retargeted) target has no scrollable ancestor, which
// made the emoji grid unscrollable by mouse wheel. The picker container must
// stop wheel events before they reach `document`.
import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ThemeProvider } from "@/themes/ThemeProvider";

// emoji-mart observes its category headers on mount; jsdom has no such API.
beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});

afterEach(cleanup);

function renderPicker() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <EmojiPicker open onOpenChange={() => {}} onSelect={() => {}} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("EmojiPicker", () => {
  it("keeps wheel events over the picker from reaching document", () => {
    renderPicker();
    const host = screen.getByRole("dialog").querySelector("em-emoji-picker")
      ?.parentElement;
    expect(host).toBeTruthy();

    const onDocumentWheel = vi.fn();
    document.addEventListener("wheel", onDocumentWheel);
    try {
      host!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true }),
      );
      expect(onDocumentWheel).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("wheel", onDocumentWheel);
    }
  });
});
