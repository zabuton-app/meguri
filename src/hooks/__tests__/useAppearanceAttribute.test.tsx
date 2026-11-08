// data-appearance is part of the public API for user stylesheets
// (docs/theming.md): it must follow the light / dark switch.
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "@/themes/ThemeProvider";
import { useAppearanceAttribute } from "@/hooks/useAppearanceAttribute";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

afterEach(() => {
  document.documentElement.removeAttribute("data-appearance");
  localStorage.clear();
});

describe("useAppearanceAttribute", () => {
  it("mirrors the current appearance onto <html> and follows a switch", () => {
    const { result } = renderHook(
      () => {
        useAppearanceAttribute();
        return useTheme();
      },
      { wrapper },
    );
    const root = document.documentElement;
    expect(root.getAttribute("data-appearance")).toBe(result.current.mode);

    act(() => result.current.setMode("light"));
    expect(root.getAttribute("data-appearance")).toBe("light");

    act(() => result.current.setMode("dark"));
    expect(root.getAttribute("data-appearance")).toBe("dark");
  });
});
