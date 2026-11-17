import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { CrashReport } from "@shared/ipc/schema";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<CrashReport[]>>(),
  remove: vi.fn<(id: string) => Promise<void>>(),
  openFolder: vi.fn<() => Promise<void>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/ipc/client", () => ({
  api: {
    crashReportsList: () => mocks.list(),
    crashReportDelete: (id: string) => mocks.remove(id),
    crashReportsOpenFolder: () => mocks.openFolder(),
    openUrl: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: mocks.error,
    success: mocks.success,
  }),
  Toaster: () => null,
}));

const { CrashReportsSection } =
  await import("@/routes/Settings/CrashReportsSection");

const report: CrashReport = {
  id: "1700000000000",
  detectedAt: 1_700_000_000_000,
  kind: "unclean-exit",
  text: "Meguri crash report\nResult: Did not exit normally",
  issueUrl: "https://github.com/zabuton-app/meguri/issues/new",
  isNew: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([report]);
  mocks.remove.mockResolvedValue();
  mocks.openFolder.mockResolvedValue();
  mocks.writeText.mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => mocks.writeText(text) },
  });
});

describe("CrashReportsSection", () => {
  it("lists the kept reports", async () => {
    renderWithProviders(<CrashReportsSection />);
    expect(await screen.findByText("Did not exit normally")).toBeTruthy();
  });

  it("says when there are none", async () => {
    mocks.list.mockResolvedValue([]);
    renderWithProviders(<CrashReportsSection />);
    expect(await screen.findByText("No crash reports.")).toBeTruthy();
  });

  it("copies a report's text", async () => {
    renderWithProviders(<CrashReportsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(report.text),
    );
    expect(mocks.success).toHaveBeenCalledWith("Report copied");
  });

  it("deletes a report and lists them again", async () => {
    renderWithProviders(<CrashReportsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(report.id));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("says when the folder could not be opened", async () => {
    mocks.openFolder.mockRejectedValue(new Error("no file manager"));
    renderWithProviders(<CrashReportsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Open folder" }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Could not open the folder"),
    );
  });
});
