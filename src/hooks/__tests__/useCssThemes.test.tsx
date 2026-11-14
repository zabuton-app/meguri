// useCssThemeStyle puts the picked theme on screen: it follows the pick and
// changes pushed from main, and its <style> always sits before custom.css's,
// so personal tweaks win over the theme.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CssThemesState } from "@shared/ipc/channels";

const cssThemesGet = vi.fn<() => Promise<CssThemesState>>();
const cssThemeSelect =
  vi.fn<(file: string | null) => Promise<CssThemesState>>();
let emitChanged: ((s: CssThemesState) => void) | null = null;
vi.mock("@/ipc/client", () => ({
  api: {
    cssThemesGet: () => cssThemesGet(),
    cssThemeSelect: (file: string | null) => cssThemeSelect(file),
  },
  events: {
    onCssThemesChanged: (cb: (s: CssThemesState) => void) => {
      emitChanged = cb;
      return () => {
        emitChanged = null;
      };
    },
  },
}));

const { useCssThemes, useCssThemeStyle } = await import("@/hooks/useCssThemes");

const DIR = "/home/u/.config/meguri/themes";
const THEMES = [{ file: "neon.css", name: "Neon" }];
const state = (
  selected: string | null,
  css: string | null,
): CssThemesState => ({ themes: THEMES, selected, css, dir: DIR });

const styleText = () =>
  document.getElementById("meguri-css-theme")?.textContent ?? null;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderBoth() {
  return renderHook(
    () => {
      useCssThemeStyle();
      return useCssThemes();
    },
    { wrapper },
  );
}

beforeEach(() => {
  cssThemesGet.mockReset();
  cssThemeSelect.mockReset();
});

afterEach(() => {
  document.getElementById("meguri-css-theme")?.remove();
  document.getElementById("meguri-custom-css")?.remove();
});

describe("useCssThemeStyle", () => {
  it("injects the picked theme", async () => {
    cssThemesGet.mockResolvedValue(state("neon.css", "a{}"));
    renderBoth();
    await waitFor(() => expect(styleText()).toBe("a{}"));
  });

  it("follows the pick both ways", async () => {
    cssThemesGet.mockResolvedValue(state(null, null));
    const { result } = renderBoth();
    await waitFor(() => expect(result.current.state).toBeDefined());
    expect(styleText()).toBe("");

    cssThemeSelect.mockResolvedValue(state("neon.css", "a{}"));
    act(() => result.current.select("neon.css"));
    await waitFor(() => expect(styleText()).toBe("a{}"));
    expect(cssThemeSelect).toHaveBeenCalledWith("neon.css");

    cssThemeSelect.mockResolvedValue(state(null, null));
    act(() => result.current.select(null));
    await waitFor(() => expect(styleText()).toBe(""));
  });

  it("applies changes pushed from main", async () => {
    cssThemesGet.mockResolvedValue(state("neon.css", "a{}"));
    renderBoth();
    await waitFor(() => expect(styleText()).toBe("a{}"));
    act(() => emitChanged?.(state("neon.css", "b{}")));
    await waitFor(() => expect(styleText()).toBe("b{}"));
  });

  it("goes before custom.css when that is already in place", async () => {
    const custom = document.createElement("style");
    custom.id = "meguri-custom-css";
    document.head.appendChild(custom);
    cssThemesGet.mockResolvedValue(state("neon.css", "a{}"));
    renderBoth();
    await waitFor(() => expect(styleText()).toBe("a{}"));
    expect(
      document.getElementById("meguri-css-theme")?.nextElementSibling,
    ).toBe(custom);
  });
});
