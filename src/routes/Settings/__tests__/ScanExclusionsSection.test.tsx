import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PatternPreview, ScanExclusionsState } from "@shared/ipc/channels";
import { I18nProvider } from "@/i18n/I18nProvider";
import {
  MAX_EXCLUSION_PATTERN,
  type ExclusionPattern,
} from "@shared/scanExclusions";

const scanExclusionsGet = vi.fn<() => Promise<ScanExclusionsState>>();
const scanExclusionsSetPatterns =
  vi.fn<(patterns: ExclusionPattern[]) => Promise<ScanExclusionsState>>();
const scanExclusionsPreview =
  vi.fn<(pattern: ExclusionPattern) => Promise<PatternPreview>>();
const toastError = vi.fn<(message: string) => void>();
const toastSuccess = vi.fn<(message: string) => void>();
vi.mock("@/ipc/client", () => ({
  api: {
    scanExclusionsGet: () => scanExclusionsGet(),
    scanExclusionsSetPatterns: (patterns: ExclusionPattern[]) =>
      scanExclusionsSetPatterns(patterns),
    scanExclusionsPreview: (pattern: ExclusionPattern) =>
      scanExclusionsPreview(pattern),
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

const field = (n: number) =>
  screen.getByLabelText<HTMLInputElement>(`Pattern ${n}`);
const fields = () =>
  screen.queryAllByRole<HTMLInputElement>("textbox", { name: /^Pattern \d+$/ });
const newField = () =>
  screen.getByLabelText<HTMLInputElement>("Pattern to add");
const addButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Add" });
const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save" });
const ready = () => waitFor(() => expect(field(1).disabled).toBe(false));

const name = (value: string): ExclusionPattern => ({ kind: "name", value });
const rx = (value: string): ExclusionPattern => ({ kind: "regex", value });
const kind = (label: string) => screen.getByRole("radio", { name: label });

beforeEach(() => {
  vi.clearAllMocks();
  scanExclusionsGet.mockResolvedValue({ patterns: [name("@eaDir")] });
  scanExclusionsSetPatterns.mockImplementation((patterns) =>
    Promise.resolve({ patterns }),
  );
  scanExclusionsPreview.mockResolvedValue({
    status: "done",
    total: 0,
    files: [],
  });
});

describe("ScanExclusionsSection", () => {
  it("shows the stored patterns, one field each with its kind, with nothing to save", async () => {
    renderSection();
    await waitFor(() => expect(field(1).value).toBe("@eaDir"));
    expect(fields()).toHaveLength(1);
    expect(field(1).closest("li")?.textContent).toContain("Name");
    expect(saveButton().disabled).toBe(true);
  });

  it("names a pattern that cannot be used and does not save", async () => {
    scanExclusionsGet.mockResolvedValue({
      patterns: [rx("^a$"), rx("^b$"), name("c")],
    });
    renderSection();
    await ready();
    fireEvent.change(field(1), { target: { value: "(" } });
    fireEvent.change(field(2), { target: { value: "(" } });
    // Too long once it is a regex.
    const long = "a".repeat(MAX_EXCLUSION_PATTERN + 1);
    fireEvent.change(field(3), { target: { value: long } });

    expect(screen.getAllByText("(")).toHaveLength(2);
    expect(screen.getByText(long)).toBeTruthy();
    expect(field(1).getAttribute("aria-invalid")).toBe("true");
    expect(saveButton().disabled).toBe(true);
  });

  it("says so when the patterns cannot be read", async () => {
    scanExclusionsGet.mockRejectedValue(new Error("down"));
    renderSection();

    expect(
      await screen.findByText("Could not read the scan exclusions."),
    ).toBeTruthy();
    expect(newField().disabled).toBe(true);
  });

  it("saves the fields that hold a pattern and refreshes the file views", async () => {
    scanExclusionsGet.mockResolvedValue({
      patterns: [name("@eaDir"), name("proxy")],
    });
    const { invalidate } = renderSection();
    await ready();
    fireEvent.change(field(1), { target: { value: " " } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(scanExclusionsSetPatterns).toHaveBeenCalledWith([name("proxy")]),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["files_search"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["missing_files"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["folders_list"] });
    expect(saveButton().disabled).toBe(true);
  });

  it("tells the user when the save fails, keeping the edit", async () => {
    scanExclusionsSetPatterns.mockRejectedValue(new Error("no"));
    renderSection();
    await ready();
    fireEvent.change(field(1), { target: { value: "cache" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(field(1).value).toBe("cache");
  });

  it("removes a pattern", async () => {
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Remove pattern 1" }));
    expect(fields()).toHaveLength(0);
    expect(screen.getByText("No patterns.")).toBeTruthy();

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(scanExclusionsSetPatterns).toHaveBeenCalledWith([]),
    );
  });

  it("takes a name by default, and shows the listed files it would hide before it is added", async () => {
    scanExclusionsPreview.mockResolvedValue({
      status: "done",
      total: 51,
      files: [
        {
          workspace: "Videos",
          path: "private/a.mp4",
          absPath: "/home/me/Videos/private/a.mp4",
        },
      ],
    });
    renderSection();
    await ready();
    expect((kind("Name") as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getByText(
        "Type a pattern to see the files it matches among those already listed.",
      ),
    ).toBeTruthy();

    fireEvent.change(newField(), { target: { value: "private" } });
    const list = await screen.findByRole("list", { name: "Matching files" });
    expect(list.textContent).toContain("Videos");
    expect(list.textContent).toContain("private/a.mp4");
    expect(
      screen.getByText(
        "51 files match. They are hidden once the pattern is added and saved.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("and 50 more")).toBeTruthy();
    expect(scanExclusionsPreview).toHaveBeenCalledWith(name("private"));
    // Nothing is added or saved by looking.
    expect(fields()).toHaveLength(1);
    expect(scanExclusionsSetPatterns).not.toHaveBeenCalled();
  });

  it("tries and adds the pattern as the kind picked", async () => {
    renderSection();
    await ready();
    fireEvent.click(kind("Regex"));
    expect(newField().placeholder).toBe("(^|/)private/");
    expect(
      screen.getByText(/A regular expression, matched against/),
    ).toBeTruthy();
    fireEvent.change(newField(), { target: { value: "(^|/)tmp/" } });
    await waitFor(() =>
      expect(scanExclusionsPreview).toHaveBeenCalledWith(rx("(^|/)tmp/")),
    );

    fireEvent.click(addButton());
    expect(field(2).value).toBe("(^|/)tmp/");
    expect(field(2).closest("li")?.textContent).toContain("Regex");
    expect(newField().value).toBe("");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(scanExclusionsSetPatterns).toHaveBeenCalledWith([
        name("@eaDir"),
        rx("(^|/)tmp/"),
      ]),
    );
  });

  it("asks only once typing pauses, and not for a pattern that is wrong", async () => {
    renderSection();
    await ready();
    fireEvent.click(kind("Regex"));
    fireEvent.change(newField(), { target: { value: "(" } });
    fireEvent.change(newField(), { target: { value: "(^|/)tm" } });
    fireEvent.change(newField(), { target: { value: "(^|/)tmp/" } });

    expect(
      await screen.findByText("It matches none of the listed files."),
    ).toBeTruthy();
    expect(scanExclusionsPreview).toHaveBeenCalledTimes(1);
    expect(scanExclusionsPreview).toHaveBeenCalledWith(rx("(^|/)tmp/"));
  });

  it("says when a pattern did not finish, or the files could not be read", async () => {
    scanExclusionsPreview.mockResolvedValueOnce({ status: "timedOut" });
    renderSection();
    await ready();
    fireEvent.click(kind("Regex"));
    fireEvent.change(newField(), { target: { value: "(a+)+$" } });
    expect(
      await screen.findByText(/This pattern did not finish in time\./),
    ).toBeTruthy();
    // Saved, it would stop every scan.
    expect(addButton().disabled).toBe(true);

    scanExclusionsPreview.mockRejectedValueOnce(new Error("down"));
    fireEvent.change(newField(), { target: { value: "^b" } });
    expect(
      await screen.findByText("Couldn't look for matching files."),
    ).toBeTruthy();
  });

  it("adds with Enter, and not a pattern that is wrong or listed", async () => {
    renderSection();
    await ready();
    fireEvent.change(newField(), { target: { value: "*" } });
    expect(addButton().disabled).toBe(true);

    fireEvent.change(newField(), { target: { value: "@eaDir" } });
    expect(
      screen.getByText("This pattern is already in the list."),
    ).toBeTruthy();
    expect(addButton().disabled).toBe(true);
    // The same text as another kind is another pattern.
    fireEvent.click(kind("Contains"));
    expect(addButton().disabled).toBe(false);

    fireEvent.change(newField(), { target: { value: ".part" } });
    fireEvent.keyDown(newField(), { key: "Enter" });
    expect(field(2).value).toBe(".part");
    expect(field(2).closest("li")?.textContent).toContain("Contains");
  });

  it("puts a common pattern in the field as a name, to try before adding", async () => {
    renderSection();
    await ready();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Use Synology @eaDir",
      }).disabled,
    ).toBe(true);

    fireEvent.click(kind("Regex"));
    fireEvent.click(screen.getByRole("button", { name: "Use Thumbs.db" }));
    expect(newField().value).toBe("Thumbs.db");
    expect((kind("Name") as HTMLInputElement).checked).toBe(true);
    expect(fields()).toHaveLength(1);
  });
  it("trims a name, but keeps the spaces of a text or a regex", async () => {
    renderSection();
    await ready();
    fireEvent.change(newField(), { target: { value: " proxy " } });
    fireEvent.click(addButton());
    fireEvent.click(kind("Contains"));
    fireEvent.change(newField(), { target: { value: " copy" } });
    fireEvent.click(addButton());

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(scanExclusionsSetPatterns).toHaveBeenCalledWith([
        name("@eaDir"),
        name("proxy"),
        { kind: "contains", value: " copy" },
      ]),
    );
  });
});
