import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  PreferencesProvider,
  usePreferences,
} from "@/settings/PreferencesProvider";
import { ThemeProvider, useTheme } from "@/themes/ThemeProvider";
import { deriveTokens } from "@/themes/derive";
import { SCHEMES } from "@/themes/schemes";
import log from "@/lib/logger";

const cssThemeSelect = vi.fn().mockResolvedValue({});
vi.mock("@/ipc/client", () => ({
  api: { cssThemeSelect: (file: string | null) => cssThemeSelect(file) },
}));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn() } }));
const { startTheme } = await import("@/themes/startupTheme");

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  cssThemeSelect.mockClear();
});

function prefsWrapper({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

describe("random theme on startup", () => {
  it("defaults off, validates stored values and round-trips", () => {
    const prefs = renderHook(() => usePreferences(), { wrapper: prefsWrapper });
    expect(prefs.result.current.randomThemeOnStartup).toBe(false);
    act(() => prefs.result.current.setRandomThemeOnStartup(true));
    expect(
      JSON.parse(localStorage.getItem("meguri.prefs")!).randomThemeOnStartup,
    ).toBe(true);
    prefs.unmount();
    const restored = renderHook(() => usePreferences(), {
      wrapper: prefsWrapper,
    });
    expect(restored.result.current.randomThemeOnStartup).toBe(true);
    restored.unmount();
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ randomThemeOnStartup: "true" }),
    );
    expect(
      renderHook(() => usePreferences(), { wrapper: prefsWrapper }).result
        .current.randomThemeOnStartup,
    ).toBe(false);
  });

  it("keeps the stored theme and CSS selection when off", async () => {
    localStorage.setItem("meguri.theme", "nord-light");
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ randomThemeOnStartup: false }),
    );
    const { theme, ready } = startTheme();
    await ready;
    expect(theme).toBeUndefined();
    expect(localStorage.getItem("meguri.theme")).toBe("nord-light");
    expect(cssThemeSelect).not.toHaveBeenCalled();
    const hook = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(hook.result.current.theme).toBe("nord-light");
  });

  it.each(["nord-light", "nord-dark"])(
    "picks and persists another built-in variant with the appearance of %s",
    async (previous) => {
      localStorage.setItem("meguri.theme", previous);
      localStorage.setItem(
        "meguri.prefs",
        JSON.stringify({ randomThemeOnStartup: true }),
      );
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { theme, ready } = startTheme();
      await ready;
      const selected = SCHEMES.find((scheme) => scheme.id === theme)!;
      expect(selected).toBeDefined();
      expect(selected.appearance).toBe(
        SCHEMES.find((scheme) => scheme.id === previous)!.appearance,
      );
      expect(theme).not.toBe(previous);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(localStorage.getItem("meguri.theme")).toBe(theme);
      expect(localStorage.getItem("meguri.theme.bg")).toBe(
        deriveTokens(selected).bg,
      );
      expect(cssThemeSelect).toHaveBeenCalledExactlyOnceWith(null);

      const hook = renderHook(() => useTheme(), {
        wrapper: ({ children }) => (
          <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
        ),
      });
      expect(hook.result.current.theme).toBe(theme);
      act(() => hook.result.current.setFamily("solarized"));
      expect(hook.result.current.familyId).toBe("solarized");
      expect(localStorage.getItem("meguri.theme")).toBe(
        hook.result.current.theme,
      );
      hook.unmount();
      const next = startTheme();
      await next.ready;
      expect(next.theme).not.toBe("solarized-" + selected.appearance);
      expect(
        SCHEMES.find((scheme) => scheme.id === next.theme)?.appearance,
      ).toBe(selected.appearance);
    },
  );

  it("falls back to the default appearance for a stale theme", async () => {
    localStorage.setItem("meguri.theme", "removed");
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ randomThemeOnStartup: true }),
    );
    const { theme, ready } = startTheme();
    await ready;
    expect(SCHEMES.find((scheme) => scheme.id === theme)?.appearance).toBe(
      "dark",
    );
  });

  it("continues startup if clearing the CSS theme fails", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ randomThemeOnStartup: true }),
    );
    cssThemeSelect.mockRejectedValueOnce(new Error("unavailable"));
    const { theme, ready } = startTheme();
    await expect(ready).resolves.toBeUndefined();
    expect(localStorage.getItem("meguri.theme")).toBe(theme);
    expect(log.error).toHaveBeenCalled();
  });
});
