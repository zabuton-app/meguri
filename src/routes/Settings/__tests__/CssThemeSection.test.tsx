import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CssThemesState } from "@shared/ipc/channels";
import { I18nProvider } from "@/i18n/I18nProvider";

const cssThemesGet = vi.fn<() => Promise<CssThemesState>>();
const cssThemeSelect =
  vi.fn<(file: string | null) => Promise<CssThemesState>>();
const cssThemesOpenFolder = vi.fn<() => Promise<void>>();
const toastError = vi.fn<(message: string) => void>();
vi.mock("@/ipc/client", () => ({
  api: {
    cssThemesGet: () => cssThemesGet(),
    cssThemeSelect: (file: string | null) => cssThemeSelect(file),
    cssThemesOpenFolder: () => cssThemesOpenFolder(),
  },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

const { CssThemeSection } = await import("@/routes/Settings/CssThemeSection");

const DIR = "/home/u/.config/meguri/themes";

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <CssThemeSection />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cssThemesGet.mockReset();
  cssThemeSelect.mockReset();
  cssThemesOpenFolder.mockReset();
  toastError.mockReset();
  cssThemesGet.mockResolvedValue({
    themes: [{ file: "neon.css", name: "Neon" }],
    selected: "neon.css",
    css: "a{}",
    dir: DIR,
  });
});

describe("CssThemeSection", () => {
  it("shows the folder", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText(DIR)).toBeTruthy());
  });

  it("opens the folder, and says so when main reports a failure", async () => {
    cssThemesOpenFolder.mockRejectedValue(new Error("EACCES"));
    renderSection();
    fireEvent.click(screen.getByRole("button"));
    expect(cssThemesOpenFolder).toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
