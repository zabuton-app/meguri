import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrashReport } from "@shared/ipc/schema";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CrashReportNotice } from "../CrashReportNotice";

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<CrashReport[]>>(),
  copy: vi.fn<(text: string) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: mocks.warning,
    success: vi.fn(),
    error: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock("@/ipc/client", () => ({
  api: {
    crashReportsList: () => mocks.list(),
    openUrl: (url: string) => mocks.openUrl(url),
  },
}));

const report = (over: Partial<CrashReport> = {}): CrashReport => ({
  id: "1",
  detectedAt: 1_700_000_000_000,
  kind: "crashed",
  text: "Meguri crash report\nResult: Crashed (main)",
  issueUrl: "https://github.com/zabuton-app/meguri/issues/new?template=x",
  isNew: true,
  ...over,
});

interface ToastOptions {
  action: { onClick: () => void };
}

describe("CrashReportNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copy.mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => mocks.copy(text) },
    });
    mocks.openUrl.mockResolvedValue();
  });

  it("says the last run crashed, and shows the report on request", async () => {
    mocks.list.mockResolvedValue([report()]);
    renderWithProviders(<CrashReportNotice />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(mocks.warning.mock.calls[0][0]).toBe("Meguri crashed last time");

    const options = mocks.warning.mock.calls[0][1] as ToastOptions;
    act(() => options.action.onClick());
    expect(await screen.findByText(/Result: Crashed \(main\)/)).toBeTruthy();

    // The report is copied before the issue form opens, to paste it there.
    act(() => screen.getByText("Report on GitHub").click());
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(report().issueUrl),
    );
    expect(mocks.copy).toHaveBeenCalledWith(report().text);
    expect(mocks.copy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openUrl.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("says the last run did not exit normally", async () => {
    mocks.list.mockResolvedValue([report({ kind: "unclean-exit" })]);
    renderWithProviders(<CrashReportNotice />);
    await waitFor(() =>
      expect(mocks.warning).toHaveBeenCalledWith(
        "Meguri did not exit normally last time",
        expect.anything(),
      ),
    );
  });

  it("does not open the issue form when the report could not be copied", async () => {
    mocks.list.mockResolvedValue([report()]);
    mocks.copy.mockRejectedValue(new Error("no clipboard"));
    renderWithProviders(<CrashReportNotice />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    act(() =>
      (mocks.warning.mock.calls[0][1] as ToastOptions).action.onClick(),
    );
    act(() => screen.getByText("Report on GitHub").click());
    await waitFor(() => expect(mocks.copy).toHaveBeenCalled());
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("only copies a report of an app without a crash report form", async () => {
    mocks.list.mockResolvedValue([report({ issueUrl: null })]);
    renderWithProviders(<CrashReportNotice />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    act(() =>
      (mocks.warning.mock.calls[0][1] as ToastOptions).action.onClick(),
    );
    expect(await screen.findByText("Copy")).toBeTruthy();
    expect(screen.queryByText("Report on GitHub")).toBeNull();
  });

  it("says nothing about reports from earlier launches", async () => {
    mocks.list.mockResolvedValue([report({ isNew: false })]);
    renderWithProviders(<CrashReportNotice />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.warning).not.toHaveBeenCalled();
  });
});
