// The theme grid: CSS theme files sit next to the built-in families, a picked
// file takes the check mark from the family underneath it, and picking a
// family always drops the file, even one that only shows as none because it
// is missing for now.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CssThemesState } from "@shared/ipc/channels";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ThemeProvider } from "@/themes/ThemeProvider";

const cssThemesGet = vi.fn<() => Promise<CssThemesState>>();
const cssThemeSelect =
  vi.fn<(file: string | null) => Promise<CssThemesState>>();
vi.mock("@/ipc/client", () => ({
  api: {
    cssThemesGet: () => cssThemesGet(),
    cssThemeSelect: (file: string | null) => cssThemeSelect(file),
  },
}));

const { ThemeSection } = await import("@/routes/Settings/ThemeSection");

const DIR = "/home/u/.config/meguri/themes";
const state = (selected: string | null): CssThemesState => ({
  themes: [{ file: "neon.css", name: "Neon" }],
  selected,
  css: selected ? "a{}" : null,
  dir: DIR,
});

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <I18nProvider>
          <ThemeSection />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const card = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) });
const isActive = (el: HTMLElement) => el.className.includes("ring-primary");

beforeEach(() => {
  localStorage.clear();
  cssThemesGet.mockReset();
  cssThemeSelect.mockReset();
});

describe("ThemeSection", () => {
  it("lists theme files after the built-in themes", async () => {
    cssThemesGet.mockResolvedValue(state(null));
    renderSection();
    await waitFor(() => expect(card("Neon")).toBeTruthy());
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.at(-1)).toContain("Neon");
    expect(names.length).toBeGreaterThan(1);
  });

  it("marks a picked file instead of the family under it", async () => {
    cssThemesGet.mockResolvedValue(state("neon.css"));
    renderSection();
    await waitFor(() => expect(isActive(card("Neon"))).toBe(true));
    expect(screen.getAllByRole("button").filter(isActive)).toHaveLength(1);
  });

  it("picks a file", async () => {
    cssThemesGet.mockResolvedValue(state(null));
    cssThemeSelect.mockResolvedValue(state("neon.css"));
    renderSection();
    await waitFor(() => expect(card("Neon")).toBeTruthy());
    fireEvent.click(card("Neon"));
    await waitFor(() =>
      expect(cssThemeSelect).toHaveBeenCalledWith("neon.css"),
    );
    await waitFor(() => expect(isActive(card("Neon"))).toBe(true));
  });

  it("drops the file when a family is picked, even with none showing", async () => {
    cssThemesGet.mockResolvedValue(state(null));
    cssThemeSelect.mockResolvedValue(state(null));
    renderSection();
    await waitFor(() => expect(card("Neon")).toBeTruthy());
    fireEvent.click(card("Nord"));
    await waitFor(() => expect(cssThemeSelect).toHaveBeenCalledWith(null));
    expect(isActive(card("Nord"))).toBe(true);
  });
});
