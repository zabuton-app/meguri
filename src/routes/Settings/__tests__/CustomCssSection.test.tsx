import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomCssState } from "@shared/ipc/channels";
import { I18nProvider } from "@/i18n/I18nProvider";

const customCssGet = vi.fn<() => Promise<CustomCssState>>();
const customCssSetEnabled =
  vi.fn<(enabled: boolean) => Promise<CustomCssState>>();
const customCssOpen = vi.fn<() => Promise<void>>();
const toastError = vi.fn<(message: string) => void>();
vi.mock("@/ipc/client", () => ({
  api: {
    customCssGet: () => customCssGet(),
    customCssSetEnabled: (enabled: boolean) => customCssSetEnabled(enabled),
    customCssOpen: () => customCssOpen(),
  },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

const { CustomCssSection } = await import("@/routes/Settings/CustomCssSection");

const PATH = "/home/u/.config/meguri/custom.css";

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <CustomCssSection />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  customCssGet.mockReset();
  customCssSetEnabled.mockReset();
  customCssOpen.mockReset();
  toastError.mockReset();
  customCssGet.mockResolvedValue({ enabled: false, path: PATH, css: null });
});

describe("CustomCssSection", () => {
  it("shows where the file lives and that it is off", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText(PATH)).toBeTruthy());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("turns the stylesheet on, whether or not the file exists", async () => {
    customCssSetEnabled.mockResolvedValue({
      enabled: true,
      path: PATH,
      css: null,
    });
    renderSection();
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    // react-query runs the mutation function a tick after mutate().
    await waitFor(() => expect(customCssSetEnabled).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
  });

  // Only a failure main reports reaches the toast (creating the file, or
  // Windows' openPath); the detached launcher elsewhere can only log.
  it("opens the file, and says so when main reports a failure", async () => {
    customCssOpen.mockRejectedValue(new Error("EACCES"));
    renderSection();
    fireEvent.click(screen.getByRole("button"));
    expect(customCssOpen).toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
