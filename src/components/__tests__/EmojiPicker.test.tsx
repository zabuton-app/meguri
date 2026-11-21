// Regression: Radix's scroll lock listens for `wheel` on `document` and cancels
// it when the (shadow-root retargeted) target has no scrollable ancestor, which
// made the emoji grid unscrollable by mouse wheel. The picker container must
// stop wheel events before they reach `document`.
import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
  it("keeps wheel events over the picker from reaching document", async () => {
    renderPicker();
    // emoji-mart is loaded lazily, after the dialog opens.
    const host = await waitFor(
      () => {
        const found = screen
          .getByRole("dialog")
          .querySelector("em-emoji-picker")?.parentElement;
        expect(found).toBeTruthy();
        return found;
      },
      // Loading the chunk transforms emoji-mart's data, slow on a busy CI.
      { timeout: 5000 },
    );

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
