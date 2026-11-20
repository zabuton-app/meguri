// The title bar's search shows the search on screen and opens the command
// menu, where it is typed; its chips stay removable in place.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SearchTrigger } from "@/components/SearchTrigger";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { SearchQuery } from "@/ipc/types";
import { highlightSearchToken, onOpenCommandMenu } from "@/lib/ui-events";

function renderTrigger(q?: string) {
  const onChange = vi.fn<(next: SearchQuery) => void>();
  const value: SearchQuery = { q, sort: "name" };
  render(
    <I18nProvider>
      <SearchTrigger value={value} onChange={onChange} />
    </I18nProvider>,
  );
  return { onChange, value };
}

describe("SearchTrigger", () => {
  it("opens the command menu on a click", () => {
    const opened = vi.fn();
    const off = onOpenCommandMenu(opened);
    renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: /Search or run/ }));
    expect(opened).toHaveBeenCalledOnce();
    off();
  });

  it("shows the placeholder and the shortcut while nothing is searched", () => {
    renderTrigger();
    expect(screen.getByText("Search file name or tags")).toBeTruthy();
    expect(screen.getByText("Ctrl+K")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("shows the conditions as chips and the words as text", () => {
    renderTrigger("tag:beach sunset");
    const chip = document.querySelector('[data-slot="search-chip"]')!;
    expect(chip.textContent).toContain("beach");
    expect(screen.getByText("sunset")).toBeTruthy();
  });

  it("removes one chip, keeping the rest of the search", () => {
    const opened = vi.fn();
    const off = onOpenCommandMenu(opened);
    const { onChange, value } = renderTrigger("tag:beach tag:sea sunset");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove this filter" })[0],
    );
    expect(onChange).toHaveBeenCalledWith({ ...value, q: "tag:sea sunset" });
    // The ✗ is not a click on the box.
    expect(opened).not.toHaveBeenCalled();
    off();
  });

  it("clears the search", () => {
    const { onChange, value } = renderTrigger("tag:beach sunset");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith({ ...value, q: undefined });
  });

  it("lights up a chip asked for, then lets it go", () => {
    vi.useFakeTimers();
    try {
      renderTrigger("tag:beach");
      const chip = document.querySelector<HTMLElement>(
        '[data-slot="search-chip"]',
      )!;
      act(() => highlightSearchToken("tag:beach"));
      expect(chip.dataset.selected).toBe("true");
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(chip.dataset.selected).toBeUndefined();
      // A second ask while lit keeps it lit for the full time again.
      act(() => highlightSearchToken("tag:beach"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => highlightSearchToken("tag:beach"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(chip.dataset.selected).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });
});
