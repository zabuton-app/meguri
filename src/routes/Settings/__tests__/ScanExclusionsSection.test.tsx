import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScanExclusionsState } from "@shared/ipc/channels";
import { I18nProvider } from "@/i18n/I18nProvider";
import { MAX_EXCLUSION_PATTERN } from "@shared/scanExclusions";

const scanExclusionsGet = vi.fn<() => Promise<ScanExclusionsState>>();
const scanExclusionsSetPatterns =
  vi.fn<(patterns: string[]) => Promise<ScanExclusionsState>>();
const toastError = vi.fn<(message: string) => void>();
const toastSuccess = vi.fn<(message: string) => void>();
vi.mock("@/ipc/client", () => ({
  api: {
    scanExclusionsGet: () => scanExclusionsGet(),
    scanExclusionsSetPatterns: (patterns: string[]) =>
      scanExclusionsSetPatterns(patterns),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => toastError(m),
    success: (m: string) => toastSuccess(m),
  },
}));

const { ScanExclusionsSection } =
  await import("@/routes/Settings/ScanExclusionsSection");

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ScanExclusionsSection />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}

const field = () =>
  screen.getByLabelText<HTMLTextAreaElement>("Exclude from scans");
const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save" });

beforeEach(() => {
  vi.clearAllMocks();
  scanExclusionsGet.mockResolvedValue({ patterns: ["(^|/)@eaDir/"] });
  scanExclusionsSetPatterns.mockImplementation((patterns) =>
    Promise.resolve({ patterns }),
  );
});

describe("ScanExclusionsSection", () => {
  it("shows the stored patterns, one per line, with nothing to save", async () => {
    renderSection();
    await waitFor(() => expect(field().value).toBe("(^|/)@eaDir/"));
    expect(saveButton().disabled).toBe(true);
  });

  it("names a pattern that does not compile and does not save", async () => {
    renderSection();
    await waitFor(() => expect(field().disabled).toBe(false));
    fireEvent.change(field(), { target: { value: "(^|/)@eaDir/\n(" } });

    expect(screen.getByText("(")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("names a pattern too long to run, and the same wrong line twice", async () => {
    renderSection();
    await waitFor(() => expect(field().disabled).toBe(false));
    const long = "a".repeat(MAX_EXCLUSION_PATTERN + 1);
    fireEvent.change(field(), { target: { value: `${long}\n(\n(` } });

    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getAllByText("(")).toHaveLength(2);
    expect(saveButton().disabled).toBe(true);
  });

  it("says so when the patterns cannot be read", async () => {
    scanExclusionsGet.mockRejectedValue(new Error("down"));
    renderSection();

    expect(
      await screen.findByText("Could not read the scan exclusions."),
    ).toBeTruthy();
    expect(field().disabled).toBe(true);
  });

  it("saves the lines that hold a pattern and refreshes the file views", async () => {
    const { invalidate } = renderSection();
    await waitFor(() => expect(field().disabled).toBe(false));
    fireEvent.change(field(), {
      target: { value: "(^|/)@eaDir/\n\n(^|/)proxy/\r\n" },
    });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(scanExclusionsSetPatterns).toHaveBeenCalledWith([
        "(^|/)@eaDir/",
        "(^|/)proxy/",
      ]),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["files_search"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["missing_files"] });
    expect(saveButton().disabled).toBe(true);
  });

  it("tells the user when the save fails, keeping the edit", async () => {
    scanExclusionsSetPatterns.mockRejectedValue(new Error("no"));
    renderSection();
    await waitFor(() => expect(field().disabled).toBe(false));
    fireEvent.change(field(), { target: { value: "^a/$" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(field().value).toBe("^a/$");
  });
});
