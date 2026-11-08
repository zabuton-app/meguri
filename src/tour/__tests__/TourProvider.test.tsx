import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { TourProvider, useTour } from "@/tour/TourProvider";
import { FIRST_LAUNCH_TOUR_ID } from "@/tour/tours";

const LS_KEY = "meguri.tours";

/** Stands in for Home: the list is in front, with one tour target on screen. */
function Host({ ready = true }: { ready?: boolean }) {
  const { setHostReady, replay } = useTour();
  useEffect(() => setHostReady(ready), [ready, setHostReady]);
  return (
    <>
      <div data-tour="search" ref={showOnScreen}>
        search
      </div>
      <button type="button" onClick={replay}>
        replay
      </button>
    </>
  );
}

// jsdom lays nothing out, so every element would read as off screen.
function showOnScreen(el: HTMLElement | null) {
  if (el) el.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as never;
}

// StrictMode, as in main.tsx: effects run twice on mount.
function tree(props: { ready?: boolean } = {}) {
  return (
    <StrictMode>
      <I18nProvider>
        <PreferencesProvider>
          <TourProvider>
            <Host {...props} />
          </TourProvider>
        </PreferencesProvider>
      </I18nProvider>
    </StrictMode>
  );
}

function renderTour(props: { ready?: boolean } = {}) {
  return render(tree(props));
}

function advance(ms = 1000) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function progress(): string | null | undefined {
  return screen.queryByRole("dialog")?.querySelector("[aria-live]")
    ?.textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
  // A first launch, with the pet put away so the provider draws the bubble
  // itself (with the pet out, Pet.tsx does).
  localStorage.setItem(LS_KEY, "[]");
  localStorage.setItem("meguri.lang", "en");
  localStorage.setItem("meguri.prefs", JSON.stringify({ petVisible: false }));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.className = "";
});

describe("TourProvider", () => {
  it("starts the first-launch tour once the list is in front", () => {
    const { rerender } = renderTour({ ready: false });
    advance();
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(tree({ ready: true }));
    advance();
    expect(progress()).toBe("1 / 4");
  });

  it("stops without counting as seen when the list leaves the front", () => {
    const { rerender } = renderTour();
    advance();
    expect(progress()).toBe("1 / 4");
    rerender(tree({ ready: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(LS_KEY)).toBe("[]");
    rerender(tree({ ready: true }));
    advance();
    expect(progress()).toBe("1 / 4");
  });

  it("leaves out steps whose target is not on screen", () => {
    renderTour();
    advance();
    expect(
      screen.getByRole("dialog", { name: "Choose your language" }),
    ).toBeTruthy();
    // Language, welcome, search (the only target present) and the closing step.
    expect(progress()).toBe("1 / 4");
  });

  it("moves through the steps with the buttons and the arrow keys", () => {
    renderTour();
    advance();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(progress()).toBe("2 / 4");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(progress()).toBe("1 / 4");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(progress()).toBe("4 / 4");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(localStorage.getItem(LS_KEY)!)).toContain(
      FIRST_LAUNCH_TOUR_ID,
    );
  });

  it("is skipped with Esc and does not come back", () => {
    renderTour();
    advance();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(localStorage.getItem(LS_KEY)!)).toContain(
      FIRST_LAUNCH_TOUR_ID,
    );
    advance();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps other keys from reaching the app while it runs", () => {
    const appKeys = vi.fn();
    window.addEventListener("keydown", appKeys);
    try {
      renderTour();
      advance();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      fireEvent.keyDown(window, { key: "/" });
      expect(appKeys).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", appKeys);
    }
  });

  it("can be replayed after it was seen", () => {
    localStorage.setItem(LS_KEY, JSON.stringify([FIRST_LAUNCH_TOUR_ID]));
    renderTour();
    advance();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "replay" }));
    advance();
    expect(progress()).toBe("1 / 4");
  });

  it("asks for the language first, keeps it and goes on in it", () => {
    renderTour();
    advance();
    const english = screen.getByRole("button", { name: "English" });
    expect(english.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    expect(localStorage.getItem("meguri.lang")).toBe("ja");
    expect(screen.getByRole("dialog", { name: "言語を選んでね" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(
      screen.getByRole("dialog", { name: "Meguriへようこそ" }),
    ).toBeTruthy();
  });

  it("waits for a dialog or menu over the list to close", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.dataset.state = "open";
    document.body.append(dialog);
    try {
      renderTour();
      advance(2000);
      expect(screen.queryByRole("dialog", { name: /language/ })).toBeNull();
      dialog.remove();
      advance();
      expect(progress()).toBe("1 / 4");
    } finally {
      dialog.remove();
    }
  });

  it("picks a replay back up when the list leaves and comes back", () => {
    localStorage.setItem(LS_KEY, JSON.stringify([FIRST_LAUNCH_TOUR_ID]));
    const { rerender } = renderTour();
    fireEvent.click(screen.getByRole("button", { name: "replay" }));
    advance();
    expect(progress()).toBe("1 / 4");
    rerender(tree({ ready: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(tree({ ready: true }));
    advance();
    expect(progress()).toBe("1 / 4");
  });

  it("keeps Tab on the bubble's buttons, from outside it too", () => {
    renderTour();
    advance();
    const buttons = [
      ...screen.getByRole("dialog").querySelectorAll("button"),
    ] as HTMLElement[];
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
  });
});
