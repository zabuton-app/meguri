import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/themes/ThemeProvider";

function renderTheme() {
  return renderHook(() => useTheme(), {
    wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
  });
}

function reduceMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion: reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

describe("theme switch fade", () => {
  // The callback's state is what the View Transition snapshots as the new look, so both the
  // DOM and React's render must have the new theme by the time it returns.
  let themeInCallback: string | undefined;
  let renderedInCallback: string | undefined;
  let readRendered: () => string = () => "";
  const startViewTransition = vi.fn((update: () => void) => {
    update();
    themeInCallback = document.documentElement.dataset.theme;
    renderedInCallback = readRendered();
    return {} as ViewTransition;
  });

  beforeEach(() => {
    localStorage.setItem("meguri.theme", "nord-dark");
    themeInCallback = undefined;
    renderedInCallback = undefined;
    startViewTransition.mockClear();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
  });

  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("applies the new theme inside a View Transition", () => {
    reduceMotion(false);
    const { result } = renderTheme();
    readRendered = () => result.current.theme;
    act(() => result.current.setFamily("solarized"));
    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(themeInCallback).toBe("solarized-dark");
    expect(renderedInCallback).toBe("solarized-dark");
  });

  it("fades the light and dark switch too", () => {
    reduceMotion(false);
    const { result } = renderTheme();
    act(() => result.current.setMode("light"));
    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(themeInCallback).toBe("nord-light");
  });

  it("does not start a transition for the current theme", () => {
    reduceMotion(false);
    const { result } = renderTheme();
    act(() => result.current.setFamily("nord"));
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("switches at once when reduced motion is on", () => {
    reduceMotion(true);
    const { result } = renderTheme();
    act(() => result.current.setFamily("solarized"));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("solarized-dark");
  });

  it("switches at once without the View Transitions API", () => {
    reduceMotion(false);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    const { result } = renderTheme();
    act(() => result.current.setFamily("solarized"));
    expect(document.documentElement.dataset.theme).toBe("solarized-dark");
  });
});

describe("startup fade", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-boot-fade");
    vi.useRealTimers();
    localStorage.clear();
  });

  it("ends the fade theme-boot.js began once it has played", () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute("data-boot-fade", "");
    renderTheme();
    expect(document.documentElement.hasAttribute("data-boot-fade")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(document.documentElement.hasAttribute("data-boot-fade")).toBe(false);
  });
});
