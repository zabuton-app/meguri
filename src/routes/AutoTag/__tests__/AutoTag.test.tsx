import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import AutoTag from "@/routes/AutoTag";
import { renderWithProviders } from "@/test/renderWithProviders";
import {
  defaultAutoTagConfig,
  type AutoTagApplyResult,
  type AutoTagAssignment,
  type AutoTagConfig,
  type AutoTagLibrary,
} from "@shared/autoTag";

const mocks = vi.hoisted(() => ({
  autoTagGet: vi.fn<() => Promise<AutoTagConfig>>(),
  autoTagSet: vi.fn<(config: AutoTagConfig) => Promise<void>>(),
  autoTagFiles: vi.fn<() => Promise<AutoTagLibrary>>(),
  autoTagApply:
    vi.fn<(a: AutoTagAssignment[]) => Promise<AutoTagApplyResult>>(),
  autoTagUndo: vi.fn<(ids: string[]) => Promise<number>>(),
  autoTagReapply: vi.fn<() => Promise<{ files: number; added: number }>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    autoTagGet: () => mocks.autoTagGet(),
    autoTagSet: (config: AutoTagConfig) => mocks.autoTagSet(config),
    autoTagFiles: () => mocks.autoTagFiles(),
    autoTagApply: (a: AutoTagAssignment[]) => mocks.autoTagApply(a),
    autoTagUndo: (ids: string[]) => mocks.autoTagUndo(ids),
    autoTagReapply: () => mocks.autoTagReapply(),
  },
}));

const NAMES = [
  "ABCD-123 Morning yoga routine.mp4",
  "ABCD-124 Evening yoga stretch.mp4",
  "[Trip] Harbor walk.mp4",
  "[Trip] Harbor picnic.mp4",
  "IMG-2041.jpg",
];

function library(): AutoTagLibrary {
  return {
    files: NAMES.map((name, i) => ({
      workspaceId: "ws",
      id: i + 1,
      name,
      metaKey: `k${i}`,
      tags: i === 2 ? ["trip"] : [],
    })),
    total: NAMES.length,
    existingTags: ["trip"],
  };
}

async function renderScreen(tab?: string) {
  renderWithProviders(<AutoTag />);
  await screen.findByText("Pattern rules");
  if (tab) fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
}

/** The config most recently written back to main. */
async function lastSaved(): Promise<AutoTagConfig> {
  await waitFor(() => expect(mocks.autoTagSet).toHaveBeenCalled(), {
    timeout: 2000,
  });
  return mocks.autoTagSet.mock.calls.at(-1)![0];
}

describe("AutoTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("meguri.lang", "en");
    mocks.autoTagGet.mockResolvedValue(defaultAutoTagConfig());
    mocks.autoTagFiles.mockResolvedValue(library());
    mocks.autoTagSet.mockResolvedValue();
    mocks.autoTagUndo.mockResolvedValue(1);
    mocks.autoTagApply.mockImplementation((assignments) =>
      Promise.resolve({
        files: assignments.reduce((n, a) => n + a.fileIds.length, 0),
        added: assignments.reduce(
          (n, a) => n + a.fileIds.length * a.tags.length,
          0,
        ),
        undoId: "undo-1",
      }),
    );
  });

  it("lists the rules with how many files each would tag and tests the selected one", async () => {
    await renderScreen();
    expect(
      screen.getByText("4 active rules · 0 keywords · 5 files", {
        exact: false,
      }),
    ).toBeTruthy();
    // The code-prefix rule tags the two ABCD files; IMG is excluded.
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
    expect(screen.getAllByText("ABCD").length).toBeGreaterThan(0);
    expect(screen.getByText("Excluded")).toBeTruthy();
    // Nothing was edited, so nothing is written back.
    expect(mocks.autoTagSet).not.toHaveBeenCalled();
  });

  it("flags an invalid pattern and still saves the edit", async () => {
    await renderScreen();
    fireEvent.change(screen.getByDisplayValue("^([A-Z]{2,6})-\\d{2,5}"), {
      target: { value: "(" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("0 of 5 would be tagged")).toBeTruthy();
    expect((await lastSaved()).rules[0].pattern).toBe("(");
  });

  it("turns scanning on only when asked", async () => {
    await renderScreen();
    fireEvent.click(
      screen.getByRole("switch", { name: "Apply when scanning" }),
    );
    expect((await lastSaved()).applyOnScan).toBe(true);
  });

  it("registers a keyword with aliases and shows the files it finds", async () => {
    await renderScreen("Keyword dictionary");
    fireEvent.change(screen.getByLabelText("Tag name"), {
      target: { value: "Yoga" },
    });
    fireEvent.change(screen.getByLabelText("Aliases (comma-separated)"), {
      target: { value: "ヨガ, stretch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add keyword" }));

    expect(screen.getByText("Creates a new tag")).toBeTruthy();
    expect(screen.getAllByText("2 files").length).toBeGreaterThan(0);
    expect((await lastSaved()).keywords).toMatchObject([
      { tag: "Yoga", aliases: ["ヨガ", "stretch"], mode: "word" },
    ]);
  });

  it("applies a suggestion to the files that lack it, and takes it back", async () => {
    await renderScreen("Suggestions");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    expect(within(row).getByText(/adds to existing tag/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    // File 3 already carries "trip"; only file 4 is sent, with the existing spelling.
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [4], tags: ["trip"] },
    ]);
    await screen.findByText("✓ Applied");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(mocks.autoTagUndo).toHaveBeenCalledWith(["undo-1"]),
    );
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Apply" })).toBeTruthy(),
    );
  });

  it("keeps the way back when another tab is visited in between", async () => {
    await renderScreen("Suggestions");
    const apply = () =>
      within(
        screen.getByRole("checkbox", { name: "Trip" }).closest("div")!,
      ).getByRole("button", { name: "Apply" });
    fireEvent.click(apply());
    await screen.findByText("✓ Applied");

    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    fireEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(mocks.autoTagUndo).toHaveBeenCalledWith(["undo-1"]),
    );
  });

  it("does not call a suggestion applied when applying failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Suggestions");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    // The list is loaded again to show what the files really carry.
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("✓ Applied")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers frequent words and remembers the ones dismissed", async () => {
    await renderScreen("Suggestions");
    // "Harbor" is in two names and no rule or keyword claims it.
    const row = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    expect(within(row).getByText("Frequent word")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Ignore" }));
    expect((await lastSaved()).ignored).toEqual(["harbor"]);
    expect(within(row).getByText("Ignored")).toBeTruthy();
  });

  it("confirms a file's proposed tags and moves to the next one", async () => {
    await renderScreen("Review by file");
    expect(screen.getByText("1 of 5 files reviewed")).toBeTruthy();
    expect(screen.getByText("1 / 5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1], tags: ["ABCD"] },
    ]);
    await screen.findByText("2 / 5");
    expect(screen.getByText("2 of 5 files reviewed")).toBeTruthy();
  });

  it("leaves a file unconfirmed when tagging it failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    expect(screen.getByText("1 of 5 files reviewed")).toBeTruthy();
  });

  it("closes the token panel on Escape, not the whole screen", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    expect(screen.getByText("Create tagging from “yoga”")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Create tagging from “yoga”")).toBeNull();
    // Still on the screen: the modal did not take the key as well.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(window.location.hash).toBe("#/");
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("moves with J and K even after a checkbox was used", async () => {
    await renderScreen("Review by file");
    const box = screen.getByRole("checkbox", { name: "Apply “ABCD”" });
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: "j" });
    expect(screen.getByText("2 / 5")).toBeTruthy();
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("makes a dictionary entry from a word in the file name", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    expect(screen.getByText("Create tagging from “yoga”")).toBeTruthy();
    // The option says how many files it would reach before anything is created.
    expect(screen.getByText("2 files match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));

    expect((await lastSaved()).keywords).toMatchObject([{ tag: "yoga" }]);
    // The new entry shows up as a proposal for this file straight away.
    await screen.findByText("Keyword dictionary", { selector: "span" });
  });

  it("leaves rules out of the analysis after a visit that never finished", async () => {
    localStorage.setItem("meguri.autoTag.analyzing", "1");
    await renderScreen();
    expect(screen.getByRole("alert").textContent).toContain(
      "The last analysis did not finish",
    );
    // Nothing is run against the library, but the rules can still be edited.
    expect(screen.getByText("0 of 0 would be tagged")).toBeTruthy();
    expect(screen.getByDisplayValue("^([A-Z]{2,6})-\\d{2,5}")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume analysis" }));
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
    expect(localStorage.getItem("meguri.autoTag.analyzing")).toBeNull();
  });

  it("sorts terms into tags, applies them and remembers the decision", async () => {
    await renderScreen("Sort terms");
    const term = screen.getByRole("button", { name: /Harbor/ });
    const row = term.closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "Make tag" }));
    // Codes and bracket contents already come from the rules.
    expect(screen.getAllByText("from a rule").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Apply 3 tags" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    const sent = mocks.autoTagApply.mock.calls[0][0];
    expect(sent).toContainEqual({
      workspaceId: "ws",
      fileIds: [1, 2],
      tags: ["ABCD"],
    });
    expect(sent).toContainEqual({
      workspaceId: "ws",
      fileIds: [4],
      tags: ["Harbor", "trip"],
    });
    // Only the decision made here goes to the dictionary.
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "Harbor" }]);
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
